import {
  inventoryResponseSchema,
  locationsResponseSchema,
  overviewResponseSchema,
  productsResponseSchema,
  salesResponseSchema,
} from "@brew-dashboard/contracts";
import type { Context } from "hono";

import { multiply, parseDecimal, toMoney } from "../domain/decimal.ts";
import { calculateFinancialMetrics } from "../domain/metrics.ts";
import type { AnalyticsPeriod } from "../domain/periods.ts";
import { ApiProblem } from "../http/errors.ts";
import type { AppEnvironment } from "../http/types.ts";
import {
  buildAnalyticsSnapshot,
  buildAnalyticsMeta,
  buildInventory,
  buildLocations,
  buildOverview,
  buildProducts,
  buildSales,
  paginationDefaults,
  type AnalyticsContext,
} from "./service.ts";

type ContinuationPayload = {
  version: 1;
  kind: "cursor" | "page";
  endpoint: "sales" | "inventory";
  networkId: string;
  revision: number;
  period: AnalyticsPeriod;
  locationId: string | null;
  asOf: string;
  start: string;
  end: string;
  comparisonStart: string;
  comparisonEnd: string;
  status: AnalyticsContext["status"];
  pageSize: number;
  page?: number;
  lastAt?: string;
  lastId?: string;
};

const encoder = new TextEncoder();

const base64UrlEncode = (bytes: Uint8Array): string => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

const base64UrlDecode = (value: string): Uint8Array => {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const signatureKey = async (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(`brew-dashboard:analytics-cursor:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const tokenBytes = (payload: ContinuationPayload) =>
  base64UrlEncode(encoder.encode(JSON.stringify(payload)));

export const signContinuation = async (
  payload: ContinuationPayload,
  secret: string,
): Promise<string> => {
  const encoded = tokenBytes(payload);
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signatureKey(secret),
    encoder.encode(encoded),
  );
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
};

export const verifyContinuation = async (
  token: string,
  secret: string,
): Promise<ContinuationPayload> => {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error("Malformed continuation");
    const [encoded, signature] = parts;
    if (!encoded || !signature) throw new Error("Malformed continuation");
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signatureKey(secret),
      base64UrlDecode(signature).buffer as ArrayBuffer,
      encoder.encode(encoded),
    );
    if (!valid) throw new Error("Invalid continuation");
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encoded)),
    ) as ContinuationPayload;
    if (payload.version !== 1 || (payload.kind !== "cursor" && payload.kind !== "page"))
      throw new Error("Invalid continuation payload");
    return payload;
  } catch {
    throw new ApiProblem("VALIDATION_ERROR", 400, "Invalid pagination context");
  }
};

const query = <T>(context: Context<AppEnvironment>): T =>
  (context.req as unknown as { valid: (target: "query") => T }).valid("query");

const authOptions = (
  context: Context<AppEnvironment>,
  period: AnalyticsPeriod,
  locationId?: string,
  asOf?: Date,
) => {
  const options: {
    networkId: string;
    timeZone: string;
    period: AnalyticsPeriod;
    locationId?: string;
    asOf?: Date;
    status?: Exclude<AnalyticsContext["status"], null>;
    sortBy?: Exclude<AnalyticsContext["sortBy"], null>;
    sortDir?: Exclude<AnalyticsContext["sortDir"], null>;
  } = {
    networkId: context.get("auth").networkId,
    timeZone: context.get("auth").profile.timeZone!,
    period,
  };
  if (locationId !== undefined) options.locationId = locationId;
  if (asOf !== undefined) options.asOf = asOf;
  return options;
};

const compareContinuation = (
  context: AnalyticsContext,
  payload: ContinuationPayload,
  endpoint: ContinuationPayload["endpoint"],
  secret: string,
) => {
  if (
    payload.endpoint !== endpoint ||
    payload.networkId !== context.snapshot.networkId ||
    payload.revision !== context.snapshot.revision ||
    payload.period !== context.period ||
    payload.locationId !== context.locationId ||
    payload.asOf !== context.asOf.toISOString() ||
    payload.start !== context.window.start.toISOString() ||
    payload.end !== context.window.end.toISOString() ||
    payload.comparisonStart !== context.window.comparisonStart.toISOString() ||
    payload.comparisonEnd !== context.window.comparisonEnd.toISOString() ||
    payload.status !== context.status ||
    !secret
  ) {
    if (payload.revision !== context.snapshot.revision)
      throw new ApiProblem("CONFLICT", 409, "Analytics data revision changed");
    throw new ApiProblem("VALIDATION_ERROR", 400, "Pagination context does not match filters");
  }
};

const assertContinuationPageSize = (
  continuation: ContinuationPayload | null,
  requestedPageSize: number | undefined,
) => {
  if (
    continuation &&
    requestedPageSize !== undefined &&
    requestedPageSize !== continuation.pageSize
  ) {
    throw new ApiProblem("VALIDATION_ERROR", 400, "Page size does not match pagination context");
  }
};

const basePayload = (
  context: AnalyticsContext,
  kind: ContinuationPayload["kind"],
  endpoint: ContinuationPayload["endpoint"],
  size: number,
): ContinuationPayload => ({
  version: 1,
  kind,
  endpoint,
  networkId: context.snapshot.networkId,
  revision: context.snapshot.revision,
  period: context.period,
  locationId: context.locationId,
  asOf: context.asOf.toISOString(),
  start: context.window.start.toISOString(),
  end: context.window.end.toISOString(),
  comparisonStart: context.window.comparisonStart.toISOString(),
  comparisonEnd: context.window.comparisonEnd.toISOString(),
  status: context.status,
  pageSize: size,
});

const locationName = (context: AnalyticsContext, id: string) =>
  context.snapshot.locations.find((location) => location.id === id)?.name ?? "";

const productName = (context: AnalyticsContext, id: string) =>
  context.snapshot.products.find((product) => product.id === id)?.name ?? "";

const serializeRecent = (
  context: AnalyticsContext,
  orders: Awaited<ReturnType<typeof buildSales>>["recent"],
) =>
  orders.map((order) => ({
    orderId: order.id,
    locationId: order.locationId,
    locationName: locationName(context, order.locationId),
    occurredAt: order.orderedAt.toISOString(),
    status: order.status,
    total: orderFinancialTotal(order),
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: productName(context, item.productId),
      quantity: item.quantity,
      unitPriceAtSale: item.unitPriceAtSale,
      lineRevenue: lineRevenue(item.quantity, item.unitPriceAtSale),
    })),
  }));

const orderFinancialTotal = (order: Awaited<ReturnType<typeof buildSales>>["recent"][number]) =>
  calculateFinancialMetrics([
    {
      status: order.status,
      items: order.items.map((item) => ({
        quantity: item.quantity,
        unitPriceAtSale: item.unitPriceAtSale,
        unitCostAtSale: item.unitCostAtSale,
      })),
    },
  ]).revenue;

const lineRevenue = (quantity: string, price: string) =>
  toMoney(multiply(parseDecimal(quantity), parseDecimal(price)));

export const overviewHandler = async (context: Context<AppEnvironment>) => {
  const request = query<{ locationId?: string; period: AnalyticsPeriod }>(context);
  const analytics = await buildAnalyticsSnapshot(
    context.get("database"),
    authOptions(context, request.period, request.locationId),
  );
  const result = await buildOverview(analytics);
  const response = { data: result.data, meta: result.meta, requestId: context.get("requestId") };
  overviewResponseSchema.parse(response);
  context.header("cache-control", "private, no-store");
  return context.json(response, 200);
};

export const locationsHandler = async (context: Context<AppEnvironment>) => {
  const request = query<{
    locationId?: string;
    period: AnalyticsPeriod;
    sortBy: AnalyticsContext["sortBy"];
    sortDir: AnalyticsContext["sortDir"];
  }>(context);
  const locationOptions = authOptions(context, request.period, request.locationId);
  if (request.sortBy !== null) locationOptions.sortBy = request.sortBy;
  if (request.sortDir !== null) locationOptions.sortDir = request.sortDir;
  const analytics = await buildAnalyticsSnapshot(context.get("database"), locationOptions);
  const result = await buildLocations(analytics);
  const response = { data: result.data, meta: result.meta, requestId: context.get("requestId") };
  locationsResponseSchema.parse(response);
  context.header("cache-control", "private, no-store");
  return context.json(response, 200);
};

export const salesHandler = async (context: Context<AppEnvironment>) => {
  const request = query<{
    locationId?: string;
    period: AnalyticsPeriod;
    cursor?: string;
    page?: number;
    pageSize?: number;
    pageContext?: string;
  }>(context);
  if (request.cursor && (request.page || request.pageContext))
    throw new ApiProblem("VALIDATION_ERROR", 400, "Choose cursor or page pagination");
  if (request.pageContext && !request.page)
    throw new ApiProblem("VALIDATION_ERROR", 400, "Page context is required with page");
  const secret = context.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Analytics continuation secret is unavailable");
  const continuation = request.cursor
    ? await verifyContinuation(request.cursor, secret)
    : request.pageContext
      ? await verifyContinuation(request.pageContext, secret)
      : null;
  if (
    continuation &&
    ((request.cursor && continuation.kind !== "cursor") ||
      (request.pageContext && continuation.kind !== "page"))
  )
    throw new ApiProblem("VALIDATION_ERROR", 400, "Invalid pagination mode");
  assertContinuationPageSize(continuation, request.pageSize);
  const asOf = continuation ? new Date(continuation.asOf) : undefined;
  if (continuation && !Number.isFinite(asOf!.getTime()))
    throw new ApiProblem("VALIDATION_ERROR", 400, "Invalid pagination context");
  const analytics = await buildAnalyticsSnapshot(
    context.get("database"),
    authOptions(context, request.period, request.locationId, asOf),
  );
  if (continuation) compareContinuation(analytics, continuation, "sales", secret);
  if (request.page && request.page > 1 && !request.pageContext)
    throw new ApiProblem("VALIDATION_ERROR", 400, "Page context is required");
  const result = await buildSales(analytics);
  const size = Math.min(
    paginationDefaults.MAX_PAGE_SIZE,
    Math.max(1, request.pageSize ?? continuation?.pageSize ?? paginationDefaults.DEFAULT_PAGE_SIZE),
  );
  const mode = request.page ? "page" : "cursor";
  let recent = result.recent;
  if (continuation?.kind === "cursor" && continuation.lastAt && continuation.lastId) {
    const lastTime = new Date(continuation.lastAt).getTime();
    recent = recent.filter(
      (order) =>
        order.orderedAt.getTime() < lastTime ||
        (order.orderedAt.getTime() === lastTime && order.id < continuation.lastId!),
    );
  }
  const page = request.page ?? 1;
  if (mode === "page") recent = recent.slice((page - 1) * size);
  const pageItems = recent.slice(0, size);
  const hasMore = recent.length > size;
  const payload = basePayload(analytics, mode, "sales", size);
  if (mode === "page") payload.page = page;
  if (pageItems.length > 0 && hasMore) {
    const last = pageItems.at(-1)!;
    if (mode === "cursor") {
      payload.lastAt = last.orderedAt.toISOString();
      payload.lastId = last.id;
    }
  }
  const nextCursor = mode === "cursor" && hasMore ? await signContinuation(payload, secret) : null;
  const pageContext = mode === "page" ? await signContinuation(payload, secret) : null;
  result.data.recentOrders = serializeRecent(analytics, pageItems);
  const response = {
    data: result.data,
    meta: buildAnalyticsMeta(analytics, {
      mode: mode as "cursor" | "page",
      page: mode === "page" ? page : null,
      pageSize: size,
      nextCursor,
      pageContext,
    }),
    requestId: context.get("requestId"),
  };
  salesResponseSchema.parse(response);
  context.header("cache-control", "private, no-store");
  return context.json(response, 200);
};

export const productsHandler = async (context: Context<AppEnvironment>) => {
  const request = query<{ locationId?: string; period: AnalyticsPeriod }>(context);
  const analytics = await buildAnalyticsSnapshot(
    context.get("database"),
    authOptions(context, request.period, request.locationId),
  );
  const result = await buildProducts(analytics);
  const response = { data: result.data, meta: result.meta, requestId: context.get("requestId") };
  productsResponseSchema.parse(response);
  context.header("cache-control", "private, no-store");
  return context.json(response, 200);
};

export const inventoryHandler = async (context: Context<AppEnvironment>) => {
  const request = query<{
    locationId?: string;
    period: AnalyticsPeriod;
    status?: Exclude<AnalyticsContext["status"], null>;
    cursor?: string;
    page?: number;
    pageSize?: number;
  }>(context);
  if (request.page)
    throw new ApiProblem("VALIDATION_ERROR", 400, "Inventory movements use cursor pagination");
  const secret = context.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Analytics continuation secret is unavailable");
  const continuation = request.cursor ? await verifyContinuation(request.cursor, secret) : null;
  if (continuation && continuation.kind !== "cursor")
    throw new ApiProblem("VALIDATION_ERROR", 400, "Invalid pagination mode");
  assertContinuationPageSize(continuation, request.pageSize);
  const asOf = continuation ? new Date(continuation.asOf) : undefined;
  const inventoryOptions = authOptions(context, request.period, request.locationId, asOf);
  if (request.status !== undefined) inventoryOptions.status = request.status;
  const analytics = await buildAnalyticsSnapshot(context.get("database"), inventoryOptions);
  if (continuation) compareContinuation(analytics, continuation, "inventory", secret);
  const result = await buildInventory(analytics);
  const size = Math.min(
    paginationDefaults.MAX_PAGE_SIZE,
    Math.max(1, request.pageSize ?? continuation?.pageSize ?? paginationDefaults.DEFAULT_PAGE_SIZE),
  );
  let movements = result.data.movements;
  if (continuation?.lastAt && continuation.lastId)
    movements = movements.filter(
      (movement) =>
        movement.occurredAt < continuation.lastAt! ||
        (movement.occurredAt === continuation.lastAt && movement.movementId < continuation.lastId!),
    );
  const pageItems = movements.slice(0, size);
  const hasMore = movements.length > size;
  const payload = basePayload(analytics, "cursor", "inventory", size);
  if (pageItems.length > 0 && hasMore) {
    payload.lastAt = pageItems.at(-1)!.occurredAt;
    payload.lastId = pageItems.at(-1)!.movementId;
  }
  const nextCursor = hasMore ? await signContinuation(payload, secret) : null;
  result.data.movements = pageItems;
  const response = {
    data: result.data,
    meta: {
      ...result.meta,
      pagination: {
        mode: "cursor" as const,
        page: null,
        pageSize: size,
        nextCursor,
        pageContext: null,
      },
    },
    requestId: context.get("requestId"),
  };
  inventoryResponseSchema.parse(response);
  context.header("cache-control", "private, no-store");
  return context.json(response, 200);
};
