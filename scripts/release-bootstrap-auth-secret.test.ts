import { describe, expect, test } from "bun:test";

import { assertAuthSecretAbsent, parseSecretList } from "./release-bootstrap-auth-secret.mjs";
import { createReleaseChildEnvironment } from "./child-environment.mjs";

describe("authentication secret bootstrap", () => {
  test("parses only Wrangler secret names", () => {
    expect(parseSecretList('[{"name":"ONE","type":"secret_text"}]')).toEqual(["ONE"]);
    expect(() => parseSecretList("{}")).toThrow("malformed secret list");
    expect(() => parseSecretList('[{"type":"secret_text"}]')).toThrow(
      "malformed secret list entry",
    );
  });

  test("refuses to overwrite the Better Auth encryption key", () => {
    expect(() => assertAuthSecretAbsent(["OTHER_SECRET"])).not.toThrow();
    expect(() => assertAuthSecretAbsent(["BETTER_AUTH_SECRET"])).toThrow(
      "never rotates or overwrites",
    );
  });

  test("does not inherit unrelated provider or database secrets", () => {
    const environment = createReleaseChildEnvironment({
      PATH: "/usr/bin",
      CLOUDFLARE_API_TOKEN: "explicit-wrangler-token",
      UNKNOWN_TOKEN: "unknown-secret",
      DATABASE_URL: "postgresql://secret",
    });
    expect(environment).toEqual({
      PATH: "/usr/bin",
      CLOUDFLARE_API_TOKEN: "explicit-wrangler-token",
    });
  });
});
