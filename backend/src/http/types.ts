import type { Profile } from "@brew-dashboard/contracts";

import type { RequestTransaction } from "../db/client.ts";

export type WorkerBindings = {
  ASSETS?: Fetcher;
  HYPERDRIVE?: Hyperdrive;
  /** Transitional fallback; production uses the two named Hyperdrive bindings. */
  AUTH_HYPERDRIVE?: Hyperdrive;
  APP_HYPERDRIVE?: Hyperdrive;
  RATE_LIMIT_ACTOR?: DurableObjectNamespace;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  MFA_REQUIRED?: string;
  /** A=legacy-compatible rollout, B=split bindings, C=legacy role revoked. */
  RUNTIME_ROLE_SPLIT_STAGE?: string;
  LOG_PSEUDONYM_SECRET?: string;
  /** Injected only by the isolated local system-E2E Worker. */
  SYSTEM_E2E?: string;
  SYSTEM_E2E_AUTH_SECRET?: string;
  SYSTEM_E2E_AUTH_URL?: string;
};

export type AuthenticatedRequest = {
  authUserId: string;
  networkId: string;
  profile: Profile;
};

export type WorkerVariables = {
  requestId: string;
  requestStartedAt: number;
  requestErrorLogged?: boolean;
  database: RequestTransaction;
  auth: AuthenticatedRequest;
  safeAccount?: {
    userId: string;
    networkId: string;
  };
  /** Set after Better Auth resolves the user; used to keep MFA enrollment one-way. */
  mfaEnrolled?: boolean;
  /** Minimal identity for mandatory MFA enrollment; never contains tenant or profile data. */
  preMfaAuth?: {
    authUserId: string;
  };
};

export type AppEnvironment = {
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
};
