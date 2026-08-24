import { createRoute, OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  loginRequestSchema,
  logoutRequestSchema,
  logoutResponseSchema,
  sessionResponseSchema,
} from "@brew-dashboard/contracts";

import { loginHandler, logoutHandler, meHandler, requireAuthentication } from "./auth/http.ts";
import {
  ApiProblem,
  ensureRequestId,
  errorResponse,
  unauthenticatedResponse,
} from "./http/errors.ts";
import { mutationSecurityMiddleware, requestIdMiddleware } from "./http/middleware.ts";
import type { AppEnvironment } from "./http/types.ts";

export type { WorkerBindings } from "./http/types.ts";

const errorResponseDefinition = (description: string) => ({
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description,
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: { "application/json": { schema: healthResponseSchema } },
      description: "Worker health status",
    },
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  request: {
    body: {
      content: { "application/json": { schema: loginRequestSchema } },
      description: "Login alias and password",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: sessionResponseSchema } },
      description: "Authenticated session",
    },
    401: errorResponseDefinition("Generic authentication failure"),
    403: errorResponseDefinition("Origin rejected"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    429: errorResponseDefinition("Rate limit exceeded"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  request: {
    body: {
      content: { "application/json": { schema: logoutRequestSchema } },
      description: "Empty logout body",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: logoutResponseSchema } },
      description: "Session revoked",
    },
    400: errorResponseDefinition("Request validation failed"),
    403: errorResponseDefinition("Origin rejected"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/auth/me",
  responses: {
    200: {
      content: { "application/json": { schema: sessionResponseSchema } },
      description: "Current authenticated profile",
    },
    401: errorResponseDefinition("Authentication required"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const validationHook = (result: { success: boolean }, context: Context<AppEnvironment>) => {
  if (result.success) return;
  if (context.req.path.endsWith("/auth/login")) return unauthenticatedResponse(context);
  return errorResponse(context, "VALIDATION_ERROR", 400, "Request validation failed");
};

export const app = new OpenAPIHono<AppEnvironment>({ defaultHook: validationHook }).basePath(
  "/api/v1",
);

app.use("*", requestIdMiddleware);
app.use("*", mutationSecurityMiddleware);

app.openapi(healthRoute, (context) =>
  context.json({
    data: { status: "ok" as const },
    meta: {},
    requestId: context.get("requestId"),
  }),
);

app.openapi(loginRoute, loginHandler as unknown as RouteHandler<typeof loginRoute, AppEnvironment>);
app.openapi(
  logoutRoute,
  logoutHandler as unknown as RouteHandler<typeof logoutRoute, AppEnvironment>,
);
app.use("/auth/me", requireAuthentication);
app.openapi(meRoute, meHandler as unknown as RouteHandler<typeof meRoute, AppEnvironment>);

app.notFound((context) => errorResponse(context, "NOT_FOUND", 404, "Not found"));

app.onError((error, context) => {
  if (error instanceof ApiProblem) {
    return errorResponse(context, error.code, error.status, error.message, error.fields);
  }
  if (error instanceof HTTPException && error.status === 400) {
    if (context.req.path.endsWith("/auth/login")) return unauthenticatedResponse(context);
    return errorResponse(context, "VALIDATION_ERROR", 400, "Request validation failed");
  }

  const requestId = ensureRequestId(context);
  console.error(
    JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: "Unhandled request error",
      method: context.req.method,
      path: context.req.path,
      requestId,
      durationMs: context.get("requestStartedAt")
        ? Date.now() - context.get("requestStartedAt")
        : 0,
    }),
  );
  return errorResponse(context, "INTERNAL_ERROR", 500, "Internal server error");
});

export default {
  fetch: app.fetch,
};

export const notFoundResponseSchema = apiErrorResponseSchema;
