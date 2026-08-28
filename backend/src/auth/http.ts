import {
  loginRequestSchema,
  profileSchema,
  type LoginRequest,
  type Profile,
} from "@brew-dashboard/contracts";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Context, Next } from "hono";

import {
  lockAuthUser,
  lockLogin,
  setTenantContext,
  withRequestDatabase,
  type RequestTransaction,
} from "../db/client.ts";
import { appUsers, authSessions, authUsers, networks } from "../db/schema.ts";
import { recordServerProductEvent } from "../events/service.ts";
import { errorResponse, unauthenticatedResponse } from "../http/errors.ts";
import { observableRoute } from "../http/middleware.ts";
import type { AppEnvironment } from "../http/types.ts";
import {
  AUTH_BASE_PATH,
  SESSION_COOKIE_NAME,
  createBetterAuth,
  type BetterAuthEnvironment,
} from "./better-auth.ts";
import {
  checkLoginAccountRateLimit,
  clearLoginFailures,
  consumeLoginIpRateLimit,
  consumeAuthenticatedRequestRateLimit,
  loginAccountRateLimitKey,
  recordLoginFailure,
} from "./rate-limit.ts";
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
  };
};

type LoginPayload = {
  token: string;
  user: {
    id: string;
  };
};

type LoadedProfile = {
  profile: Profile;
  networkId: string;
};

const getAuthEnvironment = (context: Context<AppEnvironment>): BetterAuthEnvironment => {
  const secret = context.env?.BETTER_AUTH_SECRET;
  const baseUrl = context.env?.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseUrl) {
    throw new Error("Better Auth server configuration is unavailable");
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("Better Auth URL must use HTTPS outside local development");
  }
  return { secret, baseUrl: parsed.origin };
};

const getConnectionString = (context: Context<AppEnvironment>) => {
  const connectionString = context.env.HYPERDRIVE?.connectionString;
  if (!connectionString) throw new Error("Hyperdrive binding is unavailable");
  return connectionString;
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
    typeof candidate.user.id === "string",
  );
};

const isLoginPayload = (value: unknown): value is LoginPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LoginPayload>;
  return Boolean(
    typeof candidate.token === "string" && candidate.user && typeof candidate.user.id === "string",
  );
};

export const loadActiveProfile = async (
  transaction: RequestTransaction,
  authUserId: string,
  now = new Date(),
  options: { lock?: boolean } = {},
): Promise<LoadedProfile | null> => {
  const profileQuery = transaction
    .select()
    .from(appUsers)
    .where(
      and(
        eq(appUsers.authUserId, authUserId),
        eq(appUsers.status, "active"),
        or(isNull(appUsers.expiresAt), gt(appUsers.expiresAt, now)),
      ),
    );
  const rows = options.lock === false ? await profileQuery : await profileQuery.for("update");
  const appUser = rows[0];
  if (!appUser) return null;

  const userRows = await transaction
    .select({ displayUsername: authUsers.displayUsername })
    .from(authUsers)
    .where(eq(authUsers.id, appUser.authUserId))
    .limit(1);
  const user = userRows[0];
  if (!user) return null;

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
    login: user.displayUsername || appUser.loginNormalized,
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
  const ipRateLimit = consumeLoginIpRateLimit(
    environment.secret,
    context.req.header("cf-connecting-ip"),
  );
  if (!ipRateLimit.allowed) {
    return rateLimitedResponse(context, ipRateLimit.retryAfter ?? 1);
  }

  const credentials = await parseLoginRequest(context);
  if (!credentials) return unauthenticatedResponse(context);

  const accountKey = loginAccountRateLimitKey(environment.secret, credentials.login);
  const result:
    | { kind: "success"; profile: Profile; response: Response }
    | { kind: "invalid"; clearCookie?: boolean }
    | { kind: "rate-limited"; retryAfter: number } = await withRequestDatabase(
    getConnectionString(context),
    (db) =>
      db.transaction(async (transaction) => {
        await lockLogin(transaction, accountKey);
        const accountRateLimit = await checkLoginAccountRateLimit(transaction, accountKey);
        if (!accountRateLimit.allowed) {
          return {
            kind: "rate-limited" as const,
            retryAfter: accountRateLimit.retryAfter ?? 1,
          };
        }
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
        if (!isLoginPayload(body.value)) throw unexpectedAuthResponse("login", response);
        const payload = body.value;

        await lockAuthUser(transaction, payload.user.id);
        const profile = await loadActiveProfile(transaction, payload.user.id);
        const session = await transaction
          .select({ id: authSessions.id })
          .from(authSessions)
          .where(
            and(eq(authSessions.userId, payload.user.id), eq(authSessions.token, payload.token)),
          )
          .limit(1);
        if (!profile || !session[0]) {
          await revokeUserSessions(transaction, payload.user.id);
          await recordLoginFailure(transaction, accountKey);
          return { kind: "invalid" as const, clearCookie: true };
        }

        const now = new Date();
        await transaction
          .update(appUsers)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(appUsers.authUserId, payload.user.id));
        await recordServerProductEvent(transaction, {
          authUserId: payload.user.id,
          networkId: profile.networkId,
          type: "login_succeeded",
          metadata: {},
          occurredAt: now,
        });
        await clearLoginFailures(transaction, accountKey);

        return { kind: "success" as const, profile: profile.profile, response };
      }),
  );

  if (result.kind === "rate-limited") return rateLimitedResponse(context, result.retryAfter);
  if (result.kind === "invalid") {
    if (result.clearCookie) clearSessionCookie(context);
    return unauthenticatedResponse(context);
  }

  context.set("safeAccount", {
    userId: result.profile.userId,
    networkId: result.profile.networkId,
  });
  appendSetCookies(context, result.response.headers);
  return context.json({
    data: { authenticated: true as const, profile: result.profile },
    meta: {},
    requestId: context.get("requestId"),
  });
};

export const requireAuthentication = async (
  context: Context<AppEnvironment>,
  next: Next,
): Promise<Response | void> => {
  const environment = getAuthEnvironment(context);
  return withRequestDatabase(getConnectionString(context), (db) =>
    db.transaction(async (transaction) => {
      const auth = createBetterAuth(transaction, environment);
      const response = await auth.handler(
        internalRequest(context, environment, "/get-session", "GET"),
      );
      const responseKind = classifyAuthResponse("get-session", response);
      if (responseKind.kind === "unauthenticated") {
        appendSetCookies(context, response.headers);
        clearSessionCookie(context);
        return unauthenticatedResponse(context);
      }
      const body = await readJson(response);
      if (!body.ok) throw unexpectedAuthResponse("get-session", response);
      const payloadValue = body.value;
      if (payloadValue === null) {
        appendSetCookies(context, response.headers);
        clearSessionCookie(context);
        return unauthenticatedResponse(context);
      }
      if (!isSessionPayload(payloadValue)) throw unexpectedAuthResponse("get-session", response);
      const payload = payloadValue;

      const isReadRequest = context.req.method === "GET" || context.req.method === "HEAD";
      if (!isReadRequest) await lockAuthUser(transaction, payload.user.id);
      const authoritativeSession = await transaction
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(
          and(
            eq(authSessions.id, payload.session.id),
            eq(authSessions.token, payload.session.token),
            eq(authSessions.userId, payload.user.id),
          ),
        )
        .limit(1);
      const profile = authoritativeSession[0]
        ? await loadActiveProfile(transaction, payload.user.id, new Date(), {
            lock: !isReadRequest,
          })
        : null;
      if (!profile) {
        await revokeUserSessions(transaction, payload.user.id);
        clearSessionCookie(context);
        return unauthenticatedResponse(context);
      }

      const requestRateLimit = consumeAuthenticatedRequestRateLimit(
        environment.secret,
        payload.user.id,
        context.req.method,
        context.req.path,
      );
      if (requestRateLimit && !requestRateLimit.allowed) {
        const retryAfter = requestRateLimit.retryAfter ?? 1;
        context.header("retry-after", String(retryAfter));
        console.warn({
          event: "rate_limit_rejected.v1",
          scope: requestRateLimit.scope,
          route: observableRoute(context),
          subjectHash: requestRateLimit.key.slice(-12),
          retryAfter,
        });
        return errorResponse(context, "RATE_LIMITED", 429, "Too many requests");
      }

      context.set("database", transaction);
      context.set("auth", {
        authUserId: payload.user.id,
        networkId: profile.networkId,
        profile: profile.profile,
        sessionId: payload.session.id,
      });
      context.set("safeAccount", {
        userId: profile.profile.userId,
        networkId: profile.networkId,
      });
      appendSetCookies(context, response.headers);
      await next();
      return context.res;
    }),
  );
};

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
  const response = await withRequestDatabase(getConnectionString(context), (db) =>
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

export const meHandler = (context: Context<AppEnvironment>) =>
  context.json(
    {
      data: { authenticated: true as const, profile: context.get("auth").profile },
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
};
