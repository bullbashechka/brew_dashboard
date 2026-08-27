import { createRoute, OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  inventoryMovementMutationResponseSchema,
  inventoryMovementMutationSchema,
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
  priceMutationSchema,
  priceMutationResponseSchema,
  salesQuerySchema,
  salesResponseSchema,
  analyticsFilterQuerySchema,
  resetMutationSchema,
  resetResultResponseSchema,
  feedbackMutationSchema,
  feedbackResponseSchema,
  productEventRequestSchema,
  productEventResponseSchema,
  revenueGoalMutationSchema,
  revenueGoalMutationResponseSchema,
  sessionResponseSchema,
  tourMutationSchema,
  tourStateResponseSchema,
  uuidSchema,
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
import {
  mutationSecurityMiddleware,
  observabilityMiddleware,
  requestIdMiddleware,
  securityHeadersMiddleware,
  signalsFor,
  observableRoute,
} from "./http/middleware.ts";
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
import { tourStateHandler } from "./tour/http.ts";
import { resetDemoHandler } from "./demo/http.ts";
import { productPriceHandler } from "./products/http.ts";
import { inventoryMovementHandler } from "./inventory/http.ts";
import {
  feedbackGetHandler,
  feedbackPutHandler,
  revenueGoalHandler,
  settingsLanguageHandler,
} from "./settings/http.ts";
import { productEventHandler } from "./events/http.ts";

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

const tourStateRoute = createRoute({
  method: "put",
  path: "/settings/tour",
  request: {
    body: {
      content: { "application/json": { schema: tourMutationSchema } },
      description: "Persist guided tour state",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: tourStateResponseSchema } },
      description: "Guided tour state persisted",
    },
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    409: errorResponseDefinition("Tour state idempotency conflict"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const settingsLanguageRoute = createRoute({
  method: "put",
  path: "/settings/language",
  request: {
    body: {
      content: { "application/json": { schema: languageRequestSchema } },
      description: "Update the completed network language preference",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: onboardingLanguageResponseSchema } },
      description: "Language preference persisted",
    },
    400: errorResponseDefinition("Language validation failed"),
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    409: errorResponseDefinition("Language idempotency conflict"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const revenueGoalRoute = createRoute({
  method: "put",
  path: "/settings/revenue-goal",
  request: {
    body: {
      content: { "application/json": { schema: revenueGoalMutationSchema } },
      description: "Upsert or clear the current network month revenue goal",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: revenueGoalMutationResponseSchema } },
      description: "Revenue goal saved",
    },
    400: errorResponseDefinition("Revenue goal validation failed"),
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    409: errorResponseDefinition("Revenue goal or demo data changed"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const feedbackGetRoute = createRoute({
  method: "get",
  path: "/feedback",
  responses: {
    200: {
      content: { "application/json": { schema: feedbackResponseSchema } },
      description: "Current network feedback response",
    },
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const feedbackPutRoute = createRoute({
  method: "put",
  path: "/feedback",
  request: {
    body: {
      content: { "application/json": { schema: feedbackMutationSchema } },
      description: "Create or update the current network feedback response",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: feedbackResponseSchema } },
      description: "Feedback response saved",
    },
    400: errorResponseDefinition("Feedback validation failed"),
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    409: errorResponseDefinition("Feedback idempotency or version conflict"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const productEventRoute = createRoute({
  method: "post",
  path: "/events",
  request: {
    body: {
      content: { "application/json": { schema: productEventRequestSchema } },
      description: "Record one schema-validated product event",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: productEventResponseSchema } },
      description: "Product event accepted",
    },
    400: errorResponseDefinition("Product event validation failed"),
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    409: errorResponseDefinition("Event ID conflict"),
    429: errorResponseDefinition("Product event rate limit exceeded"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
  },
});

const resetDemoRoute = createRoute({
  method: "post",
  path: "/demo/reset",
  request: {
    body: {
      content: { "application/json": { schema: resetMutationSchema } },
      description: "Regenerate the current tenant's deterministic demo data",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: resetResultResponseSchema } },
      description: "Demo data reset completed",
    },
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    409: errorResponseDefinition("Demo reset idempotency or generation conflict"),
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

const productPriceRoute = createRoute({
  method: "patch",
  path: "/products/{productId}/price",
  request: {
    params: z.object({ productId: uuidSchema }),
    body: {
      content: { "application/json": { schema: priceMutationSchema } },
      description: "Update a tenant product's current selling price",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: priceMutationResponseSchema } },
      description: "Current product price updated",
    },
    400: errorResponseDefinition("Product price validation failed"),
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    404: errorResponseDefinition("Product not found"),
    409: errorResponseDefinition("Product or demo data changed"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
    500: errorResponseDefinition("Internal server error"),
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

const inventoryMovementRoute = createRoute({
  method: "post",
  path: "/inventory/movements",
  request: {
    body: {
      content: { "application/json": { schema: inventoryMovementMutationSchema } },
      description: "Create a tenant inventory receipt or write off",
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: inventoryMovementMutationResponseSchema } },
      description: "Inventory balance updated",
    },
    400: errorResponseDefinition("Inventory movement validation failed"),
    401: errorResponseDefinition("Authentication required"),
    403: errorResponseDefinition("Onboarding is incomplete or origin rejected"),
    404: errorResponseDefinition("Inventory item or balance not found"),
    409: errorResponseDefinition("Inventory balance or demo data changed"),
    413: errorResponseDefinition("Request body too large"),
    415: errorResponseDefinition("Unsupported media type"),
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
app.use("*", securityHeadersMiddleware);
app.use("*", observabilityMiddleware);
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
app.use("/settings/tour", requireAuthentication, requireCompletedOnboarding);
app.openapi(
  tourStateRoute,
  tourStateHandler as unknown as RouteHandler<typeof tourStateRoute, AppEnvironment>,
);
for (const path of ["/settings/language", "/settings/revenue-goal", "/feedback", "/events"]) {
  app.use(path, requireAuthentication, requireCompletedOnboarding);
}
app.openapi(
  settingsLanguageRoute,
  settingsLanguageHandler as unknown as RouteHandler<typeof settingsLanguageRoute, AppEnvironment>,
);
app.openapi(
  revenueGoalRoute,
  revenueGoalHandler as unknown as RouteHandler<typeof revenueGoalRoute, AppEnvironment>,
);
app.openapi(
  feedbackGetRoute,
  feedbackGetHandler as unknown as RouteHandler<typeof feedbackGetRoute, AppEnvironment>,
);
app.openapi(
  feedbackPutRoute,
  feedbackPutHandler as unknown as RouteHandler<typeof feedbackPutRoute, AppEnvironment>,
);
app.openapi(
  productEventRoute,
  productEventHandler as unknown as RouteHandler<typeof productEventRoute, AppEnvironment>,
);
app.use("/demo/reset", requireAuthentication, requireCompletedOnboarding);
app.openapi(
  resetDemoRoute,
  resetDemoHandler as unknown as RouteHandler<typeof resetDemoRoute, AppEnvironment>,
);

for (const path of ["/overview", "/locations", "/sales", "/products", "/inventory"]) {
  app.use(path, requireAuthentication, requireCompletedOnboarding);
}
app.use("/products/:productId/price", requireAuthentication, requireCompletedOnboarding);
app.use("/inventory/movements", requireAuthentication, requireCompletedOnboarding);

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
  productPriceRoute,
  productPriceHandler as unknown as RouteHandler<typeof productPriceRoute, AppEnvironment>,
);
app.openapi(
  inventoryRoute,
  inventoryHandler as unknown as RouteHandler<typeof inventoryRoute, AppEnvironment>,
);
app.openapi(
  inventoryMovementRoute,
  inventoryMovementHandler as unknown as RouteHandler<
    typeof inventoryMovementRoute,
    AppEnvironment
  >,
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
  const requestPath = context.req.path;
  const route = observableRoute(context);
  const account = context.get("safeAccount");
  const signals = signalsFor(requestPath, 500);
  context.set("requestErrorLogged", true);
  console.error({
    event: "http_request_failed.v1",
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: "Unhandled request error",
    method: context.req.method,
    route,
    status: 500,
    requestId,
    signal: signals[0],
    signals,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    durationMs: context.get("requestStartedAt") ? Date.now() - context.get("requestStartedAt") : 0,
    ...(account ? { userId: account.userId, networkId: account.networkId } : {}),
  });
  return errorResponse(context, "INTERNAL_ERROR", 500, "Internal server error");
});

export default {
  fetch: app.fetch,
};

export const notFoundResponseSchema = apiErrorResponseSchema;
