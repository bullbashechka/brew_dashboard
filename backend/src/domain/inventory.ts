import { compare, parseDecimal, toQuantity, type Decimal } from "./decimal.ts";

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export type InventoryBalanceForAlerts = {
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  productName: string;
  onHand: string;
  minThreshold: string;
};

export type SalesDropCandidate = {
  locationId: string;
  locationName: string;
  currentRevenue: string;
  previousRevenue: string;
};

export type ComputedAlert = {
  type: "LOW_STOCK" | "OUT_OF_STOCK" | "SALES_DROP";
  locationId: string;
  locationName: string;
  entityId: string | null;
  entityName: string | null;
  currentValue: string | null;
  previousValue: string | null;
  threshold: string | null;
};

export type StockSummary = {
  inStock: number;
  lowStock: number;
  outOfStock: number;
};

export function getStockStatus(onHandValue: string, thresholdValue: string): StockStatus {
  const onHand = parseDecimal(onHandValue);
  const threshold = parseDecimal(thresholdValue);
  if (compare(onHand, parseDecimal("0")) < 0 || compare(threshold, parseDecimal("0")) < 0) {
    throw new Error("Stock values cannot be negative");
  }
  if (compare(onHand, parseDecimal("0")) === 0) {
    return "out_of_stock";
  }
  return compare(onHand, threshold) <= 0 ? "low_stock" : "in_stock";
}

export function summarizeStock(
  balances: readonly Pick<InventoryBalanceForAlerts, "onHand" | "minThreshold">[],
): StockSummary {
  return balances.reduce<StockSummary>(
    (summary, balance) => {
      const status = getStockStatus(balance.onHand, balance.minThreshold);
      summary[
        status === "in_stock" ? "inStock" : status === "low_stock" ? "lowStock" : "outOfStock"
      ] += 1;
      return summary;
    },
    { inStock: 0, lowStock: 0, outOfStock: 0 },
  );
}

export function computeAlerts(
  balances: readonly InventoryBalanceForAlerts[],
  salesDrops: readonly SalesDropCandidate[] = [],
): ComputedAlert[] {
  const alerts: ComputedAlert[] = [];
  for (const balance of balances) {
    const status = getStockStatus(balance.onHand, balance.minThreshold);
    if (status === "in_stock") {
      continue;
    }
    alerts.push({
      type: status === "low_stock" ? "LOW_STOCK" : "OUT_OF_STOCK",
      locationId: balance.locationId,
      locationName: balance.locationName,
      entityId: balance.inventoryItemId,
      entityName: balance.productName,
      currentValue: toQuantity(parseDecimal(balance.onHand)),
      previousValue: null,
      threshold: toQuantity(parseDecimal(balance.minThreshold)),
    });
  }

  for (const candidate of salesDrops) {
    const previous = parseDecimal(candidate.previousRevenue);
    const current = parseDecimal(candidate.currentRevenue);
    if (compare(previous, parseDecimal("0")) <= 0) {
      continue;
    }
    const eightyPercentOfPrevious: Decimal = {
      integer: previous.integer * 80n,
      scale: previous.scale + 2,
    };
    if (compare(current, eightyPercentOfPrevious) > 0) {
      continue;
    }
    alerts.push({
      type: "SALES_DROP",
      locationId: candidate.locationId,
      locationName: candidate.locationName,
      entityId: null,
      entityName: null,
      currentValue: candidate.currentRevenue,
      previousValue: candidate.previousRevenue,
      threshold: "-20.00",
    });
  }
  return alerts;
}
