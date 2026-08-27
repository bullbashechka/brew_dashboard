import {
  inventoryMovementMutationResponseSchema,
  type InventoryMovementMutation,
} from "@brew-dashboard/contracts";
import type { Context } from "hono";

import type { AppEnvironment } from "../http/types.ts";
import { createInventoryMovement } from "./service.ts";

const validatedJson = (context: Context<AppEnvironment>): InventoryMovementMutation =>
  (context.req as unknown as { valid: (target: "json") => InventoryMovementMutation }).valid(
    "json",
  );

export const inventoryMovementHandler = async (context: Context<AppEnvironment>) => {
  const auth = context.get("auth");
  const data = await createInventoryMovement(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    request: validatedJson(context),
  });
  const response = { data, meta: {}, requestId: context.get("requestId") };
  inventoryMovementMutationResponseSchema.parse(response);
  return context.json(response, 200);
};
