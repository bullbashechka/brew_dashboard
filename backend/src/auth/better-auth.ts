import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { username } from "better-auth/plugins";

import type { DatabaseExecutor } from "../db/client.ts";
import {
  authAccounts,
  authRateLimits,
  authSessions,
  authUsers,
  authVerifications,
} from "../db/schema.ts";
import { isSupportedLogin, normalizeLogin } from "./login.ts";

export const AUTH_BASE_PATH = "/api/v1/internal-auth";
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
export const SESSION_COOKIE_NAME = "__Secure-brew_dashboard.session_token";

const authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  rateLimit: authRateLimits,
};

export type BetterAuthEnvironment = {
  secret: string;
  baseUrl: string;
};

export const createBetterAuth = (db: DatabaseExecutor, environment: BetterAuthEnvironment) =>
  betterAuth({
    appName: "Brew Dashboard",
    baseURL: environment.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: environment.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 10,
      max: 100,
      customRules: {
        "/sign-in/username": { window: 900, max: 20 },
        "/get-session": false,
      },
    },
    advanced: {
      cookiePrefix: "brew_dashboard",
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        secure: true,
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 64,
        usernameNormalization: normalizeLogin,
        usernameValidator: isSupportedLogin,
        validationOrder: { username: "post-normalization" },
        immutableUsername: true,
      }),
    ],
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
      "/reset-password",
      "/change-password",
      "/change-email",
      "/send-verification-email",
      "/verify-email",
      "/delete-user",
      "/update-user",
      "/is-username-available",
      "/list-sessions",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
    ],
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
