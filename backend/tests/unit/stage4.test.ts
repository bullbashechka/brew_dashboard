import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  DEMO_GENERATOR_VERSION,
  DemoGeneratorVerificationError,
  generateDemoData,
  verifyDemoData,
  type DemoGeneratorInput,
} from "../../src/domain/demo-generator.ts";
import { hashOperationPayload } from "../../src/domain/idempotency.ts";
import { localDateTimeToUtc } from "../../src/domain/periods.ts";
import worker from "../../src/index.ts";

const networkId = "11111111-1111-4111-8111-111111111111";

// Deterministic fixture generation is CPU-heavy under parallel Bun workers.
setDefaultTimeout(60_000);

const inputFor = (
  count: number,
  overrides: Partial<DemoGeneratorInput> = {},
): DemoGeneratorInput => ({
  version: DEMO_GENERATOR_VERSION,
  networkId,
  localDate: "2026-08-25",
  timeZone: "Asia/Almaty",
  anchor: new Date("2026-08-25T12:00:00.000Z"),
  locations: Array.from({ length: count }, (_, index) => ({
    id: `0000000${index + 2}-0000-4000-8000-00000000000${index + 2}`,
    name: `Location ${index + 1}`,
    sortOrder: index,
  })),
  ...overrides,
});

describe("Stage 4 deterministic demo generator", () => {
  it("returns a byte-equivalent canonical dataset for the same anchor and points", async () => {
    const first = await generateDemoData(inputFor(3));
    const second = await generateDemoData(inputFor(3));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.counts.locations).toBe(3);
    expect(first.counts.categories).toBe(3);
    expect(first.counts.products).toBe(12);
    expect(first.counts.orders).toBeLessThanOrEqual(3_000);
    expect(first.counts.inventoryBalances).toBe(36);
    expect(first.orders.some((order) => order.status === "cancelled")).toBe(true);
    expect(first.orderItems.every((item) => /^\d+\.\d{2}$/.test(item.unitPriceAtSale))).toBe(true);
    expect(first.orderItems.every((item) => /^\d+\.\d{2}$/.test(item.unitCostAtSale))).toBe(true);
    expect(first.orderItems.every((item) => /^\d+\.\d{3}$/.test(item.quantity))).toBe(true);
  }, 60_000);

  it("covers one, two and five locations without future events", async () => {
    for (const count of [1, 2, 5]) {
      const data = await generateDemoData(inputFor(count));
      expect(data.counts.inventoryBalances).toBe(count * 12);
      expect(data.counts.inventoryMovements).toBe(count * 12);
      expect(data.orders.every((order) => order.orderedAt <= data.anchor)).toBe(true);
      expect(data.inventoryMovements.every((movement) => movement.occurredAt <= data.anchor)).toBe(
        true,
      );
      expect(() => verifyDemoData(data)).not.toThrow();
    }
  }, 60_000);

  it("keeps all menu groups on today despite extra generated sales", async () => {
    const anchor = new Date("2026-08-25T04:30:00.000Z");
    for (const suffix of ["000000000012", "000000000015"]) {
      const data = await generateDemoData(
        inputFor(2, {
          networkId: `00000000-0000-4000-8000-${suffix}`,
          anchor,
        }),
      );
      expect(() => verifyDemoData(data)).not.toThrow();
    }
  }, 60_000);

  it("handles DST gap/fold, leap day and month-end anchors", async () => {
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0, millisecond: 0 },
        "America/New_York",
      ),
    ).toBeNull();
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0, millisecond: 0 },
        "America/New_York",
      )?.toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");

    const cases = [
      {
        localDate: "2026-03-08",
        timeZone: "America/New_York",
        anchor: new Date("2026-03-08T12:00:00.000Z"),
      },
      {
        localDate: "2026-11-01",
        timeZone: "America/New_York",
        anchor: new Date("2026-11-01T12:00:00.000Z"),
      },
      {
        localDate: "2024-02-29",
        timeZone: "Asia/Almaty",
        anchor: new Date("2024-02-29T12:00:00.000Z"),
      },
      {
        localDate: "2026-01-31",
        timeZone: "Asia/Almaty",
        anchor: new Date("2026-01-31T12:00:00.000Z"),
      },
    ];

    for (const value of cases) {
      const data = await generateDemoData(inputFor(1, value));
      expect(data.orders.length).toBeGreaterThan(0);
      expect(() => verifyDemoData(data)).not.toThrow();
    }
  }, 60_000);

  it("rejects an unknown pinned version before producing data", async () => {
    await expect(generateDemoData(inputFor(1, { version: "v999" }))).rejects.toThrow(
      "Unsupported demo generator version",
    );
    expect(DemoGeneratorVerificationError).toBeDefined();
  });

  it("keeps idempotency hashes operation-aware and stable across object key order", async () => {
    const first = await hashOperationPayload("demo.reset", { options: { b: 2, a: 1 } });
    const samePayload = await hashOperationPayload("demo.reset", { options: { a: 1, b: 2 } });
    const otherOperation = await hashOperationPayload("onboarding.complete", {
      options: { a: 1, b: 2 },
    });
    const reorderedArray = await hashOperationPayload("demo.reset", { options: [2, 1] });

    expect(first).toBe(samePayload);
    expect(first).not.toBe(otherOperation);
    expect(first).not.toBe(reorderedArray);
  });

  it("exposes no scheduled or queue handler and configures no background trigger", async () => {
    expect(Object.keys(worker).sort()).toEqual(["fetch"]);

    const wranglerConfig = await Bun.file(
      new URL("../../../wrangler.jsonc", import.meta.url),
    ).text();
    expect(wranglerConfig).not.toContain('"scheduled"');
    expect(wranglerConfig).not.toContain('"queue"');
    expect(wranglerConfig).not.toContain('"queues"');
    expect(wranglerConfig).not.toContain('"crons"');
    expect(wranglerConfig).not.toContain('"triggers"');
  });
});
