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
import { errorResponse, unauthenticatedResponse } from "../http/errors.ts";
import type { AppEnvironment } from "../http/types.ts";
import {
  AUTH_BASE_PATH,
  SESSION_COOKIE_NAME,
  createBetterAuth,
  type BetterAuthEnvironment,
} from "./better-auth.ts";
import { LoginRateLimitError, consumeLoginPairRateLimit } from "./rate-limit.ts";
import { normalizeLogin } from "./login.ts";
import { localDateKey } from "../domain/periods.ts";

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
  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  ) {
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

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
): Promise<LoadedProfile | null> => {
  const rows = await transaction
    .select({
      appUser: appUsers,
      displayUsername: authUsers.displayUsername,
    })
    .from(appUsers)
    .innerJoin(authUsers, eq(authUsers.id, appUsers.authUserId))
    .where(
      and(
        eq(appUsers.authUserId, authUserId),
        eq(appUsers.status, "active"),
        or(isNull(appUsers.expiresAt), gt(appUsers.expiresAt, now)),
      ),
    )
    .for("update");
  const identity = rows[0];
  if (!identity) return null;

  await setTenantContext(transaction, identity.appUser.networkId);
  const network = await transaction
    .select()
    .from(networks)
    .where(eq(networks.id, identity.appUser.networkId))
    .limit(1);
  const currentNetwork = network[0];
  if (!currentNetwork) return null;

  const profile = profileSchema.parse({
    userId: identity.appUser.authUserId,
    login: identity.displayUsername || identity.appUser.loginNormalized,
    networkId: identity.appUser.networkId,
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
    tourState: identity.appUser.tourCompletedAt
      ? "completed"
      : identity.appUser.tourSkippedAt
        ? "skipped"
        : "pending",
    expiresAt: identity.appUser.expiresAt?.toISOString() ?? null,
  });

  return { networkId: identity.appUser.networkId, profile };
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
  const credentials = await parseLoginRequest(context);
  if (!credentials) return unauthenticatedResponse(context);

  const environment = getAuthEnvironment(context);
  const ipAddress = context.req.header("cf-connecting-ip") ?? "no-trusted-ip";
  let result:
    | { kind: "success"; profile: Profile; response: Response }
    | { kind: "invalid"; clearCookie?: boolean }
    | { kind: "rate-limited"; retryAfter: number };

  try {
    result = await withRequestDatabase(getConnectionString(context), (db) =>
      db.transaction(async (transaction) => {
        await consumeLoginPairRateLimit(transaction, ipAddress, credentials.login);
        await lockLogin(transaction, credentials.login);
        const auth = createBetterAuth(transaction, environment);
        const response = await auth.handler(
          internalRequest(context, environment, "/sign-in/username", "POST", {
            username: credentials.login,
            password: credentials.password,
          }),
        );

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("retry-after") ?? 900);
          return { kind: "rate-limited" as const, retryAfter };
        }
        const payload = await readJson(response);
        if (!response.ok || !isLoginPayload(payload)) {
          return { kind: "invalid" as const };
        }

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
          return { kind: "invalid" as const, clearCookie: true };
        }

        await transaction
          .update(appUsers)
          .set({ lastLoginAt: new Date(), updatedAt: new Date() })
          .where(eq(appUsers.authUserId, payload.user.id));

        return { kind: "success" as const, profile: profile.profile, response };
      }),
    );
  } catch (error) {
    if (error instanceof LoginRateLimitError) {
      return rateLimitedResponse(context, error.retryAfter);
    }
    throw error;
  }

  if (result.kind === "rate-limited") return rateLimitedResponse(context, result.retryAfter);
  if (result.kind === "invalid") {
    if (result.clearCookie) clearSessionCookie(context);
    return unauthenticatedResponse(context);
  }

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
      const payload = await readJson(response);
      if (!response.ok || !isSessionPayload(payload)) {
        appendSetCookies(context, response.headers);
        clearSessionCookie(context);
        return unauthenticatedResponse(context);
      }

      await lockAuthUser(transaction, payload.user.id);
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
        ? await loadActiveProfile(transaction, payload.user.id)
        : null;
      if (!profile) {
        await revokeUserSessions(transaction, payload.user.id);
        clearSessionCookie(context);
        return unauthenticatedResponse(context);
      }

      context.set("database", transaction);
      context.set("auth", {
        authUserId: payload.user.id,
        networkId: profile.networkId,
        profile: profile.profile,
        sessionId: payload.session.id,
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
      const payload = await readJson(sessionResponse);
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
  getSetCookieValues,
  isLoginPayload,
  isSessionPayload,
};
