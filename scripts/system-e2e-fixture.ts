/**
 * Non-production credentials used only by the isolated Stage 12 system E2E.
 * The runner creates these accounts inside a disposable local database and
 * deletes them before it exits.
 */
export const SYSTEM_E2E_FIXTURES = {
  desktop: {
    primary: { login: "stage12-system-desktop-a", password: "Stage12-System-A1" },
    secondary: { login: "stage12-system-desktop-b", password: "Stage12-System-B1" },
    performance: { login: "stage12-system-desktop-p", password: "Stage12-System-P1" },
  },
  mobile: {
    primary: { login: "stage12-system-mobile-a", password: "Stage12-System-A2" },
    secondary: { login: "stage12-system-mobile-b", password: "Stage12-System-B2" },
    performance: { login: "stage12-system-mobile-p", password: "Stage12-System-P2" },
  },
} as const;

/**
 * Deliberately distinctive values submitted by the system journey. They are
 * not secrets; they are sentinels which must never appear in persisted logs
 * or telemetry payloads.
 */
export const SYSTEM_E2E_CANARIES = {
  networkName: "stage12-network-form-canary",
  ownerName: "stage12-owner-form-canary",
  locationName: "stage12-location-form-canary",
  feedbackComment: "stage12-feedback-comment-canary",
  desiredFeatures: "stage12-feedback-features-canary",
} as const;
