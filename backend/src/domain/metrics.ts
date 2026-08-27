import {
  add,
  divide,
  isZero,
  multiply,
  parseDecimal,
  subtract,
  toMoney,
  toPercentage,
  type Decimal,
} from "./decimal.ts";

export type FinancialOrderItem = {
  quantity: string;
  unitPriceAtSale: string;
  unitCostAtSale: string;
};

export type FinancialOrder = {
  status: "completed" | "cancelled";
  items: readonly FinancialOrderItem[];
};

export type FinancialMetrics = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  grossMargin: string | null;
  orders: number;
  averageCheck: string | null;
};

const percentFromRatio = (numerator: Decimal, denominator: Decimal): string | null => {
  if (isZero(denominator)) {
    return null;
  }
  return toPercentage(multiply(divide(numerator, denominator, 6), parseDecimal(100)));
};

export function calculateFinancialMetrics(orders: readonly FinancialOrder[]): FinancialMetrics {
  let revenue: Decimal = parseDecimal("0");
  let cogs: Decimal = parseDecimal("0");
  let completedOrders = 0;

  for (const order of orders) {
    if (order.status !== "completed") {
      continue;
    }

    completedOrders += 1;
    for (const item of order.items) {
      const quantity = parseDecimal(item.quantity);
      revenue = add(revenue, multiply(quantity, parseDecimal(item.unitPriceAtSale)));
      cogs = add(cogs, multiply(quantity, parseDecimal(item.unitCostAtSale)));
    }
  }

  const roundedRevenue = parseDecimal(toMoney(revenue));
  const roundedCogs = parseDecimal(toMoney(cogs));
  const grossProfit = subtract(roundedRevenue, roundedCogs);

  return {
    revenue: toMoney(roundedRevenue),
    cogs: toMoney(roundedCogs),
    grossProfit: toMoney(grossProfit),
    grossMargin: percentFromRatio(grossProfit, roundedRevenue),
    orders: completedOrders,
    averageCheck:
      completedOrders === 0
        ? null
        : toMoney(divide(roundedRevenue, parseDecimal(completedOrders), 6)),
  };
}

export function calculateComparisonPercent(
  current: string | null,
  previous: string | null,
): string | null {
  if (current === null || previous === null) {
    return null;
  }

  const previousValue = parseDecimal(previous);
  if (isZero(previousValue)) {
    return null;
  }

  return percentFromRatio(subtract(parseDecimal(current), previousValue), previousValue);
}

export function calculateCurrentUnitMargin(
  currentPrice: string,
  currentUnitCost: string,
): string | null {
  const price = parseDecimal(currentPrice);
  if (isZero(price)) {
    return null;
  }
  return percentFromRatio(subtract(price, parseDecimal(currentUnitCost)), price);
}

export function calculateGoalCompletion(
  currentMonthRevenue: string,
  monthlyGoal: string,
): string | null {
  const goal = parseDecimal(monthlyGoal);
  if (isZero(goal)) {
    return null;
  }
  return percentFromRatio(parseDecimal(currentMonthRevenue), goal);
}
