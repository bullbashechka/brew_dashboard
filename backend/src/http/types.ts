import type { Profile } from "@brew-dashboard/contracts";

import type { RequestTransaction } from "../db/client.ts";

export type WorkerBindings = {
  ASSETS?: Fetcher;
  HYPERDRIVE: Hyperdrive;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
};

export type AuthenticatedRequest = {
  authUserId: string;
  networkId: string;
  profile: Profile;
  sessionId: string;
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
};

export type AppEnvironment = {
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
};
