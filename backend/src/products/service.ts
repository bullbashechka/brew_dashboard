import { priceMutationSchema, type PriceMutation } from "@brew-dashboard/contracts";
import { and, eq } from "drizzle-orm";

import { lockNetwork, type RequestTransaction } from "../db/client.ts";
import { idempotencyKeys, networks, products } from "../db/schema.ts";
import { calculateCurrentUnitMargin } from "../domain/metrics.ts";
import { subtract, parseDecimal, toMoney } from "../domain/decimal.ts";
import {
  claimIdempotency,
  completeIdempotency,
  hashOperationPayload,
} from "../domain/idempotency.ts";
import { assertDemoDataRevision } from "../onboarding/service.ts";
import { ApiProblem } from "../http/errors.ts";
import { recordServerProductEvent } from "../events/service.ts";

export const PRODUCT_PRICE_OPERATION = "products.price";

const priceData = (
  product: Pick<
    typeof products.$inferSelect,
    "id" | "currentPrice" | "currentUnitCost" | "version"
  >,
  demoDataRevision: number,
) => ({
  productId: product.id,
  currentPrice: product.currentPrice,
  currentUnitCost: product.currentUnitCost,
  unitContribution: toMoney(
    subtract(parseDecimal(product.currentPrice), parseDecimal(product.currentUnitCost)),
  ),
  currentUnitMargin: calculateCurrentUnitMargin(product.currentPrice, product.currentUnitCost),
  version: product.version,
  demoDataRevision,
});

export const updateProductPrice = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    productId: string;
    request: PriceMutation;
  },
) => {
  const request = priceMutationSchema.parse(input.request);
  await lockNetwork(transaction, input.networkId);

  const network = await transaction
    .select({ demoDataRevision: networks.demoDataRevision })
    .from(networks)
    .where(eq(networks.id, input.networkId))
    .for("update")
    .limit(1);
  const currentNetwork = network[0];
  if (!currentNetwork) throw new ApiProblem("NOT_FOUND", 404, "Product not found");
  assertDemoDataRevision(currentNetwork.demoDataRevision, request.expectedDemoDataRevision);

  const productRows = await transaction
    .select()
    .from(products)
    .where(and(eq(products.networkId, input.networkId), eq(products.id, input.productId)))
    .for("update")
    .limit(1);
  const product = productRows[0];
  if (!product) throw new ApiProblem("NOT_FOUND", 404, "Product not found");

  const requestHash = await hashOperationPayload(PRODUCT_PRICE_OPERATION, {
    productId: input.productId,
    price: request.price,
    expectedVersion: request.expectedVersion,
    expectedDemoDataRevision: request.expectedDemoDataRevision,
  });
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: request.idempotencyKey,
    operation: PRODUCT_PRICE_OPERATION,
    requestHash,
  });
  if (claim.replay) {
    // A replay must describe the operation that was already committed, even if
    // another request changed the product after that operation completed.
    return priceData(
      { ...product, currentPrice: request.price, version: request.expectedVersion + 1 },
      currentNetwork.demoDataRevision,
    );
  }

  if (product.version !== request.expectedVersion) {
    throw new ApiProblem("CONFLICT", 409, "Product price changed in another tab", {
      expectedVersion: ["Reload the latest product before saving"],
    });
  }
  if (product.currentPrice === request.price) {
    await transaction.delete(idempotencyKeys).where(eq(idempotencyKeys.id, claim.id));
    throw new ApiProblem("CONFLICT", 409, "Product price is already current");
  }

  const now = new Date();
  const updated = await transaction
    .update(products)
    .set({ currentPrice: request.price, version: product.version + 1, updatedAt: now })
    .where(and(eq(products.networkId, input.networkId), eq(products.id, input.productId)))
    .returning();
  const updatedProduct = updated[0];
  if (!updatedProduct) throw new ApiProblem("NOT_FOUND", 404, "Product not found");

  await recordServerProductEvent(transaction, {
    authUserId: input.authUserId,
    networkId: input.networkId,
    type: "product_price_changed",
    route: "products",
    metadata: { productId: updatedProduct.id },
    occurredAt: now,
  });
  await completeIdempotency(transaction, {
    id: claim.id,
    resourceId: updatedProduct.id,
    completedAt: now,
  });

  return priceData(updatedProduct, currentNetwork.demoDataRevision);
};
