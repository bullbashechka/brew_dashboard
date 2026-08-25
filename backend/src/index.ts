import { createRoute, OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  inventoryQuerySchema,
  inventoryResponseSchema,
  locationsQuerySchema,
  locationsResponseSchema,
  loginRequestSchema,
  logoutRequestSchema,
  logoutResponseSchema,
  languageRequestSchema,
  onboardingCompleteResponseSchema,
  onboardingLanguageResponseSchema,
  onboardingRequestSchema,
  overviewResponseSchema,
  productsResponseSchema,
  salesQuerySchema,
  salesResponseSchema,
  analyticsFilterQuerySchema,
  sessionResponseSchema,
} from "@brew-dashboard/contracts";

import {
  loginHandler,
  logoutHandler,
  meHandler,
  requireAuthentication,
  requireCompletedOnboarding,
  requireIncompleteOnboarding,
} from "./auth/http.ts";
import {
  ApiProblem,
  ensureRequestId,
  errorResponse,
  unauthenticatedResponse,
} from "./http/errors.ts";
import { mutationSecurityMiddleware, requestIdMiddleware } from "./http/middleware.ts";
import type { AppEnvironment } from "./http/types.ts";
import { OperationConflictError } from "./domain/idempotency.ts";
import { onboardingCompleteHandler, onboardingLanguageHandler } from "./onboarding/http.ts";
import {
  inventoryHandler,
  locationsHandler,
  overviewHandler,
  productsHandler,
  salesHandler,
} from "./analytics/http.ts";

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

const onboardingLanguageRoute = createRoute({
  method: "put",
  path: "/onboarding/language",
  request: {
    body: {
      content: { "application/json": { schema: languageRequestSchema } },
      description: "Persist the first selected language",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: onboardingLanguageResponseSchema } },
      description: "Selected onboarding language",
    },
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Origin rejected"),
    409: errorResponseDefinition("Onboarding language conflict"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const onboardingCompleteRoute = createRoute({
  method: "post",
  path: "/onboarding/complete",
  request: {
    body: {
      content: { "application/json": { schema: onboardingRequestSchema } },
      description: "Complete onboarding and create deterministic demo data",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: onboardingCompleteResponseSchema } },
      description: "Completed onboarding and generated demo data",
    },
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Origin rejected"),
    409: errorResponseDefinition("Onboarding conflict"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const analyticsErrors = {
  400: errorResponseDefinition("Analytics query validation failed"),
  401: errorResponseDefinition("Authentication required"),
  403: errorResponseDefinition("Onboarding is incomplete"),
  409: errorResponseDefinition("Analytics pagination context is stale"),
  500: errorResponseDefinition("Internal server error"),
};

const overviewRoute = createRoute({
  method: "get",
  path: "/overview",
  request: { query: analyticsFilterQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: overviewResponseSchema } },
      description: "Overview analytics",
    },
    ...analyticsErrors,
  },
});

const locationsRoute = createRoute({
  method: "get",
  path: "/locations",
  request: { query: locationsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: locationsResponseSchema } },
      description: "Location analytics",
    },
    ...analyticsErrors,
  },
});

const salesRoute = createRoute({
  method: "get",
  path: "/sales",
  request: { query: salesQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: salesResponseSchema } },
      description: "Sales analytics",
    },
    ...analyticsErrors,
  },
});

const productsRoute = createRoute({
  method: "get",
  path: "/products",
  request: { query: analyticsFilterQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: productsResponseSchema } },
      description: "Product analytics",
    },
    ...analyticsErrors,
  },
});

const inventoryRoute = createRoute({
  method: "get",
  path: "/inventory",
  request: { query: inventoryQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: inventoryResponseSchema } },
      description: "Inventory analytics",
    },
    ...analyticsErrors,
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

app.use("/onboarding/language", requireAuthentication, requireIncompleteOnboarding);
app.openapi(
  onboardingLanguageRoute,
  onboardingLanguageHandler as unknown as RouteHandler<
    typeof onboardingLanguageRoute,
    AppEnvironment
  >,
);
app.use("/onboarding/complete", requireAuthentication);
app.openapi(
  onboardingCompleteRoute,
  onboardingCompleteHandler as unknown as RouteHandler<
    typeof onboardingCompleteRoute,
    AppEnvironment
  >,
);

for (const path of ["/overview", "/locations", "/sales", "/products", "/inventory"]) {
  app.use(path, requireAuthentication, requireCompletedOnboarding);
}

app.openapi(
  overviewRoute,
  overviewHandler as unknown as RouteHandler<typeof overviewRoute, AppEnvironment>,
);
app.openapi(
  locationsRoute,
  locationsHandler as unknown as RouteHandler<typeof locationsRoute, AppEnvironment>,
);
app.openapi(salesRoute, salesHandler as unknown as RouteHandler<typeof salesRoute, AppEnvironment>);
app.openapi(
  productsRoute,
  productsHandler as unknown as RouteHandler<typeof productsRoute, AppEnvironment>,
);
app.openapi(
  inventoryRoute,
  inventoryHandler as unknown as RouteHandler<typeof inventoryRoute, AppEnvironment>,
);

for (const path of [
  "/settings",
  "/settings/*",
  "/feedback",
  "/feedback/*",
  "/events",
  "/events/*",
  "/demo",
  "/demo/*",
]) {
  app.use(path, requireAuthentication, requireCompletedOnboarding);
}

app.notFound((context) => errorResponse(context, "NOT_FOUND", 404, "Not found"));

app.onError((error, context) => {
  if (error instanceof ApiProblem) {
    return errorResponse(context, error.code, error.status, error.message, error.fields);
  }
  if (error instanceof OperationConflictError) {
    return errorResponse(context, "CONFLICT", 409, error.message);
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
