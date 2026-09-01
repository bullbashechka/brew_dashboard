import {
  loginRequestSchema,
  mfaSetupRequestSchema,
  mfaVerifyRequestSchema,
  profileSchema,
  type LoginRequest,
  type Profile,
} from "@brew-dashboard/contracts";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import type { ZodType } from "zod";

import {
  lockAuthUser,
  lockLogin,
  setAuthUserContext,
  setTenantContext,
  withRequestDatabase,
  type RequestTransaction,
} from "../db/client.ts";
import { appUsers, authSessions, authUsers, authVerifications, networks } from "../db/schema.ts";
import { recordServerProductEvent } from "../events/service.ts";
import { errorResponse, unauthenticatedResponse } from "../http/errors.ts";
import { observableRoute } from "../http/middleware.ts";
import type { AppEnvironment, WorkerBindings } from "../http/types.ts";
import { authSecretFor, authUrlFor } from "./environment.ts";
import {
  AUTH_BASE_PATH,
  SESSION_COOKIE_NAME,
  TWO_FACTOR_COOKIE_NAME,
  createBetterAuth,
  type BetterAuthEnvironment,
} from "./better-auth.ts";
import {
  checkLoginAccountRateLimit,
  clearLoginFailures,
  consumeLoginIpRateLimitDistributed,
  consumeAuthenticatedRequestRateLimit,
  consumeAuthenticatedRequestRateLimitDistributed,
  loginAccountRateLimitKey,
  recordLoginFailure,
} from "./rate-limit.ts";
import { resolveMfaPolicy } from "./mfa-policy.ts";
import { normalizeLogin } from "./login.ts";
import { localDateKey } from "../domain/periods.ts";
import { isLoopbackHostname } from "../security/hosts.ts";

type SessionPayload = {
  session: {
    id: string;
    token: string;
    userId: string;
  };
  user: {
    id: string;
    twoFactorEnabled?: boolean;
  };
};

type LoginPayload = {
  token: string;
  user: {
    id: string;
    twoFactorEnabled?: boolean;
  };
};

type MfaChallengePayload = {
  twoFactorRedirect: true;
  twoFactorMethods: string[];
};

type LoadedProfile = {
  profile: Profile;
  networkId: string;
};

const getAuthEnvironment = (context: Context<AppEnvironment>): BetterAuthEnvironment => {
  const secret = authSecretFor(context.env);
  const baseUrl = authUrlFor(context.env);
  if (!secret || secret.length < 32 || !baseUrl) {
    throw new Error("Better Auth server configuration is unavailable");
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("Better Auth URL must use HTTPS outside local development");
  }
  return { secret, baseUrl: parsed.origin };
};

const mfaRequiredFor = (contextOrEnvironment: Context<AppEnvironment> | WorkerBindings) => {
  const environment =
    "env" in contextOrEnvironment ? contextOrEnvironment.env : contextOrEnvironment;
  return resolveMfaPolicy(environment);
};

const getConnectionString = (context: Context<AppEnvironment>, purpose: "auth" | "app" = "app") => {
  const namedBinding =
    purpose === "auth" ? context.env.AUTH_HYPERDRIVE : context.env.APP_HYPERDRIVE;
  const connectionString = namedBinding?.connectionString;
  const runtimeRoleStage = context.env.RUNTIME_ROLE_SPLIT_STAGE;
  const legacyCompatibleRollout = runtimeRoleStage === "A";
  const splitRuntimeRollout = runtimeRoleStage === "B" || runtimeRoleStage === "C";
  if (
    !connectionString &&
    (splitRuntimeRollout || (context.env.MFA_REQUIRED === "1" && !legacyCompatibleRollout))
  ) {
    throw new Error(`${purpose.toUpperCase()}_HYPERDRIVE binding is unavailable`);
  }
  const legacyConnectionString = context.env.HYPERDRIVE?.connectionString;
  if (!connectionString && !legacyConnectionString) {
    throw new Error("Hyperdrive binding is unavailable");
  }
  return connectionString ?? legacyConnectionString!;
};

const copyRequestHeaders = (context: Context<AppEnvironment>) => {
  const headers = new Headers();
  for (const name of ["cf-connecting-ip", "cookie", "origin", "user-agent"]) {
    const value = context.req.header(name);
    if (value) headers.set(name, value);
  }
  return headers;
};

const internalRequest = (
  context: Context<AppEnvironment>,
  environment: BetterAuthEnvironment,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
) => {
  const headers = copyRequestHeaders(context);
  const init: RequestInit = { headers, method };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(new URL(`${AUTH_BASE_PATH}${path}`, environment.baseUrl), init);
};

const getSetCookieValues = (headers: Headers): string[] => {
  const enhancedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const values = enhancedHeaders.getSetCookie?.();
  const combined = values?.length
    ? values
    : ([headers.get("set-cookie")].filter(Boolean) as string[]);
  return combined
    .flatMap((value) => value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/u))
    .map((value) => value.trim());
};

const appendSetCookies = (context: Context<AppEnvironment>, headers: Headers) => {
  for (const cookie of getSetCookieValues(headers)) {
    context.header("set-cookie", cookie, { append: true });
  }
};

const clearSessionCookie = (context: Context<AppEnvironment>) => {
  context.header(
    "set-cookie",
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
    { append: true },
  );
};

const cookieValue = (header: string | undefined, name: string) => {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [candidateName, ...rest] = part.trim().split("=");
    if (candidateName !== name || rest.length === 0) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null;
    }
  }
  return null;
};

const base64Bytes = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

/** Resolve a signed Better Auth 2FA challenge to its owner before consuming it. */
const authUserIdFromTwoFactorChallenge = async (
  transaction: RequestTransaction,
  context: Context<AppEnvironment>,
  secret: string,
) => {
  const signed = cookieValue(context.req.header("cookie"), TWO_FACTOR_COOKIE_NAME);
  if (!signed) return null;
  const separator = signed.lastIndexOf(".");
  if (separator <= 0) return null;
  const identifier = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  if (!/^2fa-[A-Za-z0-9_-]{20}$/u.test(identifier)) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        base64Bytes(signature),
        new TextEncoder().encode(identifier),
      ))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const challenge = await transaction
    .select({ userId: authVerifications.value })
    .from(authVerifications)
    .where(
      and(
        eq(authVerifications.identifier, identifier),
        gt(authVerifications.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return challenge[0]?.userId ?? null;
};

const readJson = async (
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false }> => {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
};

const unexpectedAuthResponse = (operation: string, response: Response): never => {
  throw new Error(`Better Auth ${operation} returned unexpected HTTP ${response.status}`);
};

const retryAfterFromAuthResponse = (response: Response) => {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 900;
};

const classifyAuthResponse = (operation: "login" | "get-session", response: Response) => {
  if (operation === "login" && response.status === 429) {
    return { kind: "rate-limited" as const, retryAfter: retryAfterFromAuthResponse(response) };
  }
  if (response.status === 401) return { kind: "unauthenticated" as const };
  if (!response.ok) unexpectedAuthResponse(operation, response);
  return { kind: "success" as const };
};

const isSessionPayload = (value: unknown): value is SessionPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionPayload>;
  return Boolean(
    candidate.session &&
    typeof candidate.session.id === "string" &&
    typeof candidate.session.token === "string" &&
    typeof candidate.session.userId === "string" &&
    candidate.user &&
    typeof candidate.user.id === "string" &&
    candidate.session.userId === candidate.user.id,
  );
};

const isLoginPayload = (value: unknown): value is LoginPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LoginPayload>;
  return Boolean(
    typeof candidate.token === "string" && candidate.user && typeof candidate.user.id === "string",
  );
};

const isMfaChallengePayload = (value: unknown): value is MfaChallengePayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MfaChallengePayload>;
  return (
    candidate.twoFactorRedirect === true &&
    Array.isArray(candidate.twoFactorMethods) &&
    candidate.twoFactorMethods.every((method) => typeof method === "string")
  );
};

const mfaMethodsFor = (methods: string[]) => {
  const normalized = methods
    .map((method) => (method === "totp" ? "totp" : method === "backup_code" ? "backup" : null))
    .filter((method): method is "totp" | "backup" => method !== null);
  return [...new Set(normalized)];
};

export const loadActiveProfile = async (
  transaction: RequestTransaction,
  authUserId: string,
  now = new Date(),
  options: { lock?: boolean } = {},
): Promise<LoadedProfile | null> => {
  const accountFilter = and(
    eq(appUsers.authUserId, authUserId),
    eq(appUsers.status, "active"),
    or(isNull(appUsers.expiresAt), gt(appUsers.expiresAt, now)),
  );
  await setAuthUserContext(transaction, authUserId);
  let appUser: typeof appUsers.$inferSelect | undefined;
  if (options.lock === false) {
    const account = (
      await transaction.select({ appUser: appUsers }).from(appUsers).where(accountFilter)
    )[0];
    appUser = account?.appUser;
  } else {
    appUser = (await transaction.select().from(appUsers).where(accountFilter).for("update"))[0];
  }
  if (!appUser) return null;

  await setTenantContext(transaction, appUser.networkId);
  const network = await transaction
    .select()
    .from(networks)
    .where(eq(networks.id, appUser.networkId))
    .limit(1);
  const currentNetwork = network[0];
  if (!currentNetwork) return null;

  const profile = profileSchema.parse({
    userId: appUser.authUserId,
    login: appUser.loginNormalized,
    networkId: appUser.networkId,
    networkName: currentNetwork.name,
    ownerName: currentNetwork.ownerName,
    country: currentNetwork.countryCode,
    currency: currentNetwork.currencyCode,
    timeZone: currentNetwork.timezone,
    language: currentNetwork.language,
    effectiveLanguage: currentNetwork.language ?? "en",
    onboardingCompletedAt: currentNetwork.onboardingCompletedAt?.toISOString() ?? null,
    demoGeneratorVersion: currentNetwork.demoGeneratorVersion,
    demoGeneratedForDate: currentNetwork.demoGeneratedForDate,
    demoDataRevision: currentNetwork.demoDataRevision,
    demoDataStale:
      Boolean(currentNetwork.demoGeneratedForDate && currentNetwork.timezone) &&
      currentNetwork.demoGeneratedForDate !== localDateKey(now, currentNetwork.timezone!),
    tourState: appUser.tourCompletedAt
      ? "completed"
      : appUser.tourSkippedAt
        ? "skipped"
        : "pending",
    expiresAt: appUser.expiresAt?.toISOString() ?? null,
  });

  return { networkId: appUser.networkId, profile };
};

const revokeUserSessions = async (transaction: RequestTransaction, authUserId: string) => {
  await transaction.delete(authSessions).where(eq(authSessions.userId, authUserId));
};

const parseLoginRequest = async (
  context: Context<AppEnvironment>,
): Promise<LoginRequest | null> => {
  try {
    const body = await context.req.json<unknown>();
    if (!body || typeof body !== "object") return null;
    const candidate = body as Record<string, unknown>;
    if (typeof candidate.login !== "string") return null;
    const parsed = loginRequestSchema.safeParse({
      ...candidate,
      login: normalizeLogin(candidate.login),
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const rateLimitedResponse = (context: Context<AppEnvironment>, retryAfter: number) => {
  context.header("retry-after", String(retryAfter));
  return errorResponse(context, "RATE_LIMITED", 429, "Too many login attempts");
};

export const loginHandler = async (context: Context<AppEnvironment>) => {
  const environment = getAuthEnvironment(context);
  const ipRateLimit = await consumeLoginIpRateLimitDistributed(
    context.env,
    environment.secret,
    context.req.header("cf-connecting-ip"),
  );
  if (ipRateLimit.status === "unavailable") {
    console.error({ event: "rate_limit_unavailable.v1", scope: "login-ip" });
    return errorResponse(context, "INTERNAL_ERROR", 503, "Request protection is unavailable");
  }
  if (!ipRateLimit.result.allowed) {
    return rateLimitedResponse(context, ipRateLimit.result.retryAfter ?? 1);
  }

  const credentials = await parseLoginRequest(context);
  if (!credentials) return unauthenticatedResponse(context);

  const accountKey = loginAccountRateLimitKey(environment.secret, credentials.login);
  const result:
    | { kind: "success"; payload: LoginPayload; response: Response }
    | { kind: "mfa-challenge"; response: Response; methods: ("totp" | "backup")[] }
    | { kind: "invalid"; clearCookie?: boolean }
    | { kind: "rate-limited"; retryAfter: number } = await withRequestDatabase(
    getConnectionString(context, "auth"),
    (db) =>
      db.transaction(async (transaction) => {
        await lockLogin(transaction, accountKey);
        const accountRateLimit = await checkLoginAccountRateLimit(transaction, accountKey);
        if (!accountRateLimit.allowed) {
          return { kind: "rate-limited" as const, retryAfter: accountRateLimit.retryAfter ?? 1 };
        }
        // Acquire the same per-user lock as enrollment, password reset and MFA reset before
        // Better Auth can issue a session. This closes the window in which a second password
        // login could be created while initial MFA enrollment is rotating/deleting sessions.
        const existingUser = await transaction
          .select({ id: authUsers.id })
          .from(authUsers)
          .where(eq(authUsers.username, credentials.login))
          .limit(1);
        if (existingUser[0]) await lockAuthUser(transaction, existingUser[0].id);
        const auth = createBetterAuth(transaction, environment);
        const response = await auth.handler(
          internalRequest(context, environment, "/sign-in/username", "POST", {
            username: credentials.login,
            password: credentials.password,
          }),
        );
        const responseKind = classifyAuthResponse("login", response);
        if (responseKind.kind === "rate-limited") return responseKind;
        if (responseKind.kind === "unauthenticated") {
          await recordLoginFailure(transaction, accountKey);
          return { kind: "invalid" as const };
        }
        const body = await readJson(response);
        if (!body.ok) throw unexpectedAuthResponse("login", response);
        if (isMfaChallengePayload(body.value)) {
          const methods = mfaMethodsFor(body.value.twoFactorMethods);
          if (!methods.length) throw new Error("Better Auth returned no usable MFA method");
          return { kind: "mfa-challenge" as const, response, methods };
        }
        if (!isLoginPayload(body.value)) throw unexpectedAuthResponse("login", response);
        const payload = body.value;
        await lockAuthUser(transaction, payload.user.id);
        const session = await transaction
          .select({ id: authSessions.id })
          .from(authSessions)
          .where(
            and(eq(authSessions.userId, payload.user.id), eq(authSessions.token, payload.token)),
          )
          .limit(1);
        if (!session[0]) {
          await revokeUserSessions(transaction, payload.user.id);
          await recordLoginFailure(transaction, accountKey);
          return { kind: "invalid" as const, clearCookie: true };
        }
        return { kind: "success" as const, payload, response };
      }),
  );

  if (result.kind === "rate-limited") return rateLimitedResponse(context, result.retryAfter);
  if (result.kind === "invalid") {
    if (result.clearCookie) clearSessionCookie(context);
    return unauthenticatedResponse(context);
  }

  if (result.kind === "mfa-challenge") {
    appendSetCookies(context, result.response.headers);
    return context.json({
      data: { mfaRequired: true as const, methods: result.methods },
      meta: {},
      requestId: context.get("requestId"),
    });
  }
  const requiresMfa = mfaRequiredFor(context);
  const profile = await withRequestDatabase(getConnectionString(context, "app"), (db) =>
    db.transaction(async (transaction) => {
      const loaded = await loadActiveProfile(transaction, result.payload.user.id);
      if (!loaded) return null;
      if (requiresMfa && result.payload.user.twoFactorEnabled !== true) return loaded;
      const now = new Date();
      await transaction
        .update(appUsers)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(appUsers.authUserId, result.payload.user.id));
      await recordServerProductEvent(transaction, {
        authUserId: result.payload.user.id,
        networkId: loaded.networkId,
        type: "login_succeeded",
        metadata: {},
        occurredAt: now,
      });
      return loaded;
    }),
  );
  if (!profile) {
    await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
      db.transaction(async (transaction) => {
        await revokeUserSessions(transaction, result.payload.user.id);
        await recordLoginFailure(transaction, accountKey);
      }),
    );
    clearSessionCookie(context);
    return unauthenticatedResponse(context);
  }
  await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
    db.transaction((transaction) => clearLoginFailures(transaction, accountKey)),
  );
  if (requiresMfa && result.payload.user.twoFactorEnabled !== true) {
    appendSetCookies(context, result.response.headers);
    return context.json({
      data: { mfaSetupRequired: true as const },
      meta: {},
      requestId: context.get("requestId"),
    });
  }

  context.set("safeAccount", {
    userId: profile.profile.userId,
    networkId: profile.networkId,
  });
  appendSetCookies(context, result.response.headers);
  return context.json({
    data: { authenticated: true as const, profile: profile.profile },
    meta: {},
    requestId: context.get("requestId"),
  });
};

const authenticateRequest = async (
  context: Context<AppEnvironment>,
  next: Next,
  allowUnenrolled = false,
): Promise<Response | void> => {
  const environment = getAuthEnvironment(context);
  const authResult = await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
    db.transaction(async (transaction) => {
      const auth = createBetterAuth(transaction, environment);
      const response = await auth.handler(
        internalRequest(context, environment, "/get-session", "GET"),
      );
      const responseKind = classifyAuthResponse("get-session", response);
      if (responseKind.kind === "unauthenticated") return { kind: "invalid" as const, response };
      const body = await readJson(response);
      if (!body.ok) throw unexpectedAuthResponse("get-session", response);
      if (body.value === null) return { kind: "invalid" as const, response };
      if (!isSessionPayload(body.value)) throw unexpectedAuthResponse("get-session", response);
      return { kind: "success" as const, payload: body.value, response };
    }),
  );
  if (authResult.kind === "invalid") {
    appendSetCookies(context, authResult.response.headers);
    clearSessionCookie(context);
    return unauthenticatedResponse(context);
  }

  const { payload, response } = authResult;
  const requiresMfa = mfaRequiredFor(context);
  const unenrolled = requiresMfa && payload.user.twoFactorEnabled !== true;
  if (unenrolled && !allowUnenrolled) {
    appendSetCookies(context, response.headers);
    return errorResponse(context, "MFA_REQUIRED", 403, "Multi-factor authentication is required");
  }

  const requestRateLimit = await consumeAuthenticatedRequestRateLimitDistributed(
    context.env,
    environment.secret,
    payload.user.id,
    context.req.method,
    context.req.path,
  );
  if (requestRateLimit?.status === "unavailable") {
    const isReadRequest = context.req.method === "GET" || context.req.method === "HEAD";
    if (!isReadRequest) {
      console.error({ event: "rate_limit_unavailable.v1", scope: "authenticated-mutation" });
      return errorResponse(context, "INTERNAL_ERROR", 503, "Request protection is unavailable");
    }
    console.error({ event: "rate_limit_fallback.v1", scope: "authenticated-read" });
    const fallback = consumeAuthenticatedRequestRateLimit(
      environment.secret,
      payload.user.id,
      context.req.method,
      context.req.path,
    );
    if (fallback && !fallback.allowed) {
      const retryAfter = fallback.retryAfter ?? 1;
      context.header("retry-after", String(retryAfter));
      return errorResponse(context, "RATE_LIMITED", 429, "Too many requests");
    }
  } else if (requestRateLimit && !requestRateLimit.result.allowed) {
    const retryAfter = requestRateLimit.result.retryAfter ?? 1;
    context.header("retry-after", String(retryAfter));
    console.warn({
      event: "rate_limit_rejected.v1",
      scope: requestRateLimit.result.scope,
      route: observableRoute(context),
      subjectHash: requestRateLimit.result.key.slice(-12),
      retryAfter,
    });
    return errorResponse(context, "RATE_LIMITED", 429, "Too many requests");
  }

  if (unenrolled) {
    context.set("preMfaAuth", { authUserId: payload.user.id });
    context.set("mfaEnrolled", false);
    appendSetCookies(context, response.headers);
    await next();
    return context.res;
  }

  const isReadRequest = context.req.method === "GET" || context.req.method === "HEAD";
  const result = await withRequestDatabase(getConnectionString(context, "app"), (db) =>
    db.transaction(async (transaction) => {
      const profile = await loadActiveProfile(transaction, payload.user.id, new Date(), {
        lock: !isReadRequest,
      });
      if (!profile) return null;
      context.set("database", transaction);
      context.set("auth", {
        authUserId: payload.user.id,
        networkId: profile.networkId,
        profile: profile.profile,
      });
      context.set("safeAccount", {
        userId: profile.profile.userId,
        networkId: profile.networkId,
      });
      context.set("mfaEnrolled", payload.user.twoFactorEnabled === true);
      appendSetCookies(context, response.headers);
      await next();
      return context.res;
    }),
  );
  if (result === null) {
    await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
      db.transaction((transaction) => revokeUserSessions(transaction, payload.user.id)),
    );
    clearSessionCookie(context);
    return unauthenticatedResponse(context);
  }
  return result;
};

export const requireAuthentication = (context: Context<AppEnvironment>, next: Next) =>
  authenticateRequest(context, next, false);

/** Only MFA enrollment and verification routes may use the pre-enrollment session. */
export const requireMfaSetupAuthentication = (context: Context<AppEnvironment>, next: Next) =>
  authenticateRequest(context, next, true);

export const requireCompletedOnboarding = async (
  context: Context<AppEnvironment>,
  next: Next,
): Promise<Response | void> => {
  if (!context.get("auth").profile.onboardingCompletedAt) {
    return errorResponse(context, "FORBIDDEN", 403, "Complete onboarding before using the app");
  }
  await next();
};

export const requireIncompleteOnboarding = async (
  context: Context<AppEnvironment>,
  next: Next,
): Promise<Response | void> => {
  if (context.get("auth").profile.onboardingCompletedAt) {
    return errorResponse(context, "CONFLICT", 409, "Onboarding has already been completed");
  }
  await next();
};

export const logoutHandler = async (context: Context<AppEnvironment>) => {
  const environment = getAuthEnvironment(context);
  const response = await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
    db.transaction(async (transaction) => {
      const auth = createBetterAuth(transaction, environment);
      const sessionResponse = await auth.handler(
        internalRequest(context, environment, "/get-session", "GET"),
      );
      const sessionBody = await readJson(sessionResponse);
      const payload = sessionBody.ok ? sessionBody.value : null;
      if (isSessionPayload(payload)) await lockAuthUser(transaction, payload.user.id);

      const signOutResponse = await auth.handler(
        internalRequest(context, environment, "/sign-out", "POST", {}),
      );
      if (!signOutResponse.ok) throw new Error("Better Auth sign-out failed");
      if (isSessionPayload(payload)) {
        await transaction.delete(authSessions).where(eq(authSessions.id, payload.session.id));
      }
      return signOutResponse;
    }),
  );

  appendSetCookies(context, response.headers);
  clearSessionCookie(context);
  return context.json(
    {
      data: { authenticated: false as const },
      meta: {},
      requestId: context.get("requestId"),
    },
    200,
  );
};

const parseMfaBody = async <T>(
  context: Context<AppEnvironment>,
  schema: ZodType<T>,
): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await context.req.json<unknown>());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const mfaErrorResponse = (context: Context<AppEnvironment>, status: 401 | 429 = 401) =>
  errorResponse(
    context,
    status === 429 ? "RATE_LIMITED" : "UNAUTHENTICATED",
    status,
    "MFA verification failed",
  );

const totpSecretFromUri = (value: string) => {
  try {
    const uri = new URL(value);
    const secret = uri.searchParams.get("secret");
    if (uri.protocol !== "otpauth:" || uri.hostname !== "totp" || !secret) return null;
    if (!/^[A-Z2-7]+$/u.test(secret)) return null;
    return secret;
  } catch {
    return null;
  }
};

export const mfaSetupHandler = async (context: Context<AppEnvironment>) => {
  if (context.get("mfaEnrolled")) {
    return errorResponse(context, "CONFLICT", 409, "MFA is already enabled");
  }
  const body = await parseMfaBody(context, mfaSetupRequestSchema);
  if (!body) return errorResponse(context, "VALIDATION_ERROR", 400, "Invalid MFA setup request");
  const environment = getAuthEnvironment(context);
  return withRequestDatabase(getConnectionString(context, "auth"), (db) =>
    db.transaction(async (transaction) => {
      const auth = createBetterAuth(transaction, environment);
      const response = await auth.handler(
        internalRequest(context, environment, "/two-factor/enable", "POST", {
          password: body.password,
          method: "totp",
          issuer: "Brew Dashboard",
        }),
      );
      if (!response.ok) return mfaErrorResponse(context, response.status === 429 ? 429 : 401);
      const parsed = await readJson(response);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
        throw new Error("Better Auth returned malformed MFA setup response");
      }
      const candidate = parsed.value as {
        method?: unknown;
        totpURI?: unknown;
        backupCodes?: unknown;
      };
      if (
        candidate.method !== "totp" ||
        typeof candidate.totpURI !== "string" ||
        !Array.isArray(candidate.backupCodes) ||
        !candidate.backupCodes.every((code) => typeof code === "string")
      ) {
        throw new Error("Better Auth returned incomplete MFA setup response");
      }
      const secret = totpSecretFromUri(candidate.totpURI);
      if (!secret) throw new Error("Better Auth returned an invalid TOTP URI");
      return context.json({
        data: {
          setupRequired: true as const,
          totpURI: candidate.totpURI,
          secret,
          backupCodes: candidate.backupCodes,
        },
        meta: {},
        requestId: context.get("requestId"),
      });
    }),
  );
};

export const mfaVerifyHandler = async (context: Context<AppEnvironment>) => {
  const body = await parseMfaBody(context, mfaVerifyRequestSchema);
  if (!body)
    return errorResponse(context, "VALIDATION_ERROR", 400, "Invalid MFA verification request");
  const environment = getAuthEnvironment(context);
  const ipRateLimit = await consumeLoginIpRateLimitDistributed(
    context.env,
    environment.secret,
    context.req.header("cf-connecting-ip"),
  );
  if (ipRateLimit.status === "unavailable") {
    console.error({ event: "rate_limit_unavailable.v1", scope: "mfa" });
    return errorResponse(context, "INTERNAL_ERROR", 503, "Request protection is unavailable");
  }
  if (!ipRateLimit.result.allowed) {
    return rateLimitedResponse(context, ipRateLimit.result.retryAfter ?? 1);
  }
  const authResult = await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
    db.transaction(async (transaction) => {
      const auth = createBetterAuth(transaction, environment);
      const currentSessionResponse = await auth.handler(
        internalRequest(context, environment, "/get-session", "GET"),
      );
      const currentSessionBody = await readJson(currentSessionResponse);
      const currentSession = currentSessionBody.ok ? currentSessionBody.value : null;
      if (isSessionPayload(currentSession) && currentSession.user.twoFactorEnabled === true) {
        // The verification endpoint is only for an enrollment session or a signed login
        // challenge. Better Auth also accepts an already authenticated session here; allowing
        // that would forge additional login audit events without a new authentication.
        return mfaErrorResponse(context);
      }
      // All account-mutating flows use this lock. Hold it before consuming the challenge so a
      // password/MFA reset cannot race a successful verification into creating a fresh session.
      if (isSessionPayload(currentSession)) {
        await lockAuthUser(transaction, currentSession.user.id);
      } else {
        // A login challenge deliberately has no regular session cookie. Validate its signed
        // challenge identifier and lock the resolved owner before Better Auth consumes it.
        // Password/MFA resets take the same lock, so they cannot race a new session into life.
        const challengeUserId = await authUserIdFromTwoFactorChallenge(
          transaction,
          context,
          environment.secret,
        );
        if (!challengeUserId) return mfaErrorResponse(context);
        await lockAuthUser(transaction, challengeUserId);
      }
      const preEnrollmentSessionIds = isSessionPayload(currentSession)
        ? (
            await transaction
              .select({ id: authSessions.id })
              .from(authSessions)
              .where(eq(authSessions.userId, currentSession.user.id))
          ).map(({ id }) => id)
        : [];
      const endpoint =
        body.method === "totp" ? "/two-factor/verify-totp" : "/two-factor/verify-backup-code";
      const response = await auth.handler(
        internalRequest(context, environment, endpoint, "POST", {
          code: body.code,
          trustDevice: false,
          ...(body.method === "backup" ? { disableSession: false } : {}),
        }),
      );
      if (response.status === 429) {
        appendSetCookies(context, response.headers);
        return mfaErrorResponse(context, 429);
      }
      if (response.status === 400 || response.status === 401) {
        appendSetCookies(context, response.headers);
        return mfaErrorResponse(context);
      }
      if (!response.ok)
        throw new Error(`Better Auth MFA verification returned HTTP ${response.status}`);
      const parsed = await readJson(response);
      if (!parsed.ok || !isLoginPayload(parsed.value)) return null;
      if (preEnrollmentSessionIds.length > 0) {
        // Initial enrollment creates a fresh session before deleting the session used for
        // setup. Delete the complete snapshot of sessions that predated verification so a
        // second password-only session cannot become authenticated when the user-level MFA
        // flag is enabled.
        await transaction
          .delete(authSessions)
          .where(inArray(authSessions.id, preEnrollmentSessionIds));
      }
      // Better Auth rotates the session when an unenrolled user verifies the first TOTP. Its
      // plugin response may still contain the pre-rotation token while the Set-Cookie header
      // already carries the new token. Trust the validated Better Auth response and forward all
      // of its cookies instead of rejecting a valid enrollment because that stale token was
      // deleted as part of rotation.
      return { payload: parsed.value, response };
    }),
  );
  if (!authResult || authResult instanceof Response) return authResult ?? mfaErrorResponse(context);
  const profile = await withRequestDatabase(getConnectionString(context, "app"), (db) =>
    db.transaction(async (transaction) => {
      const loaded = await loadActiveProfile(transaction, authResult.payload.user.id);
      if (!loaded) return null;
      const now = new Date();
      await transaction
        .update(appUsers)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(appUsers.authUserId, authResult.payload.user.id));
      await recordServerProductEvent(transaction, {
        authUserId: authResult.payload.user.id,
        networkId: loaded.networkId,
        type: "login_succeeded",
        metadata: {},
        occurredAt: now,
      });
      return loaded;
    }),
  );
  if (!profile) {
    await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
      db.transaction((transaction) => revokeUserSessions(transaction, authResult.payload.user.id)),
    );
    return mfaErrorResponse(context);
  }
  await withRequestDatabase(getConnectionString(context, "auth"), (db) =>
    db.transaction((transaction) =>
      clearLoginFailures(
        transaction,
        loginAccountRateLimitKey(environment.secret, profile.profile.login),
      ),
    ),
  );
  context.set("safeAccount", { userId: profile.profile.userId, networkId: profile.networkId });
  appendSetCookies(context, authResult.response.headers);
  return context.json({
    data: { authenticated: true as const, profile: profile.profile },
    meta: {},
    requestId: context.get("requestId"),
  });
};

export const meHandler = (context: Context<AppEnvironment>) =>
  context.json(
    {
      data: context.get("preMfaAuth")
        ? { mfaSetupRequired: true as const }
        : { authenticated: true as const, profile: context.get("auth").profile },
      meta: {},
      requestId: context.get("requestId"),
    },
    200,
  );

export const __test = {
  clearSessionCookie,
  classifyAuthResponse,
  getSetCookieValues,
  isLoginPayload,
  isSessionPayload,
  isMfaChallengePayload,
  mfaMethodsFor,
  totpSecretFromUri,
  mfaRequiredFor,
};
