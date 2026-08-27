import { and, eq } from "drizzle-orm";

import { idempotencyKeys } from "../db/schema.ts";
import type { RequestTransaction } from "../db/client.ts";

export class OperationConflictError extends Error {
  constructor(message = "Idempotency key was already used for another operation") {
    super(message);
    this.name = "OperationConflictError";
  }
}

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") {
    if (value instanceof Date) return value.toISOString();
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

const encodeCanonical = (value: unknown): string => JSON.stringify(canonicalize(value));

export const hashOperationPayload = async (
  operation: string,
  payload: unknown,
): Promise<string> => {
  const encoded = new TextEncoder().encode(
    JSON.stringify({ operation, payload: JSON.parse(encodeCanonical(payload)) }),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export type IdempotencyClaim = {
  id: string;
  operation: string;
  requestHash: string;
  completedAt: Date | null;
  resourceId: string | null;
  replay: boolean;
};

export const claimIdempotency = async (
  transaction: RequestTransaction,
  input: {
    networkId: string;
    key: string;
    operation: string;
    requestHash: string;
  },
): Promise<IdempotencyClaim> => {
  await transaction
    .insert(idempotencyKeys)
    .values({
      networkId: input.networkId,
      key: input.key,
      operation: input.operation,
      requestHash: input.requestHash,
    })
    .onConflictDoNothing({ target: [idempotencyKeys.networkId, idempotencyKeys.key] });

  const rows = await transaction
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.networkId, input.networkId), eq(idempotencyKeys.key, input.key)))
    .for("update");
  const row = rows[0];
  if (!row) throw new Error("Failed to claim idempotency key");
  if (row.operation !== input.operation || row.requestHash !== input.requestHash) {
    throw new OperationConflictError();
  }

  return {
    id: row.id,
    operation: row.operation,
    requestHash: row.requestHash,
    completedAt: row.completedAt,
    resourceId: row.resourceId,
    replay: Boolean(row.completedAt),
  };
};

export const completeIdempotency = async (
  transaction: RequestTransaction,
  input: { id: string; resourceId: string; completedAt?: Date },
) => {
  await transaction
    .update(idempotencyKeys)
    .set({
      resourceId: input.resourceId,
      completedAt: input.completedAt ?? new Date(),
      updatedAt: input.completedAt ?? new Date(),
    })
    .where(eq(idempotencyKeys.id, input.id));
};
