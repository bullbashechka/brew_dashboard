import { describe, expect, it } from "bun:test";
import {
  calculateComparisonPercent,
  calculateCurrentUnitMargin,
  calculateFinancialMetrics,
  calculateGoalCompletion,
  classifyMenuProducts,
  computeAlerts,
  createSeededRandom,
  getStockStatus,
  generatorDateKey,
  resolvePeriodWindow,
  stableSeed,
  summarizeStock,
} from "../../src/domain/index.ts";

describe("fixed-point financial rules", () => {
  it("calculates completed-order metrics from historical snapshots", () => {
    const result = calculateFinancialMetrics([
      {
        status: "completed",
        items: [
          { quantity: "1.500", unitPriceAtSale: "10.00", unitCostAtSale: "4.00" },
          { quantity: "2.000", unitPriceAtSale: "3.25", unitCostAtSale: "1.25" },
        ],
      },
      {
        status: "cancelled",
        items: [{ quantity: "99.000", unitPriceAtSale: "100.00", unitCostAtSale: "1.00" }],
      },
    ]);

    expect(result).toEqual({
      revenue: "21.50",
      cogs: "8.50",
      grossProfit: "13.00",
      grossMargin: "60.47",
      orders: 1,
      averageCheck: "21.50",
    });
  });

  it("rounds decimal money without binary floating-point artifacts and returns N/A for zero divisions", () => {
    const result = calculateFinancialMetrics([
      {
        status: "completed",
        items: [{ quantity: "1.000", unitPriceAtSale: "1.005", unitCostAtSale: "0.005" }],
      },
    ]);
    expect(result.revenue).toBe("1.01");
    expect(result.cogs).toBe("0.01");
    expect(calculateFinancialMetrics([]).averageCheck).toBeNull();
    expect(calculateFinancialMetrics([]).grossMargin).toBeNull();
    expect(calculateComparisonPercent("10.00", "0.00")).toBeNull();
    expect(calculateComparisonPercent("120.00", "100.00")).toBe("20.00");
    expect(calculateCurrentUnitMargin("0.00", "0.00")).toBeNull();
    expect(calculateCurrentUnitMargin("10.00", "4.00")).toBe("60.00");
    expect(calculateGoalCompletion("50.00", "200.00")).toBe("25.00");
    expect(calculateGoalCompletion("50.00", "0.00")).toBeNull();
  });
});

describe("timezone-aware period windows", () => {
  it("compares Today with yesterday up to the same local time", () => {
    const window = resolvePeriodWindow(
      new Date("2026-08-23T10:15:30.000Z"),
      "Asia/Almaty",
      "today",
    );
    expect(window.start.toISOString()).toBe("2026-08-22T19:00:00.000Z");
    expect(window.comparisonStart.toISOString()).toBe("2026-08-21T19:00:00.000Z");
    expect(window.comparisonEnd.toISOString()).toBe("2026-08-22T10:15:30.000Z");
  });

  it("preserves local wall-clock boundaries across DST and clamps month ends", () => {
    const week = resolvePeriodWindow(
      new Date("2024-03-11T16:00:00.000Z"),
      "America/New_York",
      "7d",
    );
    expect(week.start.toISOString()).toBe("2024-03-04T17:00:00.000Z");
    expect(week.comparisonStart.toISOString()).toBe("2024-02-26T17:00:00.000Z");

    const sixMonths = resolvePeriodWindow(
      new Date("2024-08-31T16:00:00.000Z"),
      "America/New_York",
      "6m",
    );
    expect(sixMonths.start.toISOString()).toBe("2024-02-29T17:00:00.000Z");
  });

  it("groups UTC timestamps by local date and deterministic generator date", () => {
    const date = new Date("2026-08-22T19:30:00.000Z");
    expect(generatorDateKey(date, "Asia/Almaty")).toBe("2026-08-23");
  });
});

describe("stock statuses and computed alerts", () => {
  it("uses the exact threshold inequalities", () => {
    expect(getStockStatus("10.000", "5.000")).toBe("in_stock");
    expect(getStockStatus("5.000", "5.000")).toBe("low_stock");
    expect(getStockStatus("0.000", "5.000")).toBe("out_of_stock");
    expect(() => getStockStatus("-1.000", "5.000")).toThrow();
    expect(
      summarizeStock([
        { onHand: "10.000", minThreshold: "5.000" },
        { onHand: "5.000", minThreshold: "5.000" },
        { onHand: "0.000", minThreshold: "5.000" },
      ]),
    ).toEqual({ inStock: 1, lowStock: 1, outOfStock: 1 });
  });

  it("creates stock alerts and a 20 percent sales-drop alert, but not noise or zero baselines", () => {
    const alerts = computeAlerts(
      [
        {
          inventoryItemId: "item-1",
          locationId: "loc-1",
          locationName: "Central",
          productName: "Milk",
          onHand: "2.000",
          minThreshold: "2.000",
        },
        {
          inventoryItemId: "item-2",
          locationId: "loc-1",
          locationName: "Central",
          productName: "Beans",
          onHand: "0.000",
          minThreshold: "2.000",
        },
        {
          inventoryItemId: "item-3",
          locationId: "loc-1",
          locationName: "Central",
          productName: "Cups",
          onHand: "3.000",
          minThreshold: "2.000",
        },
      ],
      [
        {
          locationId: "loc-1",
          locationName: "Central",
          currentRevenue: "80.00",
          previousRevenue: "100.00",
        },
        {
          locationId: "loc-2",
          locationName: "Airport",
          currentRevenue: "80.01",
          previousRevenue: "100.00",
        },
        {
          locationId: "loc-3",
          locationName: "Mall",
          currentRevenue: "0.00",
          previousRevenue: "0.00",
        },
      ],
    );
    expect(alerts.map(({ type }) => type)).toEqual(["LOW_STOCK", "OUT_OF_STOCK", "SALES_DROP"]);
    expect(alerts[2]?.threshold).toBe("-20.00");
  });
});

describe("menu engineering and deterministic generator helpers", () => {
  it("classifies all four groups relative to active-product medians and treats ties as high", () => {
    const result = classifyMenuProducts([
      {
        productId: "star",
        active: true,
        unitsSold: "10.000",
        currentPrice: "12.00",
        currentUnitCost: "2.00",
      },
      {
        productId: "workhorse",
        active: true,
        unitsSold: "10.000",
        currentPrice: "5.00",
        currentUnitCost: "4.00",
      },
      {
        productId: "puzzle",
        active: true,
        unitsSold: "1.000",
        currentPrice: "12.00",
        currentUnitCost: "2.00",
      },
      {
        productId: "dog",
        active: true,
        unitsSold: "1.000",
        currentPrice: "5.00",
        currentUnitCost: "4.00",
      },
      {
        productId: "inactive",
        active: false,
        unitsSold: "100.000",
        currentPrice: "100.00",
        currentUnitCost: "1.00",
      },
    ]);
    expect(result.medians).toEqual({ unitsSold: "5.500", unitContribution: "5.50" });
    expect(result.products.map(({ group }) => group)).toEqual([
      "stars",
      "workhorses",
      "puzzles",
      "dogs",
    ]);
    expect(result.products.map(({ recommendation }) => recommendation)).toEqual([
      "protect_and_promote",
      "improve_margin",
      "promote_and_test",
      "review_or_remove",
    ]);
  });

  it("keeps generator output stable for the same version, network and date", () => {
    const first = createSeededRandom(stableSeed("v1", "network-1", "2026-08-23"));
    const second = createSeededRandom(stableSeed("v1", "network-1", "2026-08-23"));
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
    expect(stableSeed("v1", "network-1", "2026-08-23")).not.toBe(
      stableSeed("v2", "network-1", "2026-08-23"),
    );
  });
});
