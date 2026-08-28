import { expect, test } from "bun:test";

import { assertSystemE2eLogFilesSafe, assertSystemE2eLogSafety } from "./system-e2e-log-safety.ts";

test("system E2E log safety rejects form canaries and secret-bearing fields", () => {
  expect(() =>
    assertSystemE2eLogSafety('{ event: "http_request_completed.v1", status: 200 }', [
      { category: "form canary", value: "stage12-form-canary" },
    ]),
  ).not.toThrow();
  const secret = "stage12-form-canary";
  expect(() =>
    assertSystemE2eLogSafety(secret, [{ category: "form canary", value: secret }]),
  ).toThrow("form canary (1)");
  expect(() =>
    assertSystemE2eLogSafety(secret, [{ category: "form canary", value: secret }]),
  ).not.toThrow(secret);
  expect(() => assertSystemE2eLogSafety('{ cookie: "opaque" }', [])).toThrow("unsafe log key");
  expect(() => assertSystemE2eLogSafety('{ route: "/api/v1/feedback" }', [])).not.toThrow();
  expect(() =>
    assertSystemE2eLogSafety("Stage12-System-P1", [
      { category: "fixture credential", value: "Stage12-System-P1" },
    ]),
  ).toThrow("fixture credential (1)");
});

test("system E2E log safety deletes raw captures after success and failure", async () => {
  const safeFile = Bun.file(`.scratch/system-e2e-safe-${crypto.randomUUID()}.log`);
  const unsafeFile = Bun.file(`.scratch/system-e2e-unsafe-${crypto.randomUUID()}.log`);
  await Bun.write(safeFile, '{ route: "/api/v1/feedback" }');
  await Bun.write(unsafeFile, "stage12-form-canary");
  try {
    await assertSystemE2eLogFilesSafe([safeFile], []);
    expect(await safeFile.exists()).toBe(false);
    await expect(
      assertSystemE2eLogFilesSafe(
        [unsafeFile],
        [{ category: "form canary", value: "stage12-form-canary" }],
      ),
    ).rejects.toThrow("form canary (1)");
    expect(await unsafeFile.exists()).toBe(false);
  } finally {
    await safeFile.delete().catch(() => undefined);
    await unsafeFile.delete().catch(() => undefined);
  }
});
