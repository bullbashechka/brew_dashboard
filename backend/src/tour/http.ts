import { type TourState } from "@brew-dashboard/contracts";
import type { Context } from "hono";

import type { AppEnvironment } from "../http/types.ts";
import { setTourState } from "./service.ts";

const validatedJson = (context: Context<AppEnvironment>): unknown =>
  (
    context.req as unknown as {
      valid: (target: "json") => unknown;
    }
  ).valid("json");

export const tourStateHandler = async (context: Context<AppEnvironment>) => {
  const request = validatedJson(context) as { state: TourState; idempotencyKey: string };
  const auth = context.get("auth");
  const result = await setTourState(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    state: request.state,
    idempotencyKey: request.idempotencyKey,
  });
  return context.json({ data: result, meta: {}, requestId: context.get("requestId") }, 200);
};
