import { describe, expect, test } from "bun:test";

import { isMfaSetupState, profileFromAuthState } from "@/api/session";
import { destinationFor } from "@/router";

describe("minimal pre-MFA frontend state", () => {
  test("keeps setup state distinct from a tenant profile", () => {
    const state = { mfaSetupRequired: true } as const;
    expect(isMfaSetupState(state)).toBe(true);
    expect(profileFromAuthState(state)).toBeNull();
    expect(destinationFor(state)).toEqual({ to: "/mfa/setup" });
  });

  test("sends an unauthenticated state to login", () => {
    expect(isMfaSetupState(null)).toBe(false);
    expect(destinationFor(null)).toEqual({ to: "/login" });
  });
});
