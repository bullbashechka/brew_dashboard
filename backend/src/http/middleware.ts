import { bodyLimit } from "hono/body-limit";
import { routePath } from "hono/route";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { authUrlFor } from "../auth/environment.ts";
import { errorResponse } from "./errors.ts";
import type { AppEnvironment } from "./types.ts";
import { pseudonymize } from "../security/pseudonym.ts";

export const JSON_BODY_LIMIT = 256 * 1024;
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

type LogLevel = "log" | "warn" | "error";
export type RequestSignal =
  | "server_error"
  | "login_failure"
  | "mfa_failure"
  | "onboarding_failure"
  | "reset_failure"
  | "request";
export const UNMATCHED_ROUTE = "unmatched";
export const UNMATCHED_ROUTE_SAMPLE_RATE = 0.01;

const logLevelFor = (status: number): LogLevel => {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "log";
};

export const signalsFor = (path: string, status: number): RequestSignal[] => {
  const signals: RequestSignal[] = [];
  if (status >= 500) signals.push("server_error");
  if (status >= 400 && path.endsWith("/auth/login")) signals.push("login_failure");
  if (status >= 400 && path.endsWith("/auth/mfa/verify")) signals.push("mfa_failure");
  if (status >= 400 && path.endsWith("/onboarding/complete")) signals.push("onboarding_failure");
  if (status >= 400 && path.endsWith("/demo/reset")) signals.push("reset_failure");
  return signals.length ? signals : ["request"];
};

export const normalizeRoutePattern = (matchedRoute: string | undefined): string => {
  if (!matchedRoute || matchedRoute.endsWith("*")) return UNMATCHED_ROUTE;
  return matchedRoute;
};

export const observableRoute = (context: Context<AppEnvironment>): string =>
  normalizeRoutePattern(routePath(context, -1) || undefined);

export const shouldLogRequest = (route: string, status: number, requestId: string): boolean => {
  if (route !== UNMATCHED_ROUTE || status >= 500) return true;
  const prefix = Number.parseInt(requestId.slice(0, 8), 16);
  return Number.isFinite(prefix) && prefix % Math.round(1 / UNMATCHED_ROUTE_SAMPLE_RATE) === 0;
};

const isJsonContentType = (value: string | undefined) => {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
};

const expectedOrigin = (context: Context<AppEnvironment>) => {
  const configured = authUrlFor(context.env);
  if (configured) {
    if (!URL.canParse(configured)) throw new Error("Configured authentication URL is invalid");
    return new URL(configured).origin;
  }
  return new URL(context.req.url).origin;
};

export const requestIdMiddleware = createMiddleware<AppEnvironment>(async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  context.set("requestStartedAt", Date.now());
  context.header("x-request-id", requestId);
  await next();
});

export const securityHeadersMiddleware = createMiddleware<AppEnvironment>(async (context, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value);
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value);
});

/** API responses can contain session- and tenant-specific data. */
export const noStoreMiddleware = createMiddleware<AppEnvironment>(async (context, next) => {
  context.header("Cache-Control", "no-store");
  await next();
  context.header("Cache-Control", "no-store");
});

export const observabilityMiddleware = createMiddleware<AppEnvironment>(async (context, next) => {
  await next();
  if (context.get("requestErrorLogged")) return;
  const requestPath = context.req.path;
  const route = observableRoute(context);
  const status = context.res.status;
  const requestId = context.get("requestId");
  if (!shouldLogRequest(route, status, requestId)) return;
  const account = context.get("safeAccount");
  const signals = signalsFor(requestPath, status);
  const payload = {
    event: "http_request_completed.v1",
    requestId,
    route,
    method: context.req.method,
    status,
    durationMs: Date.now() - context.get("requestStartedAt"),
    signal: signals[0],
    signals,
    ...(account
      ? {
          userHash: await pseudonymize(account.userId, context.env, "user"),
          networkHash: await pseudonymize(account.networkId, context.env, "network"),
        }
      : {}),
  };
  console[logLevelFor(status)](payload);
});

export const mutationSecurityMiddleware = createMiddleware<AppEnvironment>(
  async (context, next) => {
    if (!mutationMethods.has(context.req.method)) {
      await next();
      return;
    }

    if (!isJsonContentType(context.req.header("content-type"))) {
      return errorResponse(
        context,
        "VALIDATION_ERROR",
        415,
        "Requests with a body must use application/json",
      );
    }

    const origin = context.req.header("origin");
    const allowedOrigin = expectedOrigin(context);
    if (!origin || origin === "null" || !allowedOrigin || origin !== allowedOrigin) {
      return errorResponse(context, "FORBIDDEN", 403, "Request origin is not allowed");
    }

    return bodyLimit({
      maxSize: JSON_BODY_LIMIT,
      onError: (bodyContext) =>
        errorResponse(
          bodyContext as Context<AppEnvironment>,
          "VALIDATION_ERROR",
          413,
          "Request body is too large",
        ),
    })(context, next);
  },
);

export const __test = {
  isJsonContentType,
  JSON_BODY_LIMIT,
  expectedOrigin,
  SECURITY_HEADERS,
  noStoreMiddleware,
  signalsFor,
  UNMATCHED_ROUTE,
  UNMATCHED_ROUTE_SAMPLE_RATE,
  normalizeRoutePattern,
  observableRoute,
  shouldLogRequest,
};
