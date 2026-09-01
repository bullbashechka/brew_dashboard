import {
  mfaSetupRequestSchema,
  mfaSetupResponseSchema,
  mfaVerifyRequestSchema,
  sessionResponseSchema,
} from "@brew-dashboard/contracts";

import { requestApi } from "./client";

export const startMfaSetup = (password: string) =>
  requestApi({
    path: "/api/v1/auth/mfa/setup",
    method: "POST",
    body: mfaSetupRequestSchema.parse({ password }),
    schema: mfaSetupResponseSchema,
  });

export const verifyMfa = (method: "totp" | "backup", code: string) =>
  requestApi({
    path: "/api/v1/auth/mfa/verify",
    method: "POST",
    body: mfaVerifyRequestSchema.parse({ method, code }),
    schema: sessionResponseSchema,
    unauthorized: "ignore",
  });
