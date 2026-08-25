import { resetMutationSchema, resetResultResponseSchema } from "@brew-dashboard/contracts";

import { requestApi } from "./client";

export const resetDemoData = (idempotencyKey: string) =>
  requestApi({
    path: "/api/v1/demo/reset",
    method: "POST",
    body: resetMutationSchema.parse({ idempotencyKey }),
    schema: resetResultResponseSchema,
  });
