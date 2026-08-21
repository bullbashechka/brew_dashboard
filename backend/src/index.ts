import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { healthResponseSchema } from "@brew-dashboard/contracts";

export type WorkerBindings = {
  ASSETS?: Fetcher;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
};

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: healthResponseSchema,
        },
      },
      description: "Worker health status",
    },
  },
});

export const app = new OpenAPIHono<{ Bindings: WorkerBindings }>().basePath("/api/v1");

app.openapi(healthRoute, (context) => {
  return context.json({
    data: { status: "ok" as const },
    meta: {},
    requestId: crypto.randomUUID(),
  });
});

app.notFound((context) => {
  return context.json(
    {
      error: {
        code: "NOT_FOUND",
        fields: {},
        message: "Not found",
      },
      requestId: crypto.randomUUID(),
    },
    404,
  );
});

export default {
  fetch: app.fetch,
};

export const notFoundResponseSchema = z.object({
  error: z.object({
    code: z.literal("NOT_FOUND"),
    fields: z.record(z.string(), z.unknown()),
    message: z.string(),
  }),
  requestId: z.uuid(),
});
