import {
  calculateComparisonPercent,
  calculateCurrentUnitMargin,
  calculateFinancialMetrics,
  calculateGoalCompletion,
  classifyMenuProducts,
  getStockStatus,
  localCalendarParts,
  localDateKey,
  localDateTimeToUtc,
  localWeekdayAndHour,
  resolvePeriodWindow,
  type AnalyticsPeriod,
  type FinancialOrder,
} from "../domain/index.ts";
import {
  add,
  compare,
  divide,
  isZero,
  multiply,
  parseDecimal,
  subtract,
  toMoney,
  toPercentage,
  toQuantity,
  type Decimal,
} from "../domain/decimal.ts";
import type { RequestTransaction } from "../db/client.ts";
import { sql, type SQL } from "drizzle-orm";
import {
  analyticsMetaSchema,
  type OverviewData,
  type LocationsData,
  type SalesData,
  type ProductsData,
  type InventoryData,
} from "@brew-dashboard/contracts";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type Row = Record<string, unknown>;
type LocationRow = { id: string; name: string; sortOrder: number };
type CategoryRow = { id: string; name: string; sortOrder: number };
type ProductRow = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  currentPrice: string;
  currentUnitCost: string;
  active: boolean;
  version: number;
};
type OrderItemRow = {
  orderId: string;
  productId: string;
  quantity: string;
  unitPriceAtSale: string;
  unitCostAtSale: string;
};
type OrderRow = {
  id: string;
  locationId: string;
  orderedAt: Date;
  status: "completed" | "cancelled";
};
type InventoryItemRow = {
  id: string;
  name: string;
  productId: string | null;
  productName: string | null;
  unit: "pcs" | "kg" | "l";
};
type BalanceRow = {
  id: string;
  inventoryItemId: string;
  locationId: string;
  onHand: string;
  minThreshold: string;
};
type MovementRow = {
  id: string;
  inventoryItemId: string;
  locationId: string;
  type: "receipt" | "writeoff";
  quantity: string;
  occurredAt: Date;
};
type TargetRow = { month: string; amount: string; version: number };

type OrderRecord = OrderRow & { items: OrderItemRow[] };

type Snapshot = {
  networkId: string;
  timeZone: string;
  revision: number;
  locations: LocationRow[];
  categories: CategoryRow[];
  products: ProductRow[];
  orders: OrderRecord[];
  inventoryItems: InventoryItemRow[];
  balances: BalanceRow[];
  movements: MovementRow[];
  target: TargetRow | null;
};

export type AnalyticsContext = {
  snapshot: Snapshot;
  period: AnalyticsPeriod;
  locationId: string | null;
  requestedLocationId: string | undefined;
  warning: boolean;
  asOf: Date;
  window: ReturnType<typeof resolvePeriodWindow>;
  comparisonStart: Date;
  status: "in_stock" | "low_stock" | "out_of_stock" | null;
  sortBy:
    | "revenue"
    | "grossProfit"
    | "orders"
    | "averageCheck"
    | "grossMargin"
    | "activeAlerts"
    | "name"
    | null;
  sortDir: "asc" | "desc" | null;
};

export type AnalyticsOptions = {
  networkId: string;
  timeZone: string;
  period: AnalyticsPeriod;
  locationId?: string;
  status?: "in_stock" | "low_stock" | "out_of_stock";
  sortBy?: Exclude<AnalyticsContext["sortBy"], null>;
  sortDir?: Exclude<AnalyticsContext["sortDir"], null>;
  asOf?: Date;
};

type QueryResult<T> = { rows: T[] };

const rows = async <T extends Row>(
  transaction: RequestTransaction,
  statement: SQL,
): Promise<T[]> => {
  const result = (await transaction.execute(statement)) as unknown as QueryResult<T>;
  return result.rows ?? [];
};

const dateValue = (value: unknown): Date => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid database timestamp");
  return date;
};

const stringValue = (value: unknown): string => String(value);

const numberValue = (value: unknown): number => Number(value);

const boolValue = (value: unknown): boolean => value === true || value === "true";

const addDays = (dateKey: string, offset: number): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error("Invalid local date key");
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset),
  );
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
};

const monthStartUtc = (date: Date, timeZone: string): Date => {
  const local = localCalendarParts(date, timeZone);
  return (
    localDateTimeToUtc(
      {
        year: local.year,
        month: local.month,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      timeZone,
    ) ?? date
  );
};

const orderRows = (orders: OrderRow[], items: OrderItemRow[]): OrderRecord[] => {
  const byOrder = new Map<string, OrderItemRow[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(item);
    byOrder.set(item.orderId, list);
  }
  return orders.map((order) => ({ ...order, items: byOrder.get(order.id) ?? [] }));
};

const orderFinancial = (orders: readonly OrderRecord[]): FinancialOrder[] =>
  orders.map((order) => ({
    status: order.status,
    items: order.items.map((item) => ({
      quantity: item.quantity,
      unitPriceAtSale: item.unitPriceAtSale,
      unitCostAtSale: item.unitCostAtSale,
    })),
  }));

const inWindow = (date: Date, start: Date, end: Date): boolean =>
  date.getTime() >= start.getTime() && date.getTime() < end.getTime();

const ordersInWindow = (
  orders: readonly OrderRecord[],
  start: Date,
  end: Date,
  locationId?: string | null,
): OrderRecord[] =>
  orders.filter(
    (order) =>
      inWindow(order.orderedAt, start, end) && (!locationId || order.locationId === locationId),
  );

const calculateMetrics = (orders: readonly OrderRecord[]) =>
  calculateFinancialMetrics(orderFinancial(orders));

const moneyMetric = (current: string, previous: string) => ({
  value: current,
  previousValue: previous,
  changePercent: calculateComparisonPercent(current, previous),
});

const nullableMoneyMetric = (current: string | null, previous: string | null) => ({
  value: current,
  previousValue: previous,
  changePercent: calculateComparisonPercent(current, previous),
});

const percentageMetric = (current: string | null, previous: string | null) => ({
  value: current,
  previousValue: previous,
  changePercent: calculateComparisonPercent(current, previous),
});

const countMetric = (current: number, previous: number, comparable = true) => ({
  value: current,
  previousValue: previous,
  changePercent: comparable ? calculateComparisonPercent(String(current), String(previous)) : null,
});

const kpis = (
  current: ReturnType<typeof calculateMetrics>,
  previous: ReturnType<typeof calculateMetrics>,
) => ({
  revenue: moneyMetric(current.revenue, previous.revenue),
  cogs: moneyMetric(current.cogs, previous.cogs),
  grossProfit: moneyMetric(current.grossProfit, previous.grossProfit),
  grossMargin: percentageMetric(current.grossMargin, previous.grossMargin),
  orders: countMetric(current.orders, previous.orders),
  averageCheck: nullableMoneyMetric(current.averageCheck, previous.averageCheck),
});

const overviewKpis = (
  current: ReturnType<typeof calculateMetrics>,
  previous: ReturnType<typeof calculateMetrics>,
  activeAlerts: number,
) => ({
  revenue: moneyMetric(current.revenue, previous.revenue),
  grossProfit: moneyMetric(current.grossProfit, previous.grossProfit),
  orders: countMetric(current.orders, previous.orders),
  averageCheck: nullableMoneyMetric(current.averageCheck, previous.averageCheck),
  grossMargin: percentageMetric(current.grossMargin, previous.grossMargin),
  activeAlerts: countMetric(activeAlerts, activeAlerts, false),
});

const productFinancial = (orders: readonly OrderRecord[], productId: string) => {
  const selected = orders
    .filter(
      (order) =>
        order.status === "completed" && order.items.some((item) => item.productId === productId),
    )
    .map((order) => ({
      ...order,
      items: order.items.filter((item) => item.productId === productId),
    }));
  const units = selected.reduce<Decimal>(
    (total, order) =>
      order.items.reduce((sum, item) => add(sum, parseDecimal(item.quantity)), total),
    parseDecimal("0"),
  );
  return { metrics: calculateMetrics(selected), unitsSold: toQuantity(units) };
};

const groupFinancial = (orders: readonly OrderRecord[], groupId: string) =>
  calculateMetrics(orders.filter((order) => order.locationId === groupId));

const sumRevenue = (orders: readonly OrderRecord[]): string => calculateMetrics(orders).revenue;

const sumUnits = (orders: readonly OrderRecord[], productId: string): string =>
  productFinancial(orders, productId).unitsSold;

const localHourBucket = (date: Date, timeZone: string): string => {
  const value = localCalendarParts(date, timeZone);
  return `${localDateKey(date, timeZone)}T${String(value.hour).padStart(2, "0")}`;
};

const trend = (
  context: AnalyticsContext,
  orders: readonly OrderRecord[],
): Array<{
  bucket: string;
  revenue: string;
  grossProfit: string;
  comparisonRevenue: string;
  comparisonGrossProfit: string;
}> => {
  const currentStart = context.window.start;
  const currentEnd = context.window.end;
  const comparisonStart = context.window.comparisonStart;
  const comparisonEnd = context.window.comparisonEnd;
  const points: Array<{ bucket: string; current: OrderRecord[]; previous: OrderRecord[] }> = [];
  if (context.period === "today") {
    const currentDate = localDateKey(context.asOf, context.snapshot.timeZone);
    const previousDate = addDays(currentDate, -1);
    const currentHour = localCalendarParts(context.asOf, context.snapshot.timeZone).hour;
    for (let hour = 0; hour <= currentHour; hour += 1) {
      points.push({
        bucket: `${currentDate}T${String(hour).padStart(2, "0")}`,
        current: orders.filter(
          (order) =>
            inWindow(order.orderedAt, currentStart, currentEnd) &&
            localHourBucket(order.orderedAt, context.snapshot.timeZone) ===
              `${currentDate}T${String(hour).padStart(2, "0")}`,
        ),
        previous: orders.filter(
          (order) =>
            inWindow(order.orderedAt, comparisonStart, comparisonEnd) &&
            localHourBucket(order.orderedAt, context.snapshot.timeZone) ===
              `${previousDate}T${String(hour).padStart(2, "0")}`,
        ),
      });
    }
  } else {
    const startDate = localDateKey(currentStart, context.snapshot.timeZone);
    const endDate = localDateKey(new Date(currentEnd.getTime() - 1), context.snapshot.timeZone);
    const previousStartDate = localDateKey(comparisonStart, context.snapshot.timeZone);
    let offset = 0;
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      const previousDate = addDays(previousStartDate, offset);
      points.push({
        bucket: date,
        current: orders.filter(
          (order) =>
            inWindow(order.orderedAt, currentStart, currentEnd) &&
            localDateKey(order.orderedAt, context.snapshot.timeZone) === date,
        ),
        previous: orders.filter(
          (order) =>
            inWindow(order.orderedAt, comparisonStart, comparisonEnd) &&
            localDateKey(order.orderedAt, context.snapshot.timeZone) === previousDate,
        ),
      });
      offset += 1;
    }
  }
  return points.map(({ bucket, current, previous }) => {
    const currentMetrics = calculateMetrics(current);
    const previousMetrics = calculateMetrics(previous);
    return {
      bucket,
      revenue: currentMetrics.revenue,
      grossProfit: currentMetrics.grossProfit,
      comparisonRevenue: previousMetrics.revenue,
      comparisonGrossProfit: previousMetrics.grossProfit,
    };
  });
};

const deterministicUuid = async (value: string): Promise<string> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const stockAlert = async (
  context: AnalyticsContext,
  balance: BalanceRow,
  item: InventoryItemRow,
  location: LocationRow,
) => {
  const status = getStockStatus(balance.onHand, balance.minThreshold);
  const type = status === "low_stock" ? "LOW_STOCK" : "OUT_OF_STOCK";
  return {
    id: await deterministicUuid(
      `${context.snapshot.networkId}|${type}|${location.id}|${balance.inventoryItemId}`,
    ),
    type,
    locationId: location.id,
    locationName: location.name,
    entityId: balance.inventoryItemId,
    entityName: item.name,
    currentValue: toQuantity(parseDecimal(balance.onHand)),
    previousValue: null,
    threshold: toQuantity(parseDecimal(balance.minThreshold)),
  } as const;
};

const buildSnapshot = async (
  transaction: RequestTransaction,
  networkId: string,
  timeZone: string,
  asOf: Date,
  period: AnalyticsPeriod,
  scope: "full" | "sales" = "full",
): Promise<Snapshot> => {
  const window = resolvePeriodWindow(asOf, timeZone, period);
  const monthStart = scope === "full" ? monthStartUtc(asOf, timeZone) : window.comparisonStart;
  const lowerBound =
    monthStart.getTime() < window.comparisonStart.getTime() ? monthStart : window.comparisonStart;
  const network = await rows<Row>(
    transaction,
    sql`SELECT demo_data_revision AS "revision"
        FROM app.networks
        WHERE id = ${networkId}
        LIMIT 1`,
  );
  if (!network[0]) throw new Error("Authenticated network was not found");
  const locations = (
    await rows<Row>(
      transaction,
      sql`SELECT id::text AS id, name, sort_order AS "sortOrder"
        FROM app.locations WHERE network_id = ${networkId}
        ORDER BY sort_order, id`,
    )
  ).map((row) => ({
    id: stringValue(row.id),
    name: stringValue(row.name),
    sortOrder: numberValue(row.sortOrder),
  }));
  const categories = (
    await rows<Row>(
      transaction,
      sql`SELECT id::text AS id, name, sort_order AS "sortOrder"
        FROM app.categories WHERE network_id = ${networkId}
        ORDER BY sort_order, id`,
    )
  ).map((row) => ({
    id: stringValue(row.id),
    name: stringValue(row.name),
    sortOrder: numberValue(row.sortOrder),
  }));
  const products = (
    await rows<Row>(
      transaction,
      sql`SELECT p.id::text AS id, p.name, p.category_id::text AS "categoryId",
               c.name AS "categoryName", p.current_price::text AS "currentPrice",
               p.current_unit_cost::text AS "currentUnitCost", p.active,
               p.version
        FROM app.products p
        JOIN app.categories c ON c.network_id = p.network_id AND c.id = p.category_id
        WHERE p.network_id = ${networkId}
        ORDER BY p.name, p.id`,
    )
  ).map((row) => ({
    id: stringValue(row.id),
    name: stringValue(row.name),
    categoryId: stringValue(row.categoryId),
    categoryName: stringValue(row.categoryName),
    currentPrice: stringValue(row.currentPrice),
    currentUnitCost: stringValue(row.currentUnitCost),
    active: boolValue(row.active),
    version: numberValue(row.version),
  }));
  const orderRowsRaw = await rows<Row>(
    transaction,
    sql`SELECT o.id::text AS id, o.location_id::text AS "locationId",
               o.ordered_at AS "orderedAt", o.status,
               oi.product_id::text AS "productId", oi.quantity::text AS quantity,
               oi.unit_price_at_sale::text AS "unitPriceAtSale",
               oi.unit_cost_at_sale::text AS "unitCostAtSale"
        FROM app.orders o
        LEFT JOIN app.order_items oi
          ON oi.network_id = o.network_id AND oi.order_id = o.id
        WHERE o.network_id = ${networkId}
          AND o.ordered_at >= ${lowerBound}
          AND o.ordered_at < ${asOf}
        ORDER BY o.ordered_at DESC, o.id DESC, oi.id`,
  );
  const orderMap = new Map<string, OrderRow>();
  const itemRows: OrderItemRow[] = [];
  for (const row of orderRowsRaw) {
    const id = stringValue(row.id);
    if (!orderMap.has(id)) {
      orderMap.set(id, {
        id,
        locationId: stringValue(row.locationId),
        orderedAt: dateValue(row.orderedAt),
        status: stringValue(row.status) as OrderRow["status"],
      });
    }
    if (row.productId !== null && row.productId !== undefined) {
      itemRows.push({
        orderId: id,
        productId: stringValue(row.productId),
        quantity: stringValue(row.quantity),
        unitPriceAtSale: stringValue(row.unitPriceAtSale),
        unitCostAtSale: stringValue(row.unitCostAtSale),
      });
    }
  }
  const inventoryItems =
    scope === "sales"
      ? []
      : (
          await rows<Row>(
            transaction,
            sql`SELECT i.id::text AS id, i.name, i.product_id::text AS "productId",
               p.name AS "productName", i.unit
        FROM app.inventory_items i
        LEFT JOIN app.products p
          ON p.network_id = i.network_id AND p.id = i.product_id
        WHERE i.network_id = ${networkId}
        ORDER BY i.name, i.id`,
          )
        ).map((row) => ({
          id: stringValue(row.id),
          name: stringValue(row.name),
          productId: row.productId == null ? null : stringValue(row.productId),
          productName: row.productName == null ? null : stringValue(row.productName),
          unit: stringValue(row.unit) as InventoryItemRow["unit"],
        }));
  const balances =
    scope === "sales"
      ? []
      : (
          await rows<Row>(
            transaction,
            sql`SELECT id::text AS id, inventory_item_id::text AS "inventoryItemId",
               location_id::text AS "locationId", on_hand::text AS "onHand",
               min_threshold::text AS "minThreshold"
        FROM app.inventory_balances WHERE network_id = ${networkId}
        ORDER BY location_id, inventory_item_id`,
          )
        ).map((row) => ({
          id: stringValue(row.id),
          inventoryItemId: stringValue(row.inventoryItemId),
          locationId: stringValue(row.locationId),
          onHand: stringValue(row.onHand),
          minThreshold: stringValue(row.minThreshold),
        }));
  const movements =
    scope === "sales"
      ? []
      : (
          await rows<Row>(
            transaction,
            sql`SELECT id::text AS id, inventory_item_id::text AS "inventoryItemId",
               location_id::text AS "locationId", type, quantity::text AS quantity,
               occurred_at AS "occurredAt"
        FROM app.inventory_movements WHERE network_id = ${networkId}
          AND occurred_at >= ${window.comparisonStart}
          AND occurred_at < ${asOf}
        ORDER BY occurred_at DESC, id DESC`,
          )
        ).map((row) => ({
          id: stringValue(row.id),
          inventoryItemId: stringValue(row.inventoryItemId),
          locationId: stringValue(row.locationId),
          type: stringValue(row.type) as MovementRow["type"],
          quantity: stringValue(row.quantity),
          occurredAt: dateValue(row.occurredAt),
        }));
  const target =
    scope === "sales"
      ? null
      : ((
          await rows<Row>(
            transaction,
            sql`SELECT month::text AS month, amount::text AS amount, version
        FROM app.revenue_targets
        WHERE network_id = ${networkId} AND month = ${localDateKey(asOf, timeZone).slice(0, 7) + "-01"}::date
        LIMIT 1`,
          )
        ).map((row) => ({
          month: stringValue(row.month).slice(0, 7),
          amount: stringValue(row.amount),
          version: numberValue(row.version),
        }))[0] ?? null);
  return {
    networkId,
    timeZone,
    revision: numberValue(network[0].revision),
    locations,
    categories,
    products,
    orders: orderRows([...orderMap.values()], itemRows),
    inventoryItems,
    balances,
    movements,
    target,
  };
};

export const createAnalyticsContext = async (
  transaction: RequestTransaction,
  options: AnalyticsOptions,
  scope: "full" | "sales" = "full",
): Promise<AnalyticsContext> => {
  const asOf = options.asOf ?? new Date();
  const snapshot = await buildSnapshot(
    transaction,
    options.networkId,
    options.timeZone,
    asOf,
    options.period,
    scope,
  );
  const parsedLocation = options.locationId?.trim();
  const locationId =
    parsedLocation && snapshot.locations.some((location) => location.id === parsedLocation)
      ? parsedLocation
      : null;
  return {
    snapshot,
    period: options.period,
    locationId,
    requestedLocationId: parsedLocation,
    warning: Boolean(parsedLocation && !locationId),
    asOf,
    window: resolvePeriodWindow(asOf, options.timeZone, options.period),
    comparisonStart: resolvePeriodWindow(asOf, options.timeZone, options.period).comparisonStart,
    status: options.status ?? null,
    sortBy: options.sortBy ?? null,
    sortDir: options.sortDir ?? null,
  };
};

const selectedLocations = (context: AnalyticsContext): LocationRow[] =>
  context.snapshot.locations.filter(
    (location) => !context.locationId || location.id === context.locationId,
  );

const selectedBalances = (context: AnalyticsContext): BalanceRow[] =>
  context.snapshot.balances.filter((balance) => {
    if (context.locationId && balance.locationId !== context.locationId) return false;
    if (context.status && getStockStatus(balance.onHand, balance.minThreshold) !== context.status)
      return false;
    return true;
  });

const selectedOrders = (context: AnalyticsContext, start: Date, end: Date): OrderRecord[] =>
  ordersInWindow(context.snapshot.orders, start, end, context.locationId);

const stockAlerts = async (context: AnalyticsContext) => {
  const locationMap = new Map(
    context.snapshot.locations.map((location) => [location.id, location]),
  );
  const itemMap = new Map(context.snapshot.inventoryItems.map((item) => [item.id, item]));
  const values = [];
  for (const balance of selectedBalances({ ...context, status: null })) {
    const status = getStockStatus(balance.onHand, balance.minThreshold);
    if (status === "in_stock") continue;
    const location = locationMap.get(balance.locationId);
    const item = itemMap.get(balance.inventoryItemId);
    if (!location || !item) continue;
    values.push(await stockAlert(context, balance, item, location));
  }
  return values;
};

const canonicalWeakLocation = (
  context: AnalyticsContext,
): { location: LocationRow; current: string; previous: string } | null => {
  if (context.snapshot.locations.length < 2) return null;
  const current = ordersInWindow(context.snapshot.orders, context.window.start, context.window.end);
  const previous = ordersInWindow(
    context.snapshot.orders,
    context.window.comparisonStart,
    context.window.comparisonEnd,
  );
  const values = context.snapshot.locations.map((location) => ({
    location,
    current: groupFinancial(current, location.id).revenue,
    previous: groupFinancial(previous, location.id).revenue,
  }));
  const allEqual = values.every(
    (value) => compare(parseDecimal(value.current), parseDecimal(values[0]!.current)) === 0,
  );
  if (allEqual) return null;
  values.sort(
    (left, right) =>
      compare(parseDecimal(left.current), parseDecimal(right.current)) ||
      left.location.sortOrder - right.location.sortOrder ||
      left.location.id.localeCompare(right.location.id),
  );
  return values[0]!;
};

const salesDropAlert = async (context: AnalyticsContext) => {
  const weak = canonicalWeakLocation(context);
  if (!weak || (context.locationId && context.locationId !== weak.location.id)) return null;
  const previous = parseDecimal(weak.previous);
  const current = parseDecimal(weak.current);
  if (compare(previous, parseDecimal("0")) <= 0) return null;
  const eighty = multiply(previous, parseDecimal("0.8"));
  if (compare(current, eighty) > 0) return null;
  return {
    id: await deterministicUuid(
      `${context.snapshot.networkId}|SALES_DROP|${weak.location.id}|null`,
    ),
    type: "SALES_DROP" as const,
    locationId: weak.location.id,
    locationName: weak.location.name,
    entityId: null,
    entityName: null,
    currentValue: weak.current,
    previousValue: weak.previous,
    threshold: "-20.00",
  };
};

const activeAlerts = async (context: AnalyticsContext) => {
  const stock = await stockAlerts(context);
  const drop = await salesDropAlert(context);
  const alerts = [...stock, ...(drop ? [drop] : [])];
  const rank = { OUT_OF_STOCK: 0, SALES_DROP: 1, LOW_STOCK: 2 } as const;
  return alerts.sort(
    (left, right) =>
      rank[left.type] - rank[right.type] ||
      left.locationId.localeCompare(right.locationId) ||
      (left.entityId ?? "").localeCompare(right.entityId ?? ""),
  );
};

const productSummary = (
  product: ProductRow,
  currentOrders: OrderRecord[],
  previousOrders: OrderRecord[],
  denominator: string,
) => {
  const current = productFinancial(currentOrders, product.id);
  const previous = productFinancial(previousOrders, product.id);
  const revenueShare = isZero(parseDecimal(denominator))
    ? null
    : toPercentage(
        multiply(
          divide(parseDecimal(current.metrics.revenue), parseDecimal(denominator), 6),
          parseDecimal("100"),
        ),
      );
  return {
    summary: {
      productId: product.id,
      name: product.name,
      categoryName: product.categoryName,
      unitsSold: current.unitsSold,
      revenue: current.metrics.revenue,
      grossProfit: current.metrics.grossProfit,
      grossMargin: current.metrics.grossMargin,
      revenueShare,
    },
    currentMetrics: current.metrics,
    previousMetrics: previous.metrics,
  };
};

const productAnalytics = (context: AnalyticsContext) => {
  const currentOrders = selectedOrders(context, context.window.start, context.window.end);
  const previousOrders = selectedOrders(
    context,
    context.window.comparisonStart,
    context.window.comparisonEnd,
  );
  const denominator = sumRevenue(currentOrders);
  const activeInputs = context.snapshot.products.map((product) => ({
    productId: product.id,
    active: product.active,
    unitsSold: sumUnits(currentOrders, product.id),
    currentPrice: product.currentPrice,
    currentUnitCost: product.currentUnitCost,
  }));
  const menu = classifyMenuProducts(activeInputs);
  const classified = new Map(menu.products.map((product) => [product.productId, product]));
  const medians = menu.medians;
  const balanceByProduct = new Map<
    string,
    Array<{
      locationId: string;
      locationName: string;
      onHand: string;
      status: ReturnType<typeof getStockStatus>;
    }>
  >();
  const itemMap = new Map(context.snapshot.inventoryItems.map((item) => [item.id, item]));
  const locationMap = new Map(
    context.snapshot.locations.map((location) => [location.id, location]),
  );
  for (const balance of context.snapshot.balances) {
    if (context.locationId && balance.locationId !== context.locationId) continue;
    const productId = itemMap.get(balance.inventoryItemId)?.productId;
    const location = locationMap.get(balance.locationId);
    if (!productId || !location) continue;
    const list = balanceByProduct.get(productId) ?? [];
    list.push({
      locationId: balance.locationId,
      locationName: location.name,
      onHand: balance.onHand,
      status: getStockStatus(balance.onHand, balance.minThreshold),
    });
    balanceByProduct.set(productId, list);
  }
  const products = context.snapshot.products.map((product) => {
    const summary = productSummary(product, currentOrders, previousOrders, denominator);
    const classification = classified.get(product.id);
    return {
      productId: product.id,
      name: product.name,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      active: product.active,
      currentPrice: product.currentPrice,
      currentUnitCost: product.currentUnitCost,
      unitContribution:
        classification?.unitContribution ??
        toMoney(
          subtract(parseDecimal(product.currentPrice), parseDecimal(product.currentUnitCost)),
        ),
      currentUnitMargin: calculateCurrentUnitMargin(product.currentPrice, product.currentUnitCost),
      version: product.version,
      unitsSold: summary.summary.unitsSold,
      revenue: summary.summary.revenue,
      grossProfit: summary.summary.grossProfit,
      grossMargin: summary.summary.grossMargin,
      revenueShare: summary.summary.revenueShare,
      balances: balanceByProduct.get(product.id) ?? [],
      menuGroup: classification?.group ?? null,
      recommendation: classification?.recommendation ?? null,
      summary: summary.summary,
    };
  });
  return { products, medians, denominator };
};

const groupBreakdown = (
  context: AnalyticsContext,
  orders: OrderRecord[],
  kind: "location" | "category" | "product",
) => {
  const entries =
    kind === "location"
      ? selectedLocations(context).map((location) => ({ id: location.id, name: location.name }))
      : kind === "category"
        ? context.snapshot.categories.map((category) => ({ id: category.id, name: category.name }))
        : context.snapshot.products.map((product) => ({ id: product.id, name: product.name }));
  const productCategory = new Map(
    context.snapshot.products.map((product) => [product.id, product.categoryId]),
  );
  return entries.map(({ id, name }) => {
    const selected = orders
      .filter((order) => order.status === "completed")
      .map((order) => ({
        ...order,
        items: order.items.filter((item) =>
          kind === "location"
            ? order.locationId === id
            : kind === "product"
              ? item.productId === id
              : productCategory.get(item.productId) === id,
        ),
      }));
    const metrics = calculateMetrics(
      kind === "location"
        ? orders.filter((order) => order.locationId === id)
        : selected.filter((order) => order.items.length > 0),
    );
    const units = selected.reduce<Decimal>(
      (total, order) =>
        order.items.reduce((sum, item) => add(sum, parseDecimal(item.quantity)), total),
      parseDecimal("0"),
    );
    return {
      id,
      name,
      revenue: metrics.revenue,
      grossProfit: metrics.grossProfit,
      orders: metrics.orders,
      unitsSold: toQuantity(units),
    };
  });
};

const makeMeta = (
  context: AnalyticsContext,
  pagination: {
    mode: "none" | "cursor" | "page";
    page: number | null;
    pageSize: number | null;
    nextCursor: string | null;
    pageContext: string | null;
  },
) =>
  analyticsMetaSchema.parse({
    asOf: context.asOf.toISOString(),
    demoDataRevision: context.snapshot.revision,
    appliedFilters: {
      period: context.period,
      locationId: context.locationId,
      status: context.status,
      sortBy: context.sortBy,
      sortDir: context.sortDir,
    },
    warnings: context.warning ? [{ code: "INVALID_LOCATION_FALLBACK", field: "locationId" }] : [],
    pagination,
  });

export const buildAnalyticsMeta = makeMeta;

const noPagination = () => ({
  mode: "none" as const,
  page: null,
  pageSize: null,
  nextCursor: null,
  pageContext: null,
});

export const buildOverview = async (
  context: AnalyticsContext,
): Promise<{ data: OverviewData; meta: ReturnType<typeof makeMeta> }> => {
  const current = selectedOrders(context, context.window.start, context.window.end);
  const previous = selectedOrders(
    context,
    context.window.comparisonStart,
    context.window.comparisonEnd,
  );
  const alerts = await activeAlerts(context);
  const productData = productAnalytics(context);
  const activeProducts = productData.products.filter((product) => product.active);
  const top = [...activeProducts]
    .sort(
      (a, b) =>
        compare(parseDecimal(b.revenue), parseDecimal(a.revenue)) ||
        a.productId.localeCompare(b.productId),
    )
    .slice(0, 5);
  const used = new Set(top.map((product) => product.productId));
  const bottom = [...activeProducts]
    .filter((product) => !used.has(product.productId))
    .sort(
      (a, b) =>
        compare(parseDecimal(a.revenue), parseDecimal(b.revenue)) ||
        a.productId.localeCompare(b.productId),
    )
    .slice(0, 5);
  const locationRows = selectedLocations(context).map((location) => {
    const currentLocation = groupFinancial(current, location.id);
    const locationAlerts = alerts.filter((alert) => alert.locationId === location.id).length;
    return {
      locationId: location.id,
      name: location.name,
      revenue: currentLocation.revenue,
      grossProfit: currentLocation.grossProfit,
      orders: currentLocation.orders,
      activeAlerts: locationAlerts,
    };
  });
  const goalStart = monthStartUtc(context.asOf, context.snapshot.timeZone);
  const goalRevenue = sumRevenue(ordersInWindow(context.snapshot.orders, goalStart, context.asOf));
  const goal = context.snapshot.target
    ? {
        month: context.snapshot.target.month,
        revenue: goalRevenue,
        target: context.snapshot.target.amount,
        version: context.snapshot.target.version,
        completionPercent: calculateGoalCompletion(goalRevenue, context.snapshot.target.amount),
        scope: "network" as const,
      }
    : null;
  const data = {
    period: context.period,
    locationId: context.locationId,
    window: {
      start: context.window.start.toISOString(),
      end: context.window.end.toISOString(),
      comparisonStart: context.window.comparisonStart.toISOString(),
      comparisonEnd: context.window.comparisonEnd.toISOString(),
    },
    kpis: overviewKpis(calculateMetrics(current), calculateMetrics(previous), alerts.length),
    trend: trend(context, context.snapshot.orders),
    goal,
    locations: locationRows,
    topProducts: top.map(({ summary }) => summary),
    bottomProducts: bottom.map(({ summary }) => summary),
    stockSummary: selectedBalances({ ...context, status: null }).reduce(
      (summary, balance) => {
        const status = getStockStatus(balance.onHand, balance.minThreshold);
        if (status === "in_stock") summary.inStock += 1;
        else if (status === "low_stock") summary.lowStock += 1;
        else summary.outOfStock += 1;
        return summary;
      },
      { inStock: 0, lowStock: 0, outOfStock: 0 },
    ),
    alerts: alerts.slice(0, 10),
  };
  return { data: data as OverviewData, meta: makeMeta(context, noPagination()) };
};

export const buildLocations = async (
  context: AnalyticsContext,
): Promise<{ data: LocationsData; meta: ReturnType<typeof makeMeta> }> => {
  const allCurrent = ordersInWindow(
    context.snapshot.orders,
    context.window.start,
    context.window.end,
  );
  const allPrevious = ordersInWindow(
    context.snapshot.orders,
    context.window.comparisonStart,
    context.window.comparisonEnd,
  );
  const alerts = await activeAlerts(context);
  const locationValues = context.snapshot.locations.map((location) => ({
    location,
    current: groupFinancial(allCurrent, location.id),
    previous: groupFinancial(allPrevious, location.id),
    activeAlerts: alerts.filter((alert) => alert.locationId === location.id).length,
  }));
  const values = locationValues.map((value) => value.current.revenue);
  const allEqual =
    values.length < 2 ||
    values.every((value) => compare(parseDecimal(value), parseDecimal(values[0]!)) === 0);
  const max = values.length
    ? values.reduce((a, b) => (compare(parseDecimal(a), parseDecimal(b)) >= 0 ? a : b))
    : "0.00";
  const min = values.length
    ? values.reduce((a, b) => (compare(parseDecimal(a), parseDecimal(b)) <= 0 ? a : b))
    : "0.00";
  const filtered = locationValues.filter(
    ({ location }) => !context.locationId || location.id === context.locationId,
  );
  const sortValue = (value: (typeof locationValues)[number]): string => {
    switch (context.sortBy) {
      case "name":
        return value.location.name;
      case "grossProfit":
        return value.current.grossProfit;
      case "orders":
        return String(value.current.orders);
      case "averageCheck":
        return value.current.averageCheck ?? "0.00";
      case "grossMargin":
        return value.current.grossMargin ?? "0.00";
      case "activeAlerts":
        return String(value.activeAlerts);
      default:
        return value.current.revenue;
    }
  };
  filtered.sort((left, right) => {
    const leftValue = sortValue(left);
    const rightValue = sortValue(right);
    const compared =
      context.sortBy === "name"
        ? leftValue.localeCompare(rightValue)
        : compare(parseDecimal(leftValue), parseDecimal(rightValue));
    return (
      (context.sortDir === "asc" ? compared : -compared) ||
      left.location.sortOrder - right.location.sortOrder ||
      left.location.id.localeCompare(right.location.id)
    );
  });
  const data = {
    period: context.period,
    locationId: context.locationId,
    window: {
      start: context.window.start.toISOString(),
      end: context.window.end.toISOString(),
      comparisonStart: context.window.comparisonStart.toISOString(),
      comparisonEnd: context.window.comparisonEnd.toISOString(),
    },
    sortBy: context.sortBy ?? "revenue",
    sortDir: context.sortDir ?? "desc",
    locations: filtered.map(({ location, current, previous, activeAlerts }) => ({
      locationId: location.id,
      name: location.name,
      kpis: overviewKpis(current, previous, activeAlerts),
      performance: allEqual
        ? "standard"
        : compare(parseDecimal(current.revenue), parseDecimal(max)) === 0
          ? "best"
          : compare(parseDecimal(current.revenue), parseDecimal(min)) === 0
            ? "weak"
            : "standard",
    })),
  };
  return { data: data as LocationsData, meta: makeMeta(context, noPagination()) };
};

export const buildSales = async (
  context: AnalyticsContext,
): Promise<{ data: SalesData; recent: OrderRecord[] }> => {
  const current = selectedOrders(context, context.window.start, context.window.end);
  const previous = selectedOrders(
    context,
    context.window.comparisonStart,
    context.window.comparisonEnd,
  );
  const currentCompleted = current.filter((order) => order.status === "completed");
  const heat = new Map<
    string,
    { revenue: Decimal; orders: Set<string>; weekday: number; hour: number }
  >();
  for (const order of currentCompleted) {
    const { weekday, hour } = localWeekdayAndHour(order.orderedAt, context.snapshot.timeZone);
    const key = `${weekday}:${hour}`;
    const cell = heat.get(key) ?? {
      revenue: parseDecimal("0"),
      orders: new Set<string>(),
      weekday,
      hour,
    };
    cell.revenue = add(cell.revenue, parseDecimal(calculateMetrics([order]).revenue));
    cell.orders.add(order.id);
    heat.set(key, cell);
  }
  const heatmap = [...heat.values()].map((cell) => ({
    weekday: cell.weekday,
    hour: cell.hour,
    revenue: toMoney(cell.revenue),
    orders: cell.orders.size,
  }));
  const peakHours = [...heatmap]
    .sort(
      (a, b) =>
        b.orders - a.orders ||
        compare(parseDecimal(b.revenue), parseDecimal(a.revenue)) ||
        a.weekday - b.weekday ||
        a.hour - b.hour,
    )
    .slice(0, 3)
    .map(({ weekday, hour, orders: count }) => ({ weekday, hour, orders: count }));
  const recent = [...current].sort(
    (a, b) => b.orderedAt.getTime() - a.orderedAt.getTime() || b.id.localeCompare(a.id),
  );
  const data = {
    period: context.period,
    locationId: context.locationId,
    window: {
      start: context.window.start.toISOString(),
      end: context.window.end.toISOString(),
      comparisonStart: context.window.comparisonStart.toISOString(),
      comparisonEnd: context.window.comparisonEnd.toISOString(),
    },
    kpis: kpis(calculateMetrics(current), calculateMetrics(previous)),
    dailySeries: trend(context, context.snapshot.orders),
    heatmap,
    peakHours,
    locations: groupBreakdown(context, current, "location"),
    categories: groupBreakdown(context, current, "category"),
    products: groupBreakdown(context, current, "product"),
    recentOrders: [],
  };
  return { data: data as SalesData, recent };
};

export const buildProducts = async (
  context: AnalyticsContext,
): Promise<{ data: ProductsData; meta: ReturnType<typeof makeMeta> }> => {
  const result = productAnalytics(context);
  const data = {
    period: context.period,
    locationId: context.locationId,
    window: {
      start: context.window.start.toISOString(),
      end: context.window.end.toISOString(),
      comparisonStart: context.window.comparisonStart.toISOString(),
      comparisonEnd: context.window.comparisonEnd.toISOString(),
    },
    medians: result.medians,
    categories: context.snapshot.categories.map(({ id, name }) => ({ categoryId: id, name })),
    products: result.products.map((product) => {
      const { summary, ...rest } = product;
      void summary;
      return rest;
    }),
  };
  return { data: data as ProductsData, meta: makeMeta(context, noPagination()) };
};

export const buildInventory = async (
  context: AnalyticsContext,
): Promise<{ data: InventoryData; meta: ReturnType<typeof makeMeta> }> => {
  const locationMap = new Map(
    context.snapshot.locations.map((location) => [location.id, location]),
  );
  const itemMap = new Map(context.snapshot.inventoryItems.map((item) => [item.id, item]));
  const balances = selectedBalances(context).map((balance) => {
    const item = itemMap.get(balance.inventoryItemId)!;
    const location = locationMap.get(balance.locationId)!;
    return {
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      productId: item.productId,
      productName: item.productName,
      locationId: location.id,
      locationName: location.name,
      unit: item.unit,
      onHand: balance.onHand,
      minThreshold: balance.minThreshold,
      status: getStockStatus(balance.onHand, balance.minThreshold),
    };
  });
  const movements = context.snapshot.movements
    .filter((movement) => !context.locationId || movement.locationId === context.locationId)
    .filter((movement) => inWindow(movement.occurredAt, context.window.start, context.window.end))
    .map((movement) => {
      const item = itemMap.get(movement.inventoryItemId)!;
      const location = locationMap.get(movement.locationId)!;
      return {
        movementId: movement.id,
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        locationId: location.id,
        locationName: location.name,
        type: movement.type,
        quantity: movement.quantity,
        occurredAt: movement.occurredAt.toISOString(),
      };
    });
  const alerts = await activeAlerts(context);
  const data = {
    period: context.period,
    locationId: context.locationId,
    window: {
      start: context.window.start.toISOString(),
      end: context.window.end.toISOString(),
      comparisonStart: context.window.comparisonStart.toISOString(),
      comparisonEnd: context.window.comparisonEnd.toISOString(),
    },
    status: context.status,
    balances,
    movements,
    alerts: alerts
      .filter((alert) => alert.type !== "SALES_DROP")
      .filter(
        (alert) =>
          !context.status ||
          (context.status === "out_of_stock" && alert.type === "OUT_OF_STOCK") ||
          (context.status === "low_stock" && alert.type === "LOW_STOCK") ||
          (context.status === "in_stock" && false),
      ),
  };
  return { data: data as InventoryData, meta: makeMeta(context, noPagination()) };
};

export const buildAnalyticsSnapshot = async (
  transaction: RequestTransaction,
  options: AnalyticsOptions,
) => createAnalyticsContext(transaction, options);

export const buildSalesAnalyticsSnapshot = async (
  transaction: RequestTransaction,
  options: AnalyticsOptions,
) => createAnalyticsContext(transaction, options, "sales");

export const paginationDefaults = { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
