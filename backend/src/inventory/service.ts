import {
  inventoryMovementMutationDataSchema,
  inventoryMovementMutationSchema,
  productEventMetadataSchemas,
  type InventoryMovementMutation,
} from "@brew-dashboard/contracts";
import { and, eq, sql } from "drizzle-orm";

import { lockNetwork, type RequestTransaction } from "../db/client.ts";
import { appUsers, networks, productEvents } from "../db/schema.ts";
import { getStockStatus } from "../domain/inventory.ts";
import { claimIdempotency, hashOperationPayload } from "../domain/idempotency.ts";
import { ApiProblem } from "../http/errors.ts";
import { assertDemoDataRevision } from "../onboarding/service.ts";

export const INVENTORY_MOVEMENT_OPERATION = "inventory_movement";

export type InventoryMovementServiceHooks = {
  afterMovementApplied?: () => void | Promise<void>;
};

type MovementRow = {
  movementId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  productId: string | null;
  productName: string | null;
  locationId: string;
  locationName: string;
  unit: "pcs" | "kg" | "l";
  type: "receipt" | "writeoff";
  quantity: string;
  occurredAt: Date | string;
  onHand: string;
  minThreshold: string;
};

type QueryResult<T> = { rows: T[] };

const resultRows = <T>(result: unknown): T[] => (result as QueryResult<T>).rows;

const loadMutationData = async (
  transaction: RequestTransaction,
  networkId: string,
  movementId: string,
  demoDataRevision: number,
) => {
  const rows = resultRows<MovementRow>(
    await transaction.execute(sql`
      SELECT m.id::text AS "movementId",
             i.id::text AS "inventoryItemId",
             i.name AS "inventoryItemName",
             p.id::text AS "productId",
             p.name AS "productName",
             l.id::text AS "locationId",
             l.name AS "locationName",
             i.unit::text AS unit,
             m.type::text AS type,
             m.quantity::text AS quantity,
             m.occurred_at AS "occurredAt",
             b.on_hand::text AS "onHand",
             b.min_threshold::text AS "minThreshold"
        FROM app.inventory_movements m
        INNER JOIN app.inventory_items i
          ON i.network_id = m.network_id AND i.id = m.inventory_item_id
        LEFT JOIN app.products p
          ON p.network_id = i.network_id AND p.id = i.product_id
        INNER JOIN app.locations l
          ON l.network_id = m.network_id AND l.id = m.location_id
        INNER JOIN app.inventory_balances b
          ON b.network_id = m.network_id
         AND b.location_id = m.location_id
         AND b.inventory_item_id = m.inventory_item_id
       WHERE m.network_id = ${networkId}::uuid AND m.id = ${movementId}::uuid
       LIMIT 1
    `),
  );
  const row = rows[0];
  if (!row) throw new ApiProblem("NOT_FOUND", 404, "Inventory movement not found");
  const occurredAt =
    row.occurredAt instanceof Date
      ? row.occurredAt.toISOString()
      : new Date(row.occurredAt).toISOString();
  return inventoryMovementMutationDataSchema.parse({
    movement: {
      movementId: row.movementId,
      inventoryItemId: row.inventoryItemId,
      inventoryItemName: row.inventoryItemName,
      locationId: row.locationId,
      locationName: row.locationName,
      type: row.type,
      quantity: row.quantity,
      occurredAt,
    },
    balance: {
      inventoryItemId: row.inventoryItemId,
      inventoryItemName: row.inventoryItemName,
      productId: row.productId,
      productName: row.productName,
      locationId: row.locationId,
      locationName: row.locationName,
      unit: row.unit,
      onHand: row.onHand,
      minThreshold: row.minThreshold,
      status: getStockStatus(row.onHand, row.minThreshold),
    },
    demoDataRevision,
  });
};

const databaseProblem = (error: unknown, type: InventoryMovementMutation["type"]): never => {
  const candidate = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = candidate.code ?? candidate.cause?.code;
  const message = candidate.cause?.message ?? candidate.message;
  if (code === "23503") {
    throw new ApiProblem("NOT_FOUND", 404, "Inventory item or balance not found");
  }
  if (
    code === "23514" &&
    type === "writeoff" &&
    message?.includes("writeoff exceeds current balance")
  ) {
    throw new ApiProblem("CONFLICT", 409, "Write off exceeds current balance", {
      quantity: ["Quantity exceeds the current balance"],
    });
  }
  if (code === "23514") {
    throw new ApiProblem("CONFLICT", 409, "Inventory balance limit exceeded", {
      quantity: ["Quantity exceeds the supported inventory balance range"],
    });
  }
  if (code === "22023") {
    throw new ApiProblem("VALIDATION_ERROR", 400, "Invalid inventory quantity", {
      quantity: [message ?? "Quantity is invalid"],
    });
  }
  throw error;
};

export const createInventoryMovement = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    request: InventoryMovementMutation;
    hooks?: InventoryMovementServiceHooks;
  },
) => {
  const request = inventoryMovementMutationSchema.parse(input.request);
  await lockNetwork(transaction, input.networkId);

  const networkRows = await transaction
    .select({ demoDataRevision: networks.demoDataRevision })
    .from(networks)
    .where(eq(networks.id, input.networkId))
    .for("update")
    .limit(1);
  const network = networkRows[0];
  if (!network) throw new ApiProblem("NOT_FOUND", 404, "Inventory item or balance not found");
  assertDemoDataRevision(network.demoDataRevision, request.expectedDemoDataRevision);

  const requestHash = await hashOperationPayload(INVENTORY_MOVEMENT_OPERATION, {
    inventoryItemId: request.inventoryItemId,
    locationId: request.locationId,
    type: request.type,
    quantity: request.quantity,
    expectedDemoDataRevision: request.expectedDemoDataRevision,
  });
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: request.idempotencyKey,
    operation: INVENTORY_MOVEMENT_OPERATION,
    requestHash,
  });
  if (claim.replay) {
    if (!claim.resourceId) throw new Error("Completed inventory operation has no movement");
    return loadMutationData(
      transaction,
      input.networkId,
      claim.resourceId,
      network.demoDataRevision,
    );
  }

  const userRows = await transaction
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.networkId, input.networkId), eq(appUsers.authUserId, input.authUserId)))
    .limit(1);
  const user = userRows[0];
  if (!user) throw new Error("Authenticated app user is unavailable");

  const now = new Date();
  let movementId: string;
  try {
    const applied = resultRows<{ movementId: string }>(
      await transaction.execute(sql`
        SELECT movement_id::text AS "movementId"
          FROM app.apply_inventory_movement(
            ${request.locationId}::uuid,
            ${request.inventoryItemId}::uuid,
            ${request.type}::app.movement_type,
            ${request.quantity}::numeric,
            ${requestHash}::varchar(64),
            ${request.idempotencyKey}::uuid,
            ${now}::timestamptz
          )
      `),
    );
    movementId = applied[0]?.movementId ?? "";
  } catch (error) {
    return databaseProblem(error, request.type);
  }
  if (!movementId) throw new Error("Inventory movement was not created");

  const data = await loadMutationData(
    transaction,
    input.networkId,
    movementId,
    network.demoDataRevision,
  );
  await input.hooks?.afterMovementApplied?.();
  await transaction.insert(productEvents).values({
    id: crypto.randomUUID(),
    networkId: input.networkId,
    userId: user.id,
    type: "inventory_movement_created",
    route: "inventory",
    metadata: productEventMetadataSchemas.inventory_movement_created.parse({
      inventoryItemId: request.inventoryItemId,
      locationId: request.locationId,
      type: request.type,
    }),
    occurredAt: now,
  });
  return data;
};
