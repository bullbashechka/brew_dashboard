import { describe, expect, it } from "bun:test";

import { generateTotp } from "../../e2e/totp";

describe("production TOTP helper", () => {
  it("matches RFC 6238 SHA-1 vectors", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const vectors = [
      [59, "287082"],
      [1_111_111_109, "081804"],
      [1_111_111_111, "050471"],
      [1_234_567_890, "005924"],
      [2_000_000_000, "279037"],
      [20_000_000_000, "353130"],
    ] as const;
    for (const [timestamp, expected] of vectors) {
      expect(generateTotp(secret, timestamp * 1_000)).toBe(expected);
    }
  });

  it("rejects malformed setup secrets", () => {
    expect(() => generateTotp("not-a-totp-secret!", 0)).toThrow(
      "MFA setup returned an invalid TOTP secret",
    );
  });
});
