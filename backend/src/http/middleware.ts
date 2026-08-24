import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { errorResponse } from "./errors.ts";
import type { AppEnvironment } from "./types.ts";

export const JSON_BODY_LIMIT = 256 * 1024;
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const isJsonContentType = (value: string | undefined) => {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
};

const expectedOrigin = (context: Context<AppEnvironment>) => {
  const configured = context.env?.BETTER_AUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return null;
    }
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
};
