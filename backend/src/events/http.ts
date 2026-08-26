import { type ProductEventRequest } from "@brew-dashboard/contracts";
import type { Context } from "hono";

import { errorResponse } from "../http/errors.ts";
import type { AppEnvironment } from "../http/types.ts";
import { ProductEventRateLimitError } from "./rate-limit.ts";
import { recordProductEvent } from "./service.ts";

const validatedJson = (context: Context<AppEnvironment>): ProductEventRequest =>
  (
    context.req as unknown as {
      valid: (target: "json") => ProductEventRequest;
    }
  ).valid("json");

export const productEventHandler = async (context: Context<AppEnvironment>) => {
  const auth = context.get("auth");
  let result;
  try {
    result = await recordProductEvent(context.get("database"), {
      authUserId: auth.authUserId,
      networkId: auth.networkId,
      request: validatedJson(context),
    });
  } catch (error) {
    if (error instanceof ProductEventRateLimitError) {
      context.header("retry-after", String(error.retryAfter));
      return errorResponse(context, "RATE_LIMITED", 429, "Too many product events");
    }
    throw error;
  }
  return context.json({ data: result, meta: {}, requestId: context.get("requestId") }, 200);
};
