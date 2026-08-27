import { priceMutationResponseSchema, type PriceMutation } from "@brew-dashboard/contracts";
import type { Context } from "hono";

import type { AppEnvironment } from "../http/types.ts";
import { updateProductPrice } from "./service.ts";

const validated = <T>(context: Context<AppEnvironment>, target: "json" | "param"): T =>
  (context.req as unknown as { valid: (value: "json" | "param") => T }).valid(target);

export const productPriceHandler = async (context: Context<AppEnvironment>) => {
  const request = validated<PriceMutation>(context, "json");
  const { productId } = validated<{ productId: string }>(context, "param");
  const auth = context.get("auth");
  const data = await updateProductPrice(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    productId,
    request,
  });
  const response = { data, meta: {}, requestId: context.get("requestId") };
  priceMutationResponseSchema.parse(response);
  return context.json(response, 200);
};
