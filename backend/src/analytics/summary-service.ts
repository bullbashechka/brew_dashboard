import {
  analyticsMetaSchema,
  type LocationsData,
  type OverviewData,
} from "@brew-dashboard/contracts";
import { sql } from "drizzle-orm";

import type { RequestTransaction } from "../db/client.ts";
import {
  calculateComparisonPercent,
  calculateGoalCompletion,
  localCalendarParts,
  localDateKey,
  localDateTimeToUtc,
  resolvePeriodWindow,
  type AnalyticsPeriod,
} from "../domain/index.ts";
import {
  compare,
  divide,
  isZero,
  multiply,
  parseDecimal,
  subtract,
  toMoney,
  toPercentage,
  toQuantity,
} from "../domain/decimal.ts";

type SummaryOptions = {
  networkId: string;
  timeZone: string;
  period: AnalyticsPeriod;
  locationId?: string;
  sortBy?:
    "revenue" | "grossProfit" | "orders" | "averageCheck" | "grossMargin" | "activeAlerts" | "name";
  sortDir?: "asc" | "desc";
  asOf?: Date;
};

type JsonRecord = Record<string, unknown>;

type SummaryRow = {
  revision: unknown;
  selectedLocationId: unknown;
  locations: unknown;
  totals: unknown;
  products: unknown;
  trend: unknown;
  balances: unknown;
  target: unknown;
};

type LoadedSummary = {
  row: SummaryRow;
  asOf: Date;
  window: ReturnType<typeof resolvePeriodWindow>;
  requestedLocationId: string | null;
};

type FinancialMetrics = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  grossMargin: string | null;
  orders: number;
  averageCheck: string | null;
};

type LocationAggregate = {
  id: string;
  name: string;
  sortOrder: number;
  current: FinancialMetrics;
  previous: FinancialMetrics;
};

type Alert = OverviewData["alerts"][number];

const rowsOf = <T>(result: unknown): T[] => (result as { rows?: T[] }).rows ?? [];

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const records = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.map(record) : []);

const stringValue = (value: unknown): string => String(value ?? "");

const numberValue = (value: unknown): number => Number(value ?? 0);

const nullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const money = (value: unknown): string => toMoney(parseDecimal(stringValue(value) || "0"));

const quantity = (value: unknown): string => toQuantity(parseDecimal(stringValue(value) || "0"));

const percentageFromRatio = (numerator: string, denominator: string): string | null => {
  const denominatorValue = parseDecimal(denominator);
  if (isZero(denominatorValue)) return null;
  return toPercentage(
    multiply(divide(parseDecimal(numerator), denominatorValue, 6), parseDecimal("100")),
  );
};

const financialMetrics = (revenueValue: unknown, cogsValue: unknown, ordersValue: unknown) => {
  const revenue = money(revenueValue);
  const cogs = money(cogsValue);
  const grossProfit = toMoney(subtract(parseDecimal(revenue), parseDecimal(cogs)));
  const orders = numberValue(ordersValue);
  return {
    revenue,
    cogs,
    grossProfit,
    grossMargin: percentageFromRatio(grossProfit, revenue),
    orders,
    averageCheck:
      orders === 0 ? null : toMoney(divide(parseDecimal(revenue), parseDecimal(orders), 6)),
  } satisfies FinancialMetrics;
};

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

const overviewKpis = (
  current: FinancialMetrics,
  previous: FinancialMetrics,
  activeAlerts: number,
) => ({
  revenue: moneyMetric(current.revenue, previous.revenue),
  grossProfit: moneyMetric(current.grossProfit, previous.grossProfit),
  orders: countMetric(current.orders, previous.orders),
  averageCheck: nullableMoneyMetric(current.averageCheck, previous.averageCheck),
  grossMargin: percentageMetric(current.grossMargin, previous.grossMargin),
  activeAlerts: countMetric(activeAlerts, activeAlerts, false),
});

const addDays = (dateKey: string, offset: number): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + offset));
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()]
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

const deterministicUuid = async (value: string): Promise<string> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const loadSummary = async (
  transaction: RequestTransaction,
  options: SummaryOptions,
): Promise<LoadedSummary> => {
  const asOf = options.asOf ?? new Date();
  const window = resolvePeriodWindow(asOf, options.timeZone, options.period);
  const monthStart = monthStartUtc(asOf, options.timeZone);
  const lowerBound =
    monthStart.getTime() < window.comparisonStart.getTime() ? monthStart : window.comparisonStart;
  const requestedLocationId = options.locationId?.trim() || null;
  const result = await transaction.execute(sql`
    WITH selected_location AS MATERIALIZED (
      SELECT id
      FROM app.locations
      WHERE network_id = ${options.networkId}
        AND id::text = ${requestedLocationId}
      LIMIT 1
    ),
    location_base AS MATERIALIZED (
      SELECT id, name, sort_order
      FROM app.locations
      WHERE network_id = ${options.networkId}
    ),
    order_financials AS MATERIALIZED (
      SELECT o.id, o.location_id, o.ordered_at, o.status,
             COALESCE(sum(oi.quantity * oi.unit_price_at_sale), 0)::numeric AS revenue,
             COALESCE(sum(oi.quantity * oi.unit_cost_at_sale), 0)::numeric AS cogs
      FROM app.orders o
      LEFT JOIN app.order_items oi
        ON oi.network_id = o.network_id AND oi.order_id = o.id
      WHERE o.network_id = ${options.networkId}
        AND o.ordered_at >= ${lowerBound}
        AND o.ordered_at < ${asOf}
      GROUP BY o.id, o.location_id, o.ordered_at, o.status
    ),
    location_financials AS MATERIALIZED (
      SELECT l.id, l.name, l.sort_order,
             round(COALESCE(sum(o.revenue) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.start}
                 AND o.ordered_at < ${window.end}
             ), 0), 2)::text AS current_revenue,
             round(COALESCE(sum(o.cogs) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.start}
                 AND o.ordered_at < ${window.end}
             ), 0), 2)::text AS current_cogs,
             (count(o.id) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.start}
                 AND o.ordered_at < ${window.end}
             ))::int AS current_orders,
             round(COALESCE(sum(o.revenue) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.comparisonStart}
                 AND o.ordered_at < ${window.comparisonEnd}
             ), 0), 2)::text AS previous_revenue,
             round(COALESCE(sum(o.cogs) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.comparisonStart}
                 AND o.ordered_at < ${window.comparisonEnd}
             ), 0), 2)::text AS previous_cogs,
             (count(o.id) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.comparisonStart}
                 AND o.ordered_at < ${window.comparisonEnd}
             ))::int AS previous_orders
      FROM location_base l
      LEFT JOIN order_financials o ON o.location_id = l.id
      GROUP BY l.id, l.name, l.sort_order
    ),
    product_financials AS MATERIALIZED (
      SELECT p.id, p.name, c.name AS category_name, p.active,
             round(COALESCE(sum(oi.quantity) FILTER (
               WHERE o.status = 'completed'
             ), 0), 3)::text AS units_sold,
             round(COALESCE(sum(oi.quantity * oi.unit_price_at_sale) FILTER (
               WHERE o.status = 'completed'
             ), 0), 2)::text AS revenue,
             round(COALESCE(sum(oi.quantity * oi.unit_cost_at_sale) FILTER (
               WHERE o.status = 'completed'
             ), 0), 2)::text AS cogs
      FROM app.products p
      JOIN app.categories c
        ON c.network_id = p.network_id AND c.id = p.category_id
      LEFT JOIN app.order_items oi
        ON oi.network_id = p.network_id AND oi.product_id = p.id
      LEFT JOIN app.orders o
        ON o.network_id = oi.network_id AND o.id = oi.order_id
       AND o.ordered_at >= ${window.start}
       AND o.ordered_at < ${window.end}
       AND ((SELECT id FROM selected_location) IS NULL
            OR o.location_id = (SELECT id FROM selected_location))
      WHERE p.network_id = ${options.networkId}
      GROUP BY p.id, p.name, c.name, p.active
    ),
    trend_rows AS MATERIALIZED (
      SELECT CASE
               WHEN o.ordered_at >= ${window.start} AND o.ordered_at < ${window.end}
                 THEN 'current'
               ELSE 'previous'
             END AS phase,
             to_char(timezone(${options.timeZone}, o.ordered_at), 'YYYY-MM-DD') AS local_date,
             CASE WHEN ${options.period === "today"}
               THEN extract(hour FROM timezone(${options.timeZone}, o.ordered_at))::int
               ELSE 0
             END AS local_hour,
             round(sum(o.revenue), 2)::text AS revenue,
             round(sum(o.cogs), 2)::text AS cogs
      FROM order_financials o
      WHERE o.status = 'completed'
        AND (
          (o.ordered_at >= ${window.start} AND o.ordered_at < ${window.end})
          OR
          (o.ordered_at >= ${window.comparisonStart}
           AND o.ordered_at < ${window.comparisonEnd})
        )
        AND ((SELECT id FROM selected_location) IS NULL
             OR o.location_id = (SELECT id FROM selected_location))
      GROUP BY phase, local_date, local_hour
    )
    SELECT
      n.demo_data_revision AS revision,
      (SELECT id::text FROM selected_location) AS "selectedLocationId",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id::text,
          'name', name,
          'sortOrder', sort_order,
          'currentRevenue', current_revenue,
          'currentCogs', current_cogs,
          'currentOrders', current_orders,
          'previousRevenue', previous_revenue,
          'previousCogs', previous_cogs,
          'previousOrders', previous_orders
        ) ORDER BY sort_order, id)
        FROM location_financials
      ), '[]'::jsonb) AS locations,
      jsonb_build_object(
        'currentRevenue', round(COALESCE((SELECT sum(revenue) FROM order_financials
          WHERE status = 'completed'
            AND ordered_at >= ${window.start} AND ordered_at < ${window.end}
            AND ((SELECT id FROM selected_location) IS NULL
                 OR location_id = (SELECT id FROM selected_location))), 0), 2)::text,
        'currentCogs', round(COALESCE((SELECT sum(cogs) FROM order_financials
          WHERE status = 'completed'
            AND ordered_at >= ${window.start} AND ordered_at < ${window.end}
            AND ((SELECT id FROM selected_location) IS NULL
                 OR location_id = (SELECT id FROM selected_location))), 0), 2)::text,
        'currentOrders', COALESCE((SELECT count(*) FROM order_financials
          WHERE status = 'completed'
            AND ordered_at >= ${window.start} AND ordered_at < ${window.end}
            AND ((SELECT id FROM selected_location) IS NULL
                 OR location_id = (SELECT id FROM selected_location))), 0),
        'previousRevenue', round(COALESCE((SELECT sum(revenue) FROM order_financials
          WHERE status = 'completed'
            AND ordered_at >= ${window.comparisonStart}
            AND ordered_at < ${window.comparisonEnd}
            AND ((SELECT id FROM selected_location) IS NULL
                 OR location_id = (SELECT id FROM selected_location))), 0), 2)::text,
        'previousCogs', round(COALESCE((SELECT sum(cogs) FROM order_financials
          WHERE status = 'completed'
            AND ordered_at >= ${window.comparisonStart}
            AND ordered_at < ${window.comparisonEnd}
            AND ((SELECT id FROM selected_location) IS NULL
                 OR location_id = (SELECT id FROM selected_location))), 0), 2)::text,
        'previousOrders', COALESCE((SELECT count(*) FROM order_financials
          WHERE status = 'completed'
            AND ordered_at >= ${window.comparisonStart}
            AND ordered_at < ${window.comparisonEnd}
            AND ((SELECT id FROM selected_location) IS NULL
                 OR location_id = (SELECT id FROM selected_location))), 0),
        'goalRevenue', round(COALESCE((SELECT sum(revenue) FROM order_financials
          WHERE status = 'completed' AND ordered_at >= ${monthStart} AND ordered_at < ${asOf}), 0), 2)::text
      ) AS totals,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id::text,
          'name', name,
          'categoryName', category_name,
          'active', active,
          'unitsSold', units_sold,
          'revenue', revenue,
          'cogs', cogs
        ) ORDER BY id)
        FROM product_financials
      ), '[]'::jsonb) AS products,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'phase', phase,
          'date', local_date,
          'hour', local_hour,
          'revenue', revenue,
          'cogs', cogs
        ) ORDER BY phase, local_date, local_hour)
        FROM trend_rows
      ), '[]'::jsonb) AS trend,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'inventoryItemId', b.inventory_item_id::text,
          'itemName', i.name,
          'locationId', b.location_id::text,
          'locationName', l.name,
          'onHand', b.on_hand::text,
          'minThreshold', b.min_threshold::text
        ) ORDER BY b.location_id, b.inventory_item_id)
        FROM app.inventory_balances b
        JOIN app.inventory_items i
          ON i.network_id = b.network_id AND i.id = b.inventory_item_id
        JOIN location_base l ON l.id = b.location_id
        WHERE b.network_id = ${options.networkId}
          AND ((SELECT id FROM selected_location) IS NULL
               OR b.location_id = (SELECT id FROM selected_location))
      ), '[]'::jsonb) AS balances,
      (
        SELECT jsonb_build_object(
          'month', left(month::text, 7),
          'amount', amount::text,
          'version', version
        )
        FROM app.revenue_targets
        WHERE network_id = ${options.networkId}
          AND month = ${`${localDateKey(asOf, options.timeZone).slice(0, 7)}-01`}::date
        LIMIT 1
      ) AS target
    FROM app.networks n
    WHERE n.id = ${options.networkId}
    LIMIT 1
  `);
  const row = rowsOf<SummaryRow>(result)[0];
  if (!row) throw new Error("Authenticated network was not found");
  return { row, asOf, window, requestedLocationId };
};

const loadLocationsSummary = async (
  transaction: RequestTransaction,
  options: SummaryOptions,
): Promise<LoadedSummary> => {
  const asOf = options.asOf ?? new Date();
  const window = resolvePeriodWindow(asOf, options.timeZone, options.period);
  const requestedLocationId = options.locationId?.trim() || null;
  const result = await transaction.execute(sql`
    WITH selected_location AS MATERIALIZED (
      SELECT id
      FROM app.locations
      WHERE network_id = ${options.networkId}
        AND id::text = ${requestedLocationId}
      LIMIT 1
    ),
    location_base AS MATERIALIZED (
      SELECT id, name, sort_order
      FROM app.locations
      WHERE network_id = ${options.networkId}
    ),
    order_financials AS MATERIALIZED (
      SELECT o.id, o.location_id, o.ordered_at, o.status,
             COALESCE(sum(oi.quantity * oi.unit_price_at_sale), 0)::numeric AS revenue,
             COALESCE(sum(oi.quantity * oi.unit_cost_at_sale), 0)::numeric AS cogs
      FROM app.orders o
      LEFT JOIN app.order_items oi
        ON oi.network_id = o.network_id AND oi.order_id = o.id
      WHERE o.network_id = ${options.networkId}
        AND o.ordered_at >= ${window.comparisonStart}
        AND o.ordered_at < ${asOf}
      GROUP BY o.id, o.location_id, o.ordered_at, o.status
    ),
    location_financials AS MATERIALIZED (
      SELECT l.id, l.name, l.sort_order,
             round(COALESCE(sum(o.revenue) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.start}
                 AND o.ordered_at < ${window.end}
             ), 0), 2)::text AS current_revenue,
             round(COALESCE(sum(o.cogs) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.start}
                 AND o.ordered_at < ${window.end}
             ), 0), 2)::text AS current_cogs,
             (count(o.id) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.start}
                 AND o.ordered_at < ${window.end}
             ))::int AS current_orders,
             round(COALESCE(sum(o.revenue) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.comparisonStart}
                 AND o.ordered_at < ${window.comparisonEnd}
             ), 0), 2)::text AS previous_revenue,
             round(COALESCE(sum(o.cogs) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.comparisonStart}
                 AND o.ordered_at < ${window.comparisonEnd}
             ), 0), 2)::text AS previous_cogs,
             (count(o.id) FILTER (
               WHERE o.status = 'completed'
                 AND o.ordered_at >= ${window.comparisonStart}
                 AND o.ordered_at < ${window.comparisonEnd}
             ))::int AS previous_orders
      FROM location_base l
      LEFT JOIN order_financials o ON o.location_id = l.id
      GROUP BY l.id, l.name, l.sort_order
    )
    SELECT
      n.demo_data_revision AS revision,
      (SELECT id::text FROM selected_location) AS "selectedLocationId",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id::text,
          'name', name,
          'sortOrder', sort_order,
          'currentRevenue', current_revenue,
          'currentCogs', current_cogs,
          'currentOrders', current_orders,
          'previousRevenue', previous_revenue,
          'previousCogs', previous_cogs,
          'previousOrders', previous_orders
        ) ORDER BY sort_order, id)
        FROM location_financials
      ), '[]'::jsonb) AS locations,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'inventoryItemId', b.inventory_item_id::text,
          'itemName', i.name,
          'locationId', b.location_id::text,
          'locationName', l.name,
          'onHand', b.on_hand::text,
          'minThreshold', b.min_threshold::text
        ) ORDER BY b.location_id, b.inventory_item_id)
        FROM app.inventory_balances b
        JOIN app.inventory_items i
          ON i.network_id = b.network_id AND i.id = b.inventory_item_id
        JOIN location_base l ON l.id = b.location_id
        WHERE b.network_id = ${options.networkId}
          AND ((SELECT id FROM selected_location) IS NULL
               OR b.location_id = (SELECT id FROM selected_location))
      ), '[]'::jsonb) AS balances
    FROM app.networks n
    WHERE n.id = ${options.networkId}
    LIMIT 1
  `);
  const row = rowsOf<SummaryRow>(result)[0];
  if (!row) throw new Error("Authenticated network was not found");
  return { row, asOf, window, requestedLocationId };
};

const locationAggregates = (value: unknown): LocationAggregate[] =>
  records(value).map((item) => ({
    id: stringValue(item.id),
    name: stringValue(item.name),
    sortOrder: numberValue(item.sortOrder),
    current: financialMetrics(item.currentRevenue, item.currentCogs, item.currentOrders),
    previous: financialMetrics(item.previousRevenue, item.previousCogs, item.previousOrders),
  }));

const stockStatus = (onHand: string, minThreshold: string) => {
  const value = parseDecimal(onHand);
  if (isZero(value)) return "out_of_stock" as const;
  return compare(value, parseDecimal(minThreshold)) <= 0
    ? ("low_stock" as const)
    : ("in_stock" as const);
};

const buildAlerts = async (
  networkId: string,
  balancesValue: unknown,
  locations: LocationAggregate[],
): Promise<{ alerts: Alert[]; stockSummary: OverviewData["stockSummary"] }> => {
  const alerts: Alert[] = [];
  const stockSummary = { inStock: 0, lowStock: 0, outOfStock: 0 };
  for (const item of records(balancesValue)) {
    const onHand = quantity(item.onHand);
    const minThreshold = quantity(item.minThreshold);
    const status = stockStatus(onHand, minThreshold);
    if (status === "in_stock") stockSummary.inStock += 1;
    else if (status === "low_stock") stockSummary.lowStock += 1;
    else stockSummary.outOfStock += 1;
    if (status === "in_stock") continue;
    const locationId = stringValue(item.locationId);
    const inventoryItemId = stringValue(item.inventoryItemId);
    const type = status === "low_stock" ? "LOW_STOCK" : "OUT_OF_STOCK";
    alerts.push({
      id: await deterministicUuid(`${networkId}|${type}|${locationId}|${inventoryItemId}`),
      type,
      locationId,
      locationName: stringValue(item.locationName),
      entityId: inventoryItemId,
      entityName: stringValue(item.itemName),
      currentValue: onHand,
      previousValue: null,
      threshold: minThreshold,
    });
  }

  if (locations.length >= 2) {
    const allEqual = locations.every(
      (location) =>
        compare(
          parseDecimal(location.current.revenue),
          parseDecimal(locations[0]!.current.revenue),
        ) === 0,
    );
    if (!allEqual) {
      const weak = [...locations].sort(
        (left, right) =>
          compare(parseDecimal(left.current.revenue), parseDecimal(right.current.revenue)) ||
          left.sortOrder - right.sortOrder ||
          left.id.localeCompare(right.id),
      )[0]!;
      const previous = parseDecimal(weak.previous.revenue);
      const current = parseDecimal(weak.current.revenue);
      if (
        compare(previous, parseDecimal("0")) > 0 &&
        compare(current, multiply(previous, parseDecimal("0.8"))) <= 0
      ) {
        alerts.push({
          id: await deterministicUuid(`${networkId}|SALES_DROP|${weak.id}|null`),
          type: "SALES_DROP",
          locationId: weak.id,
          locationName: weak.name,
          entityId: null,
          entityName: null,
          currentValue: weak.current.revenue,
          previousValue: weak.previous.revenue,
          threshold: "-20.00",
        });
      }
    }
  }

  const rank = { OUT_OF_STOCK: 0, SALES_DROP: 1, LOW_STOCK: 2 } as const;
  alerts.sort(
    (left, right) =>
      rank[left.type] - rank[right.type] ||
      left.locationId.localeCompare(right.locationId) ||
      (left.entityId ?? "").localeCompare(right.entityId ?? ""),
  );
  return { alerts, stockSummary };
};

const buildTrend = (
  value: unknown,
  period: AnalyticsPeriod,
  asOf: Date,
  timeZone: string,
  window: ReturnType<typeof resolvePeriodWindow>,
): OverviewData["trend"] => {
  const values = new Map<string, { revenue: string; grossProfit: string }>();
  for (const item of records(value)) {
    const revenue = money(item.revenue);
    const grossProfit = toMoney(subtract(parseDecimal(revenue), parseDecimal(money(item.cogs))));
    values.set(`${stringValue(item.phase)}|${stringValue(item.date)}|${numberValue(item.hour)}`, {
      revenue,
      grossProfit,
    });
  }
  const empty = { revenue: "0.00", grossProfit: "0.00" };
  if (period === "today") {
    const currentDate = localDateKey(asOf, timeZone);
    const previousDate = addDays(currentDate, -1);
    const currentHour = localCalendarParts(asOf, timeZone).hour;
    return Array.from({ length: currentHour + 1 }, (_, hour) => {
      const current = values.get(`current|${currentDate}|${hour}`) ?? empty;
      const previous = values.get(`previous|${previousDate}|${hour}`) ?? empty;
      return {
        bucket: `${currentDate}T${String(hour).padStart(2, "0")}`,
        revenue: current.revenue,
        grossProfit: current.grossProfit,
        comparisonRevenue: previous.revenue,
        comparisonGrossProfit: previous.grossProfit,
      };
    });
  }

  const points: OverviewData["trend"] = [];
  const startDate = localDateKey(window.start, timeZone);
  const endDate = localDateKey(new Date(window.end.getTime() - 1), timeZone);
  const previousStartDate = localDateKey(window.comparisonStart, timeZone);
  let offset = 0;
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const previousDate = addDays(previousStartDate, offset);
    const current = Array.from({ length: 24 }, (_, hour) =>
      values.get(`current|${date}|${hour}`),
    ).filter((item): item is { revenue: string; grossProfit: string } => Boolean(item));
    const previous = Array.from({ length: 24 }, (_, hour) =>
      values.get(`previous|${previousDate}|${hour}`),
    ).filter((item): item is { revenue: string; grossProfit: string } => Boolean(item));
    const sum = (items: typeof current, field: "revenue" | "grossProfit") =>
      toMoney(
        items.reduce(
          (total, item) => ({
            integer: total.integer + parseDecimal(item[field]).integer,
            scale: 2,
          }),
          parseDecimal("0.00"),
        ),
      );
    points.push({
      bucket: date,
      revenue: sum(current, "revenue"),
      grossProfit: sum(current, "grossProfit"),
      comparisonRevenue: sum(previous, "revenue"),
      comparisonGrossProfit: sum(previous, "grossProfit"),
    });
    offset += 1;
  }
  return points;
};

const makeMeta = (
  summary: LoadedSummary,
  options: SummaryOptions,
  selectedLocationId: string | null,
) =>
  analyticsMetaSchema.parse({
    asOf: summary.asOf.toISOString(),
    demoDataRevision: numberValue(summary.row.revision),
    appliedFilters: {
      period: options.period,
      locationId: selectedLocationId,
      status: null,
      sortBy: options.sortBy ?? null,
      sortDir: options.sortDir ?? null,
    },
    warnings:
      summary.requestedLocationId && !selectedLocationId
        ? [{ code: "INVALID_LOCATION_FALLBACK", field: "locationId" }]
        : [],
    pagination: {
      mode: "none",
      page: null,
      pageSize: null,
      nextCursor: null,
      pageContext: null,
    },
  });

export const buildOverviewSummary = async (
  transaction: RequestTransaction,
  options: SummaryOptions,
): Promise<{ data: OverviewData; meta: ReturnType<typeof makeMeta> }> => {
  const summary = await loadSummary(transaction, options);
  const selectedLocationId = nullableString(summary.row.selectedLocationId);
  const locations = locationAggregates(summary.row.locations);
  const totals = record(summary.row.totals);
  const current = financialMetrics(totals.currentRevenue, totals.currentCogs, totals.currentOrders);
  const previous = financialMetrics(
    totals.previousRevenue,
    totals.previousCogs,
    totals.previousOrders,
  );
  const alertResult = await buildAlerts(options.networkId, summary.row.balances, locations);
  const visibleAlerts = alertResult.alerts.filter(
    (alert) => !selectedLocationId || alert.locationId === selectedLocationId,
  );
  const products = records(summary.row.products)
    .filter((item) => item.active === true)
    .map((item) => {
      const revenue = money(item.revenue);
      const grossProfit = toMoney(subtract(parseDecimal(revenue), parseDecimal(money(item.cogs))));
      return {
        productId: stringValue(item.id),
        name: stringValue(item.name),
        categoryName: stringValue(item.categoryName),
        unitsSold: quantity(item.unitsSold),
        revenue,
        grossProfit,
        grossMargin: percentageFromRatio(grossProfit, revenue),
        revenueShare: percentageFromRatio(revenue, current.revenue),
      };
    });
  const topProducts = [...products]
    .sort(
      (left, right) =>
        compare(parseDecimal(right.revenue), parseDecimal(left.revenue)) ||
        left.productId.localeCompare(right.productId),
    )
    .slice(0, 5);
  const used = new Set(topProducts.map((product) => product.productId));
  const bottomProducts = products
    .filter((product) => !used.has(product.productId))
    .sort(
      (left, right) =>
        compare(parseDecimal(left.revenue), parseDecimal(right.revenue)) ||
        left.productId.localeCompare(right.productId),
    )
    .slice(0, 5);
  const target = summary.row.target ? record(summary.row.target) : null;
  const goalRevenue = money(totals.goalRevenue);
  const data: OverviewData = {
    period: options.period,
    locationId: selectedLocationId,
    window: {
      start: summary.window.start.toISOString(),
      end: summary.window.end.toISOString(),
      comparisonStart: summary.window.comparisonStart.toISOString(),
      comparisonEnd: summary.window.comparisonEnd.toISOString(),
    },
    kpis: overviewKpis(current, previous, visibleAlerts.length),
    trend: buildTrend(
      summary.row.trend,
      options.period,
      summary.asOf,
      options.timeZone,
      summary.window,
    ),
    goal: target
      ? {
          month: stringValue(target.month),
          revenue: goalRevenue,
          target: money(target.amount),
          version: numberValue(target.version),
          completionPercent: calculateGoalCompletion(goalRevenue, money(target.amount)),
          scope: "network",
        }
      : null,
    locations: locations
      .filter((location) => !selectedLocationId || location.id === selectedLocationId)
      .map((location) => ({
        locationId: location.id,
        name: location.name,
        revenue: location.current.revenue,
        grossProfit: location.current.grossProfit,
        orders: location.current.orders,
        activeAlerts: visibleAlerts.filter((alert) => alert.locationId === location.id).length,
      })),
    topProducts,
    bottomProducts,
    stockSummary: alertResult.stockSummary,
    alerts: visibleAlerts.slice(0, 10),
  };
  return { data, meta: makeMeta(summary, options, selectedLocationId) };
};

export const buildLocationsSummary = async (
  transaction: RequestTransaction,
  options: SummaryOptions,
): Promise<{ data: LocationsData; meta: ReturnType<typeof makeMeta> }> => {
  const summary = await loadLocationsSummary(transaction, options);
  const selectedLocationId = nullableString(summary.row.selectedLocationId);
  const locations = locationAggregates(summary.row.locations);
  const alertResult = await buildAlerts(options.networkId, summary.row.balances, locations);
  const values = locations.map((location) => location.current.revenue);
  const allEqual =
    values.length < 2 ||
    values.every((value) => compare(parseDecimal(value), parseDecimal(values[0]!)) === 0);
  const max = values.reduce(
    (left, right) => (compare(parseDecimal(left), parseDecimal(right)) >= 0 ? left : right),
    "0.00",
  );
  const min = values.length
    ? values.reduce((left, right) =>
        compare(parseDecimal(left), parseDecimal(right)) <= 0 ? left : right,
      )
    : "0.00";
  const selected = locations.filter(
    (location) => !selectedLocationId || location.id === selectedLocationId,
  );
  const sortBy = options.sortBy ?? "revenue";
  const sortDir = options.sortDir ?? "desc";
  const alertCount = (locationId: string) =>
    alertResult.alerts.filter((alert) => alert.locationId === locationId).length;
  const sortValue = (location: LocationAggregate): string => {
    switch (sortBy) {
      case "name":
        return location.name;
      case "grossProfit":
        return location.current.grossProfit;
      case "orders":
        return String(location.current.orders);
      case "averageCheck":
        return location.current.averageCheck ?? "0.00";
      case "grossMargin":
        return location.current.grossMargin ?? "0.00";
      case "activeAlerts":
        return String(alertCount(location.id));
      default:
        return location.current.revenue;
    }
  };
  selected.sort((left, right) => {
    const leftValue = sortValue(left);
    const rightValue = sortValue(right);
    const compared =
      sortBy === "name"
        ? leftValue.localeCompare(rightValue)
        : compare(parseDecimal(leftValue), parseDecimal(rightValue));
    return (
      (sortDir === "asc" ? compared : -compared) ||
      left.sortOrder - right.sortOrder ||
      left.id.localeCompare(right.id)
    );
  });
  const data: LocationsData = {
    period: options.period,
    locationId: selectedLocationId,
    window: {
      start: summary.window.start.toISOString(),
      end: summary.window.end.toISOString(),
      comparisonStart: summary.window.comparisonStart.toISOString(),
      comparisonEnd: summary.window.comparisonEnd.toISOString(),
    },
    sortBy,
    sortDir,
    locations: selected.map((location) => ({
      locationId: location.id,
      name: location.name,
      kpis: overviewKpis(location.current, location.previous, alertCount(location.id)),
      performance: allEqual
        ? "standard"
        : compare(parseDecimal(location.current.revenue), parseDecimal(max)) === 0
          ? "best"
          : compare(parseDecimal(location.current.revenue), parseDecimal(min)) === 0
            ? "weak"
            : "standard",
    })),
  };
  return { data, meta: makeMeta(summary, options, selectedLocationId) };
};
