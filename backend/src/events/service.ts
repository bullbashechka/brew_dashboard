import {
  productEventRequestSchema,
  serverProductEventRequestSchema,
  type ProductEventRequest,
  type ProductEventType,
  type ServerProductEventRequest,
} from "@brew-dashboard/contracts";
import { and, eq } from "drizzle-orm";

import { lockProductEvent, type RequestTransaction } from "../db/client.ts";
import { appUsers, productEvents } from "../db/schema.ts";
import { ApiProblem } from "../http/errors.ts";
import { consumeProductEventRateLimit } from "./rate-limit.ts";

type EventPayload = {
  eventId: string;
  type: ProductEventType;
  route?: string;
  metadata: Record<string, unknown>;
};

const sameEvent = (stored: typeof productEvents.$inferSelect, request: EventPayload): boolean =>
  stored.type === request.type &&
  stored.route === (request.route ?? null) &&
  JSON.stringify(stored.metadata) === JSON.stringify(request.metadata);

const appUserForEvent = async (
  transaction: RequestTransaction,
  authUserId: string,
  networkId: string,
) => {
  const rows = await transaction
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.authUserId, authUserId), eq(appUsers.networkId, networkId)))
    .limit(1);
  const user = rows[0];
  if (!user) throw new ApiProblem("FORBIDDEN", 403, "The account does not own this network");
  return user;
};

const insertProductEvent = async (
  transaction: RequestTransaction,
  input: {
    userId: string;
    networkId: string;
    payload: EventPayload;
    occurredAt: Date;
  },
) => {
  const inserted = await transaction
    .insert(productEvents)
    .values({
      id: input.payload.eventId,
      networkId: input.networkId,
      userId: input.userId,
      type: input.payload.type,
      route: input.payload.route ?? null,
      metadata: input.payload.metadata,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing({ target: productEvents.id })
    .returning({ id: productEvents.id });
  return Boolean(inserted[0]);
};

const eventForTenant = async (
  transaction: RequestTransaction,
  eventId: string,
  networkId: string,
) => {
  const rows = await transaction
    .select()
    .from(productEvents)
    .where(and(eq(productEvents.id, eventId), eq(productEvents.networkId, networkId)))
    .limit(1);
  return rows[0];
};

/** Record the restricted browser telemetry contract. */
export const recordProductEvent = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    request: ProductEventRequest;
    occurredAt?: Date;
  },
) => {
  const request = productEventRequestSchema.parse(input.request);
  const user = await appUserForEvent(transaction, input.authUserId, input.networkId);
  await lockProductEvent(transaction, request.eventId);

  const existing = await eventForTenant(transaction, request.eventId, input.networkId);
  const payload: EventPayload = {
    eventId: request.eventId,
    type: request.type,
    ...(request.route ? { route: request.route } : {}),
    metadata: request.metadata,
  };
  if (existing) {
    if (!sameEvent(existing, payload)) {
      throw new ApiProblem("CONFLICT", 409, "Event ID was already used for another event");
    }
    return { eventId: request.eventId };
  }

  const occurredAt = input.occurredAt ?? new Date();
  await consumeProductEventRateLimit(transaction, input.networkId, occurredAt);
  const inserted = await insertProductEvent(transaction, {
    userId: user.id,
    networkId: input.networkId,
    payload,
    occurredAt,
  });
  if (inserted) return { eventId: request.eventId };

  const existingAfterInsert = await eventForTenant(transaction, request.eventId, input.networkId);
  if (!existingAfterInsert || !sameEvent(existingAfterInsert, payload)) {
    throw new ApiProblem("CONFLICT", 409, "Event ID was already used for another event");
  }
  return { eventId: request.eventId };
};

/** Record a business event from a trusted server mutation/auth path. */
export const recordServerProductEvent = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    type: ServerProductEventRequest["type"];
    route?: ServerProductEventRequest["route"];
    metadata: ServerProductEventRequest["metadata"];
    occurredAt?: Date;
  },
) => {
  const request = serverProductEventRequestSchema.parse({
    type: input.type,
    ...(input.route ? { route: input.route } : {}),
    metadata: input.metadata,
  });
  const user = await appUserForEvent(transaction, input.authUserId, input.networkId);
  const payload: EventPayload = {
    eventId: crypto.randomUUID(),
    type: request.type,
    ...(request.route ? { route: request.route } : {}),
    metadata: request.metadata,
  };
  await insertProductEvent(transaction, {
    userId: user.id,
    networkId: input.networkId,
    payload,
    occurredAt: input.occurredAt ?? new Date(),
  });
  return { eventId: payload.eventId };
};
