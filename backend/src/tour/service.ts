import { tourMutationSchema, type TourState } from "@brew-dashboard/contracts";
import { eq } from "drizzle-orm";

import { appUsers } from "../db/schema.ts";
import type { RequestTransaction } from "../db/client.ts";
import {
  claimIdempotency,
  completeIdempotency,
  hashOperationPayload,
} from "../domain/idempotency.ts";

export const TOUR_STATE_OPERATION = "settings.tour";

export const setTourState = async (
  transaction: RequestTransaction,
  input: { authUserId: string; networkId: string; state: TourState; idempotencyKey: string },
) => {
  const request = tourMutationSchema.parse({
    state: input.state,
    idempotencyKey: input.idempotencyKey,
  });
  const requestHash = await hashOperationPayload(TOUR_STATE_OPERATION, { state: request.state });
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: request.idempotencyKey,
    operation: TOUR_STATE_OPERATION,
    requestHash,
  });
  if (claim.replay) return { state: request.state };

  const now = new Date();
  await transaction
    .update(appUsers)
    .set({
      tourCompletedAt: request.state === "completed" ? now : null,
      tourSkippedAt: request.state === "skipped" ? now : null,
      updatedAt: now,
    })
    .where(eq(appUsers.authUserId, input.authUserId));
  await completeIdempotency(transaction, {
    id: claim.id,
    resourceId: input.authUserId,
    completedAt: now,
  });
  return { state: request.state };
};
