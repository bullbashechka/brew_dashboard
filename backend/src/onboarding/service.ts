import {
  onboardingRequestSchema,
  type DemoCounts,
  type DemoGeneration,
  type OnboardingRequest,
} from "@brew-dashboard/contracts";
import { and, asc, count, eq, sql } from "drizzle-orm";

import { localDateKey } from "../domain/periods.ts";
import {
  DEMO_GENERATOR_VERSION,
  generateDemoData,
  type GeneratedDemoData,
  type GeneratorLocation,
} from "../domain/demo-generator.ts";
import {
  claimIdempotency,
  completeIdempotency,
  hashOperationPayload,
} from "../domain/idempotency.ts";
import {
  lockAuthUser,
  lockNetwork,
  setAuthUserContext,
  setTenantContext,
  type RequestTransaction,
} from "../db/client.ts";
import {
  categories,
  demoGenerations,
  inventoryBalances,
  inventoryItems,
  inventoryMovements,
  appUsers,
  locations,
  networks,
  orderItems,
  orders,
  products,
  revenueTargets,
} from "../db/schema.ts";
import { ApiProblem } from "../http/errors.ts";
import { recordServerProductEvent } from "../events/service.ts";

export const ONBOARDING_LANGUAGE_OPERATION = "onboarding.language";
export const ONBOARDING_COMPLETE_OPERATION = "onboarding.complete";
export const DEMO_RESET_OPERATION = "demo.reset";

export const assertDemoDataRevision = (actual: number, expected: number): void => {
  if (actual !== expected) {
    throw new ApiProblem(
      "CONFLICT",
      409,
      "Demo data changed in another tab; review the current values and try again",
    );
  }
};

export type OnboardingServiceHooks = {
  afterPhase?: (phase: string) => void | Promise<void>;
};

type StoredNetwork = typeof networks.$inferSelect;

const assertAccountNetwork = async (
  transaction: RequestTransaction,
  authUserId: string,
  networkId: string,
  options: { revalidate?: boolean; now?: Date } = {},
) => {
  await setAuthUserContext(transaction, authUserId);
  const rows = await transaction
    .select({ id: appUsers.id, status: appUsers.status, expiresAt: appUsers.expiresAt })
    .from(appUsers)
    .where(and(eq(appUsers.authUserId, authUserId), eq(appUsers.networkId, networkId)))
    .for("update");
  const account = rows[0];
  if (!account) throw new ApiProblem("FORBIDDEN", 403, "The account does not own this network");
  if (options.revalidate) {
    const now = options.now ?? new Date();
    if (account.status !== "active" || (account.expiresAt && account.expiresAt <= now)) {
      throw new ApiProblem("UNAUTHENTICATED", 401, "The authenticated session has expired");
    }
  }
};

const selectNetworkForUpdate = async (
  transaction: RequestTransaction,
  networkId: string,
): Promise<StoredNetwork> => {
  const rows = await transaction
    .select()
    .from(networks)
    .where(eq(networks.id, networkId))
    .for("update");
  const network = rows[0];
  if (!network) throw new ApiProblem("NOT_FOUND", 404, "Network was not found");
  return network;
};

const normalizedOnboardingPayload = (input: OnboardingRequest) => ({
  networkName: input.networkName
    .normalize("NFC")
    .replace(/\p{White_Space}+/gu, " ")
    .trim(),
  ownerName: input.ownerName
    .normalize("NFC")
    .replace(/\p{White_Space}+/gu, " ")
    .trim(),
  locations: input.locations.map(({ name }) => ({
    name: name
      .normalize("NFC")
      .replace(/\p{White_Space}+/gu, " ")
      .trim(),
  })),
  country: input.country,
  currency: input.currency,
  timeZone: input.timeZone,
});

const locationInputs = (
  networkId: string,
  input: ReturnType<typeof normalizedOnboardingPayload>,
): { id: string; networkId: string; name: string; nameNormalized: string; sortOrder: number }[] =>
  input.locations.map(({ name }, sortOrder) => ({
    id: crypto.randomUUID(),
    networkId,
    name,
    nameNormalized: name.normalize("NFKC").toLowerCase(),
    sortOrder,
  }));

const countForNetwork = async (
  transaction: RequestTransaction,
  table:
    | typeof locations
    | typeof categories
    | typeof products
    | typeof orders
    | typeof orderItems
    | typeof inventoryItems
    | typeof inventoryBalances
    | typeof inventoryMovements
    | typeof revenueTargets,
  networkId: string,
): Promise<number> => {
  const result = await transaction
    .select({ value: count() })
    .from(table)
    .where(eq(table.networkId, networkId));
  return Number(result[0]?.value ?? 0);
};

export const getDemoCounts = async (
  transaction: RequestTransaction,
  networkId: string,
): Promise<DemoCounts> => {
  const locationCount = await countForNetwork(transaction, locations, networkId);
  const categoryCount = await countForNetwork(transaction, categories, networkId);
  const productCount = await countForNetwork(transaction, products, networkId);
  const orderCount = await countForNetwork(transaction, orders, networkId);
  const orderItemCount = await countForNetwork(transaction, orderItems, networkId);
  const inventoryItemCount = await countForNetwork(transaction, inventoryItems, networkId);
  const balanceCount = await countForNetwork(transaction, inventoryBalances, networkId);
  const movementCount = await countForNetwork(transaction, inventoryMovements, networkId);
  const targetCount = await countForNetwork(transaction, revenueTargets, networkId);
  return {
    locations: locationCount,
    categories: categoryCount,
    products: productCount,
    orders: orderCount,
    orderItems: orderItemCount,
    inventoryItems: inventoryItemCount,
    inventoryBalances: balanceCount,
    inventoryMovements: movementCount,
    revenueTargets: targetCount,
  };
};

const generationForNetwork = async (transaction: RequestTransaction, network: StoredNetwork) => {
  if (!network.demoGeneratedForDate) {
    throw new ApiProblem("CONFLICT", 409, "Demo data has not been generated");
  }
  const rows = await transaction
    .select()
    .from(demoGenerations)
    .where(
      and(
        eq(demoGenerations.networkId, network.id),
        eq(demoGenerations.generatedForDate, network.demoGeneratedForDate),
      ),
    )
    .limit(1);
  const generation = rows[0];
  if (!generation) throw new ApiProblem("INTERNAL_ERROR", 500, "Demo generation anchor is missing");
  return generation;
};

export const buildGenerationResult = async (
  transaction: RequestTransaction,
  network: StoredNetwork,
  now: Date,
): Promise<{ generation: DemoGeneration; counts: DemoCounts }> => {
  const generation = await generationForNetwork(transaction, network);
  const stale =
    Boolean(network.timezone && network.demoGeneratedForDate) &&
    network.demoGeneratedForDate !== localDateKey(now, network.timezone!);
  return {
    generation: {
      version: generation.version,
      generatedForDate: generation.generatedForDate,
      anchor: generation.createdAt.toISOString(),
      seed: generation.seed,
      revision: network.demoDataRevision,
      stale,
    },
    counts: await getDemoCounts(transaction, network.id),
  };
};

const baselineRows = (data: GeneratedDemoData) =>
  data.inventoryBalances.map((balance) => {
    const movement = data.inventoryMovements.find(
      (candidate) =>
        candidate.locationId === balance.locationId &&
        candidate.inventoryItemId === balance.inventoryItemId,
    );
    if (!movement) throw new Error("Inventory baseline movement is missing");
    return {
      balance_id: balance.id,
      movement_id: movement.id,
      location_id: balance.locationId,
      inventory_item_id: balance.inventoryItemId,
      baseline_quantity: balance.baselineQuantity,
      consumed_quantity: balance.consumedQuantity,
      on_hand: balance.onHand,
      min_threshold: balance.minThreshold,
      occurred_at: movement.occurredAt.toISOString(),
    };
  });

const writeInventoryBaseline = async (transaction: RequestTransaction, data: GeneratedDemoData) => {
  await transaction.execute(
    sql`select app.replace_inventory_baseline(${JSON.stringify(baselineRows(data))}::jsonb, ${data.anchor})`,
  );
};

const writeDemoData = async (
  transaction: RequestTransaction,
  data: GeneratedDemoData,
  hooks?: OnboardingServiceHooks,
) => {
  await transaction.insert(categories).values(data.categories);
  await hooks?.afterPhase?.("categories");
  await transaction.insert(products).values(data.products);
  await hooks?.afterPhase?.("products");
  await transaction.insert(orders).values(data.orders);
  await transaction.insert(orderItems).values(data.orderItems);
  await hooks?.afterPhase?.("orders");
  await transaction.insert(inventoryItems).values(data.inventoryItems);
  await writeInventoryBaseline(transaction, data);
  await hooks?.afterPhase?.("inventory");
  await transaction.insert(revenueTargets).values(data.revenueTargets);
  await hooks?.afterPhase?.("goal");
};

export const clearDemoData = async (transaction: RequestTransaction, networkId: string) => {
  await transaction.delete(orderItems).where(eq(orderItems.networkId, networkId));
  await transaction.delete(orders).where(eq(orders.networkId, networkId));
  await transaction.execute(sql`select app.clear_inventory_baseline()`);
  await transaction.delete(inventoryItems).where(eq(inventoryItems.networkId, networkId));
  await transaction.delete(products).where(eq(products.networkId, networkId));
  await transaction.delete(categories).where(eq(categories.networkId, networkId));
  await transaction.delete(revenueTargets).where(eq(revenueTargets.networkId, networkId));
};

const locationsForGenerator = async (
  transaction: RequestTransaction,
  networkId: string,
): Promise<GeneratorLocation[]> => {
  const rows = await transaction
    .select({ id: locations.id, name: locations.name, sortOrder: locations.sortOrder })
    .from(locations)
    .where(eq(locations.networkId, networkId))
    .orderBy(asc(locations.sortOrder), asc(locations.id));
  return rows;
};

const currentResultForNetwork = async (
  transaction: RequestTransaction,
  network: StoredNetwork,
  now: Date,
) => buildGenerationResult(transaction, network, now);

export const setOnboardingLanguage = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    language: "en" | "ru";
    idempotencyKey: string;
  },
) => {
  await lockAuthUser(transaction, input.authUserId);
  await assertAccountNetwork(transaction, input.authUserId, input.networkId);
  await lockNetwork(transaction, input.networkId);
  await assertAccountNetwork(transaction, input.authUserId, input.networkId, { revalidate: true });
  await setTenantContext(transaction, input.networkId);
  const network = await selectNetworkForUpdate(transaction, input.networkId);
  const requestHash = await hashOperationPayload(ONBOARDING_LANGUAGE_OPERATION, {
    language: input.language,
  });
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: input.idempotencyKey,
    operation: ONBOARDING_LANGUAGE_OPERATION,
    requestHash,
  });
  if (claim.replay) {
    return { language: input.language, effectiveLanguage: input.language };
  }
  if (network.onboardingCompletedAt) {
    throw new ApiProblem("CONFLICT", 409, "Onboarding has already been completed");
  }

  await transaction
    .update(networks)
    .set({ language: input.language, updatedAt: new Date() })
    .where(eq(networks.id, input.networkId));
  await completeIdempotency(transaction, {
    id: claim.id,
    resourceId: input.networkId,
  });
  return { language: input.language, effectiveLanguage: input.language };
};

export const completeOnboarding = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    request: OnboardingRequest;
    startedAt?: Date;
    hooks?: OnboardingServiceHooks;
  },
) => {
  const startedAt = input.startedAt ?? new Date();
  const parsed = onboardingRequestSchema.parse(input.request);
  const normalized = normalizedOnboardingPayload(parsed);
  await lockAuthUser(transaction, input.authUserId);
  await assertAccountNetwork(transaction, input.authUserId, input.networkId);
  await lockNetwork(transaction, input.networkId);
  await assertAccountNetwork(transaction, input.authUserId, input.networkId, { revalidate: true });
  await setTenantContext(transaction, input.networkId);
  let network = await selectNetworkForUpdate(transaction, input.networkId);
  const requestHash = await hashOperationPayload(ONBOARDING_COMPLETE_OPERATION, normalized);
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: parsed.idempotencyKey,
    operation: ONBOARDING_COMPLETE_OPERATION,
    requestHash,
  });

  if (claim.replay) return currentResultForNetwork(transaction, network, startedAt);
  if (network.onboardingCompletedAt) {
    await completeIdempotency(transaction, { id: claim.id, resourceId: input.networkId });
    return currentResultForNetwork(transaction, network, startedAt);
  }
  if (!network.language) {
    throw new ApiProblem("CONFLICT", 409, "Select a language before completing onboarding");
  }

  const storedLocations = locationInputs(input.networkId, normalized);
  await transaction.insert(locations).values(storedLocations);
  await input.hooks?.afterPhase?.("locations");

  const localDate = localDateKey(startedAt, normalized.timeZone);
  const data = await generateDemoData({
    version: DEMO_GENERATOR_VERSION,
    networkId: input.networkId,
    localDate,
    timeZone: normalized.timeZone,
    anchor: startedAt,
    locations: storedLocations,
  });
  await input.hooks?.afterPhase?.("generated");
  await writeDemoData(transaction, data, input.hooks);

  await transaction.insert(demoGenerations).values({
    id: data.generationId,
    networkId: input.networkId,
    generatedForDate: data.generatedForDate,
    seed: data.seed,
    version: data.version,
    createdAt: data.anchor,
  });
  await input.hooks?.afterPhase?.("generation");

  await transaction
    .update(networks)
    .set({
      name: normalized.networkName,
      ownerName: normalized.ownerName,
      countryCode: normalized.country,
      currencyCode: normalized.currency,
      timezone: normalized.timeZone,
      demoGeneratorVersion: data.version,
      demoGeneratedForDate: data.generatedForDate,
      demoDataRevision: 1,
      updatedAt: new Date(),
    })
    .where(eq(networks.id, input.networkId));
  await input.hooks?.afterPhase?.("network");

  await transaction
    .update(networks)
    .set({ onboardingCompletedAt: startedAt, updatedAt: new Date() })
    .where(eq(networks.id, input.networkId));
  await input.hooks?.afterPhase?.("completion-marker");
  await recordServerProductEvent(transaction, {
    authUserId: input.authUserId,
    networkId: input.networkId,
    type: "onboarding_completed",
    route: "overview",
    metadata: { locationCount: storedLocations.length },
    occurredAt: startedAt,
  });
  await completeIdempotency(transaction, { id: claim.id, resourceId: input.networkId });

  network = await selectNetworkForUpdate(transaction, input.networkId);
  return currentResultForNetwork(transaction, network, startedAt);
};

export const resetDemoData = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    idempotencyKey: string;
    startedAt?: Date;
    hooks?: OnboardingServiceHooks;
  },
) => {
  const startedAt = input.startedAt ?? new Date();
  await lockAuthUser(transaction, input.authUserId);
  await assertAccountNetwork(transaction, input.authUserId, input.networkId);
  await lockNetwork(transaction, input.networkId);
  await assertAccountNetwork(transaction, input.authUserId, input.networkId, { revalidate: true });
  await setTenantContext(transaction, input.networkId);
  let network = await selectNetworkForUpdate(transaction, input.networkId);
  if (!network.onboardingCompletedAt || !network.timezone || !network.demoGeneratorVersion) {
    throw new ApiProblem("CONFLICT", 409, "Completed onboarding is required before Reset");
  }
  const requestHash = await hashOperationPayload(DEMO_RESET_OPERATION, {});
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: input.idempotencyKey,
    operation: DEMO_RESET_OPERATION,
    requestHash,
  });
  if (claim.replay) return currentResultForNetwork(transaction, network, startedAt);
  if (network.demoGeneratorVersion !== DEMO_GENERATOR_VERSION) {
    throw new ApiProblem("CONFLICT", 409, "This demo generator version is no longer supported");
  }

  const localDate = localDateKey(startedAt, network.timezone);
  const existingGeneration = await transaction
    .select()
    .from(demoGenerations)
    .where(
      and(
        eq(demoGenerations.networkId, input.networkId),
        eq(demoGenerations.generatedForDate, localDate),
      ),
    )
    .limit(1);
  const anchor = existingGeneration[0]?.createdAt ?? startedAt;
  const generatorLocations = await locationsForGenerator(transaction, input.networkId);
  const data = await generateDemoData({
    version: network.demoGeneratorVersion,
    networkId: input.networkId,
    localDate,
    timeZone: network.timezone,
    anchor,
    locations: generatorLocations,
  });
  await input.hooks?.afterPhase?.("generated");
  await clearDemoData(transaction, input.networkId);
  await input.hooks?.afterPhase?.("cleared");
  await writeDemoData(transaction, data, input.hooks);
  if (!existingGeneration[0]) {
    await transaction.insert(demoGenerations).values({
      id: data.generationId,
      networkId: input.networkId,
      generatedForDate: data.generatedForDate,
      seed: data.seed,
      version: data.version,
      createdAt: data.anchor,
    });
  }
  await input.hooks?.afterPhase?.("generation");

  await transaction
    .update(networks)
    .set({
      demoGeneratedForDate: data.generatedForDate,
      demoDataRevision: Math.max(1, network.demoDataRevision + 1),
      updatedAt: new Date(),
    })
    .where(eq(networks.id, input.networkId));
  await input.hooks?.afterPhase?.("network");
  await recordServerProductEvent(transaction, {
    authUserId: input.authUserId,
    networkId: input.networkId,
    type: "demo_reset",
    route: "settings",
    metadata: { generatorVersion: data.version },
    occurredAt: startedAt,
  });
  await completeIdempotency(transaction, { id: claim.id, resourceId: input.networkId });
  network = await selectNetworkForUpdate(transaction, input.networkId);
  return currentResultForNetwork(transaction, network, startedAt);
};
