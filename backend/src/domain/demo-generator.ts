import { calculateFinancialMetrics } from "./metrics.ts";
import { classifyMenuProducts } from "./menu-engineering.ts";
import {
  localCalendarParts,
  localDateKey,
  localDateTimeToUtc,
  localWeekdayAndHour,
  resolvePeriodWindow,
  type LocalParts,
} from "./periods.ts";
import { computeAlerts, getStockStatus } from "./inventory.ts";

export const DEMO_GENERATOR_VERSION = "v1";
const HISTORY_DAYS = 180;
const DAILY_ORDER_SLOTS = [
  { hour: 8, minute: 10 },
  { hour: 10, minute: 35 },
  { hour: 12, minute: 5 },
  { hour: 14, minute: 25 },
  { hour: 17, minute: 10 },
  { hour: 19, minute: 35 },
] as const;
const MINIMAL_ORDER_SLOTS = [
  { hour: 0, minute: 0 },
  { hour: 0, minute: 0 },
  { hour: 0, minute: 0 },
  { hour: 0, minute: 0 },
  { hour: 0, minute: 0 },
  { hour: 0, minute: 0 },
  { hour: 0, minute: 0 },
  { hour: 0, minute: 0 },
] as const;

export type GeneratorLocation = {
  id: string;
  name: string;
  sortOrder: number;
};

export type DemoGeneratorInput = {
  version: string;
  networkId: string;
  localDate: string;
  timeZone: string;
  anchor: Date;
  locations: readonly GeneratorLocation[];
};

export type DemoCategoryRecord = {
  id: string;
  networkId: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoProductRecord = {
  id: string;
  networkId: string;
  categoryId: string;
  name: string;
  currentPrice: string;
  currentUnitCost: string;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoOrderRecord = {
  id: string;
  networkId: string;
  locationId: string;
  orderedAt: Date;
  status: "completed" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
};

export type DemoOrderItemRecord = {
  id: string;
  networkId: string;
  orderId: string;
  productId: string;
  quantity: string;
  unitPriceAtSale: string;
  unitCostAtSale: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoInventoryItemRecord = {
  id: string;
  networkId: string;
  name: string;
  unit: "pcs" | "kg" | "l";
  productId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoInventoryBalanceRecord = {
  id: string;
  networkId: string;
  locationId: string;
  inventoryItemId: string;
  onHand: string;
  minThreshold: string;
  baselineQuantity: string;
  consumedQuantity: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoInventoryMovementRecord = {
  id: string;
  networkId: string;
  locationId: string;
  inventoryItemId: string;
  type: "receipt";
  quantity: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoRevenueTargetRecord = {
  id: string;
  networkId: string;
  month: string;
  amount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoDataCounts = {
  locations: number;
  categories: number;
  products: number;
  orders: number;
  orderItems: number;
  inventoryItems: number;
  inventoryBalances: number;
  inventoryMovements: number;
  revenueTargets: number;
};

export type GeneratedDemoData = {
  version: string;
  networkId: string;
  generatedForDate: string;
  timeZone: string;
  anchor: Date;
  seed: number;
  generationId: string;
  locations: GeneratorLocation[];
  categories: DemoCategoryRecord[];
  products: DemoProductRecord[];
  orders: DemoOrderRecord[];
  orderItems: DemoOrderItemRecord[];
  inventoryItems: DemoInventoryItemRecord[];
  inventoryBalances: DemoInventoryBalanceRecord[];
  inventoryMovements: DemoInventoryMovementRecord[];
  revenueTargets: DemoRevenueTargetRecord[];
  counts: DemoDataCounts;
};

type ProductBlueprint = {
  name: string;
  category: number;
  priceCents: number;
  costCents: number;
  unit: "pcs" | "kg" | "l";
};

const PRODUCT_BLUEPRINTS: readonly ProductBlueprint[] = [
  { name: "House Latte", category: 0, priceCents: 650, costCents: 240, unit: "pcs" },
  { name: "Cappuccino", category: 0, priceCents: 600, costCents: 220, unit: "pcs" },
  { name: "Espresso", category: 0, priceCents: 400, costCents: 120, unit: "pcs" },
  { name: "Americano", category: 0, priceCents: 450, costCents: 360, unit: "pcs" },
  { name: "Mocha", category: 0, priceCents: 700, costCents: 610, unit: "pcs" },
  { name: "Flat White", category: 0, priceCents: 680, costCents: 590, unit: "pcs" },
  { name: "Berry Bowl", category: 1, priceCents: 950, costCents: 430, unit: "kg" },
  { name: "Avocado Toast", category: 1, priceCents: 1050, costCents: 520, unit: "kg" },
  { name: "Granola Cup", category: 1, priceCents: 750, costCents: 300, unit: "kg" },
  { name: "Iced Tea", category: 2, priceCents: 420, costCents: 390, unit: "l" },
  { name: "Lemonade", category: 2, priceCents: 500, costCents: 470, unit: "l" },
  { name: "Still Water", category: 2, priceCents: 250, costCents: 230, unit: "l" },
];

const CATEGORY_NAMES = ["Coffee", "Food", "Cold drinks"] as const;
const WEIGHTED_PRODUCTS = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 6, 7, 7, 8, 9, 10, 11];
const CURRENT_DAY_WEIGHTED_PRODUCTS = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5];

export const isDemoDataStale = (
  generatedForDate: string | null,
  timeZone: string | null,
  now: Date,
): boolean =>
  Boolean(generatedForDate && timeZone) && generatedForDate !== localDateKey(now, timeZone!);

const formatMoney = (cents: number): string => {
  const normalized = Math.max(0, Math.round(cents));
  return `${Math.floor(normalized / 100)}.${String(normalized % 100).padStart(2, "0")}`;
};

const formatQuantity = (value: number): string => {
  const normalized = Math.max(0, Math.round(value * 1000) / 1000);
  return normalized.toFixed(3);
};

const dateParts = (dateKey: string): Pick<LocalParts, "year" | "month" | "day"> => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid local date: ${dateKey}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

const dateKeyOffset = (dateKey: string, offsetDays: number): string => {
  const value = dateParts(dateKey);
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + offsetDays));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
};

const monthKey = (dateKey: string): string => `${dateKey.slice(0, 7)}-01`;

const atLocalTime = (
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null => {
  const value = dateParts(dateKey);
  return localDateTimeToUtc({ ...value, hour, minute, second: 0, millisecond: 0 }, timeZone);
};

const sha256 = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const uuidFromPath = async (input: DemoGeneratorInput, path: string): Promise<string> => {
  const bytes = await sha256(`${input.version}|${input.networkId}|${input.localDate}|${path}`);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const createRandom = (seed: number) => {
  let state = BigInt(seed || 1);
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    return Number(state & 0xffffffffn) / 0x100000000;
  };
};

const seedFromDigest = (bytes: Uint8Array): number => {
  let seed = 0;
  for (let index = 0; index < 6; index += 1) seed = seed * 256 + bytes[index]!;
  return seed;
};

const sortedLocations = (locations: readonly GeneratorLocation[]) =>
  [...locations].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );

const locationCycle = (count: number): number[] => {
  if (count <= 1) return [0];
  if (count === 2)
    return [...Array.from({ length: 13 }, () => 0), ...Array.from({ length: 7 }, () => 1)];

  const cycle = [...Array.from({ length: 7 }, () => 0), ...Array.from({ length: 2 }, () => 1)];
  let next = 2;
  for (let index = 0; index < 11; index += 1) {
    cycle.push(next);
    next += 1;
    if (next >= count) next = 2;
  }
  return cycle;
};

const currentDaySlots = (input: DemoGeneratorInput): Date[] => {
  const dates = [...MINIMAL_ORDER_SLOTS, ...DAILY_ORDER_SLOTS]
    .map(({ hour, minute }) => atLocalTime(input.localDate, hour, minute, input.timeZone))
    .filter((value): value is Date => value !== null && value.getTime() <= input.anchor.getTime());
  while (dates.length < 4) dates.push(dates.at(-1) ?? input.anchor);
  return dates;
};

const historicalDaySlots = (dateKey: string, timeZone: string): Date[] =>
  [...MINIMAL_ORDER_SLOTS, ...DAILY_ORDER_SLOTS]
    .map(({ hour, minute }) => atLocalTime(dateKey, hour, minute, timeZone))
    .filter((value): value is Date => value !== null);

const productQuantity = (productIndex: number, random: () => number): number => {
  if (productIndex <= 5) return random() < 0.25 ? 2 : 1;
  return 1;
};

const snapshotCents = (baseCents: number, dayOffset: number, itemIndex: number): number => {
  const shift = ((dayOffset + itemIndex) % 5) * 5;
  return Math.max(0, baseCents - shift);
};

export class DemoGeneratorVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoGeneratorVerificationError";
  }
}

export const generateDemoData = async (input: DemoGeneratorInput): Promise<GeneratedDemoData> => {
  if (input.version !== DEMO_GENERATOR_VERSION) {
    throw new Error(`Unsupported demo generator version: ${input.version}`);
  }
  if (!Number.isFinite(input.anchor.getTime())) throw new Error("Generator anchor is invalid");
  if (localDateKey(input.anchor, input.timeZone) !== input.localDate) {
    throw new Error("Generator local date does not match its anchor");
  }

  const locations = sortedLocations(input.locations);
  if (locations.length < 1 || locations.length > 5)
    throw new Error("Generator needs 1–5 locations");
  const seed = seedFromDigest(
    await sha256(`${input.version}|${input.networkId}|${input.localDate}`),
  );
  const random = createRandom(seed);
  const anchor = new Date(input.anchor);
  const categories: DemoCategoryRecord[] = [];
  for (const [sortOrder, name] of CATEGORY_NAMES.entries()) {
    const id = await uuidFromPath(input, `category:${sortOrder}`);
    categories.push({
      id,
      networkId: input.networkId,
      name,
      sortOrder,
      createdAt: anchor,
      updatedAt: anchor,
    });
  }

  const products: DemoProductRecord[] = [];
  const inventoryItems: DemoInventoryItemRecord[] = [];
  for (const [index, blueprint] of PRODUCT_BLUEPRINTS.entries()) {
    const productId = await uuidFromPath(input, `product:${index}`);
    products.push({
      id: productId,
      networkId: input.networkId,
      categoryId: categories[blueprint.category]!.id,
      name: blueprint.name,
      currentPrice: formatMoney(blueprint.priceCents),
      currentUnitCost: formatMoney(blueprint.costCents),
      active: true,
      version: 1,
      createdAt: anchor,
      updatedAt: anchor,
    });
    inventoryItems.push({
      id: await uuidFromPath(input, `inventory-item:${index}`),
      networkId: input.networkId,
      name: blueprint.name,
      unit: blueprint.unit,
      productId,
      createdAt: anchor,
      updatedAt: anchor,
    });
  }

  const orders: DemoOrderRecord[] = [];
  const orderItems: DemoOrderItemRecord[] = [];
  const unitsByLocationProduct = new Map<string, number>();
  const cycle = locationCycle(locations.length);
  const dropLocationIndex = locations.length === 1 ? 0 : 1;
  let globalOrderIndex = 0;

  for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset -= 1) {
    const dateKey = dateKeyOffset(input.localDate, -dayOffset);
    const slots =
      dayOffset === 0 ? currentDaySlots(input) : historicalDaySlots(dateKey, input.timeZone);
    for (const [slotIndex, orderedAt] of slots.entries()) {
      const isCurrentSeedOrder = dayOffset === 0 && slotIndex < 4;
      const isPreviousSalesBaseline = dayOffset === 1 && slotIndex < MINIMAL_ORDER_SLOTS.length;
      const locationIndex =
        locations.length > 1 && isCurrentSeedOrder
          ? 0
          : locations.length > 1 && isPreviousSalesBaseline
            ? dropLocationIndex
            : cycle[globalOrderIndex % cycle.length]!;
      if (dayOffset === 0 && slotIndex >= 4 && locationIndex === dropLocationIndex) {
        globalOrderIndex += 1;
        continue;
      }

      const orderId = await uuidFromPath(input, `order:${dateKey}:${globalOrderIndex}`);
      const status =
        isCurrentSeedOrder || isPreviousSalesBaseline
          ? "completed"
          : globalOrderIndex % 33 === 0
            ? "cancelled"
            : "completed";
      orders.push({
        id: orderId,
        networkId: input.networkId,
        locationId: locations[locationIndex]!.id,
        orderedAt,
        status,
        createdAt: orderedAt,
        updatedAt: orderedAt,
      });

      const itemCount = isCurrentSeedOrder ? 3 : (globalOrderIndex % 3) + 1;
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        const productIndex = isCurrentSeedOrder
          ? slotIndex * 3 + itemIndex
          : isPreviousSalesBaseline
            ? 0
            : dayOffset === 0
              ? CURRENT_DAY_WEIGHTED_PRODUCTS[
                  Math.floor(random() * CURRENT_DAY_WEIGHTED_PRODUCTS.length)
                ]!
              : globalOrderIndex < PRODUCT_BLUEPRINTS.length && itemIndex === 0
                ? globalOrderIndex
                : WEIGHTED_PRODUCTS[Math.floor(random() * WEIGHTED_PRODUCTS.length)]!;
        const blueprint = PRODUCT_BLUEPRINTS[productIndex]!;
        const quantity = isCurrentSeedOrder
          ? productIndex <= 5
            ? 2
            : 1
          : isPreviousSalesBaseline
            ? 2
            : productQuantity(productIndex, random);
        const itemId = await uuidFromPath(
          input,
          `order-item:${dateKey}:${globalOrderIndex}:${itemIndex}`,
        );
        orderItems.push({
          id: itemId,
          networkId: input.networkId,
          orderId,
          productId: products[productIndex]!.id,
          quantity: formatQuantity(quantity),
          unitPriceAtSale: formatMoney(snapshotCents(blueprint.priceCents, dayOffset, itemIndex)),
          unitCostAtSale: formatMoney(blueprint.costCents),
          createdAt: orderedAt,
          updatedAt: orderedAt,
        });
        if (status === "completed") {
          const key = `${locationIndex}:${productIndex}`;
          unitsByLocationProduct.set(key, (unitsByLocationProduct.get(key) ?? 0) + quantity);
        }
      }
      globalOrderIndex += 1;
    }
  }

  const inventoryBalances: DemoInventoryBalanceRecord[] = [];
  const inventoryMovements: DemoInventoryMovementRecord[] = [];
  for (const [locationIndex, location] of locations.entries()) {
    for (const [productIndex, item] of inventoryItems.entries()) {
      const blueprint = PRODUCT_BLUEPRINTS[productIndex]!;
      const precision = blueprint.unit === "pcs" ? 1 : 0.5;
      const isOutOfStock = productIndex === 0 && locationIndex === 0;
      const isLowStock =
        productIndex === 1 && (locations.length === 1 || locationIndex === dropLocationIndex);
      const threshold = blueprint.unit === "pcs" ? (isLowStock ? 4 : 6) : isLowStock ? 2 : 3;
      const onHand = isOutOfStock ? 0 : isLowStock ? threshold : threshold + 5;
      const consumedBase =
        blueprint.unit === "pcs" ? 12 + (productIndex % 4) : 4 + productIndex / 10;
      const consumed = Math.round(consumedBase / precision) * precision;
      const baseline = onHand + consumed;
      const balanceId = await uuidFromPath(
        input,
        `inventory-balance:${locationIndex}:${productIndex}`,
      );
      const movementId = await uuidFromPath(
        input,
        `inventory-movement:${locationIndex}:${productIndex}`,
      );
      const occurredAt = atLocalTime(input.localDate, 0, 0, input.timeZone) ?? anchor;
      const balance = {
        id: balanceId,
        networkId: input.networkId,
        locationId: location.id,
        inventoryItemId: item.id,
        onHand: formatQuantity(onHand),
        minThreshold: formatQuantity(threshold),
        baselineQuantity: formatQuantity(baseline),
        consumedQuantity: formatQuantity(consumed),
        createdAt: anchor,
        updatedAt: anchor,
      };
      inventoryBalances.push(balance);
      inventoryMovements.push({
        id: movementId,
        networkId: input.networkId,
        locationId: location.id,
        inventoryItemId: item.id,
        type: "receipt",
        quantity: balance.baselineQuantity,
        occurredAt,
        createdAt: anchor,
        updatedAt: anchor,
      });
    }
  }

  const currentMonth = monthKey(input.localDate);
  const revenueTargets: DemoRevenueTargetRecord[] = [
    {
      id: await uuidFromPath(input, `revenue-target:${currentMonth}`),
      networkId: input.networkId,
      month: currentMonth,
      amount: formatMoney(35_000 + (seed % 5_000)),
      version: 1,
      createdAt: anchor,
      updatedAt: anchor,
    },
  ];

  const generated: GeneratedDemoData = {
    version: input.version,
    networkId: input.networkId,
    generatedForDate: input.localDate,
    timeZone: input.timeZone,
    anchor,
    seed,
    generationId: await uuidFromPath(input, "generation"),
    locations,
    categories,
    products,
    orders,
    orderItems,
    inventoryItems,
    inventoryBalances,
    inventoryMovements,
    revenueTargets,
    counts: {
      locations: locations.length,
      categories: categories.length,
      products: products.length,
      orders: orders.length,
      orderItems: orderItems.length,
      inventoryItems: inventoryItems.length,
      inventoryBalances: inventoryBalances.length,
      inventoryMovements: inventoryMovements.length,
      revenueTargets: revenueTargets.length,
    },
  };

  verifyDemoData(generated);
  return generated;
};

const completedOrdersInWindow = (
  data: GeneratedDemoData,
  start: Date,
  end: Date,
  locationId?: string,
) => {
  const orderIds = new Set(
    data.orders
      .filter(
        (order) =>
          order.status === "completed" &&
          order.orderedAt >= start &&
          order.orderedAt <= end &&
          (!locationId || order.locationId === locationId),
      )
      .map((order) => order.id),
  );
  const itemsByOrder = new Map<string, typeof data.orderItems>();
  for (const item of data.orderItems) {
    if (!orderIds.has(item.orderId)) continue;
    const items = itemsByOrder.get(item.orderId) ?? [];
    items.push(item);
    itemsByOrder.set(item.orderId, items);
  }
  return data.orders
    .filter((order) => orderIds.has(order.id))
    .map((order) => ({
      status: order.status,
      items: itemsByOrder.get(order.id) ?? [],
    }));
};

export const verifyDemoData = (data: GeneratedDemoData): void => {
  if (data.categories.length !== 3)
    throw new DemoGeneratorVerificationError("Expected three categories");
  if (data.products.length !== 12)
    throw new DemoGeneratorVerificationError("Expected twelve products");
  if (data.orders.length > 3_000) throw new DemoGeneratorVerificationError("Order cap exceeded");
  if (data.orders.some((order) => order.orderedAt > data.anchor)) {
    throw new DemoGeneratorVerificationError("Generated order is later than the UTC anchor");
  }
  if (data.inventoryMovements.some((movement) => movement.occurredAt > data.anchor)) {
    throw new DemoGeneratorVerificationError(
      "Generated inventory movement is later than the UTC anchor",
    );
  }
  if (data.orders.length > 100 && !data.orders.some((order) => order.status === "cancelled")) {
    throw new DemoGeneratorVerificationError("Cancelled-order coverage is missing");
  }

  const ordersById = new Map(data.orders.map((order) => [order.id, order]));
  const itemsByOrder = new Map<string, DemoOrderItemRecord[]>();
  for (const item of data.orderItems) {
    const items = itemsByOrder.get(item.orderId) ?? [];
    items.push(item);
    itemsByOrder.set(item.orderId, items);
  }

  const unitsByProduct = new Map<string, number>();
  for (const item of data.orderItems) {
    const order = ordersById.get(item.orderId);
    if (order?.status !== "completed") continue;
    unitsByProduct.set(
      item.productId,
      (unitsByProduct.get(item.productId) ?? 0) + Number(item.quantity),
    );
  }
  const menu = classifyMenuProducts(
    data.products.map((product) => ({
      productId: product.id,
      active: product.active,
      unitsSold: formatQuantity(unitsByProduct.get(product.id) ?? 0),
      currentPrice: product.currentPrice,
      currentUnitCost: product.currentUnitCost,
    })),
  );
  if (new Set(menu.products.map((product) => product.group)).size !== 4) {
    throw new DemoGeneratorVerificationError("All four menu engineering groups are required");
  }

  const orderedProducts = [...unitsByProduct.entries()].sort((left, right) => right[1] - left[1]);
  if (
    orderedProducts.length < 2 ||
    orderedProducts[0]![1] <= 0 ||
    orderedProducts.at(-1)![1] <= 0 ||
    orderedProducts[0]![0] === orderedProducts.at(-1)![0]
  ) {
    throw new DemoGeneratorVerificationError("Top and bottom product coverage is required");
  }

  for (const periodName of ["today", "7d", "30d", "6m"] as const) {
    const window = resolvePeriodWindow(data.anchor, data.timeZone, periodName);
    const periodUnits = new Map<string, number>();
    for (const order of data.orders) {
      if (
        order.status !== "completed" ||
        order.orderedAt < window.start ||
        order.orderedAt > window.end
      ) {
        continue;
      }
      for (const item of itemsByOrder.get(order.id) ?? []) {
        periodUnits.set(
          item.productId,
          (periodUnits.get(item.productId) ?? 0) + Number(item.quantity),
        );
      }
    }
    const periodMenu = classifyMenuProducts(
      data.products.map((product) => ({
        productId: product.id,
        active: product.active,
        unitsSold: formatQuantity(periodUnits.get(product.id) ?? 0),
        currentPrice: product.currentPrice,
        currentUnitCost: product.currentUnitCost,
      })),
    );
    if (new Set(periodMenu.products.map((product) => product.group)).size !== 4) {
      throw new DemoGeneratorVerificationError(
        `All four menu engineering groups are required for ${periodName}`,
      );
    }
  }

  const balances = data.inventoryBalances.map((balance) => ({
    inventoryItemId: balance.inventoryItemId,
    locationId: balance.locationId,
    locationName:
      data.inventoryItems.find((item) => item.id === balance.inventoryItemId)?.name ?? "",
    productName:
      data.inventoryItems.find((item) => item.id === balance.inventoryItemId)?.name ?? "",
    onHand: balance.onHand,
    minThreshold: balance.minThreshold,
  }));
  const statuses = balances.map((balance) => getStockStatus(balance.onHand, balance.minThreshold));
  if (!statuses.includes("low_stock") || !statuses.includes("out_of_stock")) {
    throw new DemoGeneratorVerificationError("Low-stock and out-of-stock coverage is required");
  }

  const period = resolvePeriodWindow(data.anchor, data.timeZone, "today");
  const locationDrops = data.locations;
  const salesDrops = locationDrops.map((location) => ({
    locationId: location.id,
    locationName: location.name,
    currentRevenue: calculateFinancialMetrics(
      completedOrdersInWindow(data, period.start, period.end, location.id),
    ).revenue,
    previousRevenue: calculateFinancialMetrics(
      completedOrdersInWindow(data, period.comparisonStart, period.comparisonEnd, location.id),
    ).revenue,
  }));
  const alerts = computeAlerts(balances, salesDrops);
  if (!alerts.some((alert) => alert.type === "SALES_DROP")) {
    throw new DemoGeneratorVerificationError("Sales-drop coverage is required");
  }

  const yesterdayDate = dateKeyOffset(data.generatedForDate, -1);
  const yesterdayOrders = data.orders.filter(
    (order) => localDateKey(order.orderedAt, data.timeZone) === yesterdayDate,
  );
  const todayOrders = data.orders.filter(
    (order) => localDateKey(order.orderedAt, data.timeZone) === data.generatedForDate,
  );
  if (yesterdayOrders.length === 0 || todayOrders.length === 0) {
    throw new DemoGeneratorVerificationError("Today and Yesterday coverage is required");
  }
  if (
    !data.orders.some(
      (order) =>
        localDateKey(order.orderedAt, data.timeZone) === yesterdayDate &&
        localCalendarParts(order.orderedAt, data.timeZone).hour >= 8 &&
        localCalendarParts(order.orderedAt, data.timeZone).hour < 11,
    )
  ) {
    throw new DemoGeneratorVerificationError("Morning peak coverage is required");
  }
  if (
    !data.orders.some(
      (order) =>
        localDateKey(order.orderedAt, data.timeZone) === yesterdayDate &&
        localCalendarParts(order.orderedAt, data.timeZone).hour >= 12 &&
        localCalendarParts(order.orderedAt, data.timeZone).hour < 16,
    )
  ) {
    throw new DemoGeneratorVerificationError("Daytime peak coverage is required");
  }

  const weekdays = data.orders.map((order) => localWeekdayAndHour(order.orderedAt, data.timeZone));
  if (weekdays.length === 0) throw new DemoGeneratorVerificationError("Order data is required");
};
