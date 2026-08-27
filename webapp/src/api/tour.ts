import {
  tourMutationSchema,
  tourStateResponseSchema,
  type TourState,
} from "@brew-dashboard/contracts";

import { requestApi } from "./client";

export const saveTourState = (state: TourState) =>
  requestApi({
    path: "/api/v1/settings/tour",
    method: "PUT",
    body: tourMutationSchema.parse({ state, idempotencyKey: crypto.randomUUID() }),
    schema: tourStateResponseSchema,
  });
