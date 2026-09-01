import { passwordSchema } from "@brew-dashboard/contracts";
import { createLocalAccountIssuer } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";

import {
  lockActiveDemoLimit,
  lockAuthUser,
  lockLogin,
  type RequestDatabase,
  type RequestTransaction,
} from "../db/client.ts";
import {
  appUsers,
  authAccounts,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
  networks,
} from "../db/schema.ts";
import { parseLogin, parsePassword } from "../auth/login.ts";

export const MAX_ACTIVE_DEMO_ACCOUNTS = 15;
const credentialIssuer = createLocalAccountIssuer("credential");

export type AccountKind = "demo" | "e2e";

export class AdminAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAccountError";
  }
}

export const generatePassword = () => passwordSchema.parse(randomBytes(24).toString("base64url"));

const findAccountForUpdate = async (
  transaction: RequestTransaction,
  loginNormalized: string,
  expectedKind?: AccountKind,
) => {
  await lockLogin(transaction, loginNormalized);
  const rows = await transaction
    .select({
      appUserId: appUsers.id,
      authUserId: appUsers.authUserId,
      networkId: appUsers.networkId,
      accountKind: appUsers.accountKind,
      status: appUsers.status,
    })
    .from(appUsers)
    .where(eq(appUsers.loginNormalized, loginNormalized))
    .for("update");
  const account = rows[0];
  if (!account) throw new AdminAccountError("The explicitly selected account does not exist");
  if (expectedKind && account.accountKind !== expectedKind) {
    throw new AdminAccountError("The selected account kind does not match");
  }
  await lockAuthUser(transaction, account.authUserId);
  return account;
};

export const createAccount = async (
  db: RequestDatabase,
  input: {
    login: string;
    password?: string;
    accountKind?: AccountKind;
    expiresAt?: Date | null;
  },
) => {
  const loginNormalized = parseLogin(input.login);
  const password =
    input.password !== undefined ? parsePassword(input.password) : generatePassword();
  const accountKind = input.accountKind ?? "demo";
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new AdminAccountError("expiresAt must be in the future");
  }
  const passwordHash = await hashPassword(password);
  const authUserId = randomUUID();
  const technicalEmail = `${authUserId}@accounts.brew-dashboard.invalid`;

  const account = await db.transaction(async (transaction) => {
    await lockLogin(transaction, loginNormalized);
    await lockActiveDemoLimit(transaction);

    const duplicate = await transaction
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.loginNormalized, loginNormalized))
      .limit(1);
    if (duplicate[0]) throw new AdminAccountError("Login is already in use");

    if (accountKind === "demo") {
      const active = await transaction
        .select({ value: count() })
        .from(appUsers)
        .where(
          and(
            eq(appUsers.accountKind, "demo"),
            eq(appUsers.status, "active"),
            or(isNull(appUsers.expiresAt), gt(appUsers.expiresAt, sql`now()`)),
          ),
        );
      if ((active[0]?.value ?? 0) >= MAX_ACTIVE_DEMO_ACCOUNTS) {
        throw new AdminAccountError(
          `The limit of ${MAX_ACTIVE_DEMO_ACCOUNTS} active demo accounts has been reached`,
        );
      }
    }

    const network = await transaction.insert(networks).values({}).returning({ id: networks.id });
    const networkId = network[0]?.id;
    if (!networkId) throw new AdminAccountError("Failed to create the empty network");

    await transaction.insert(authUsers).values({
      id: authUserId,
      name: loginNormalized,
      email: technicalEmail,
      emailVerified: false,
      username: loginNormalized,
      displayUsername: loginNormalized,
    });
    await transaction.insert(authAccounts).values({
      id: randomUUID(),
      issuer: credentialIssuer,
      accountId: authUserId,
      providerId: "credential",
      userId: authUserId,
      password: passwordHash,
    });
    await transaction.insert(appUsers).values({
      authUserId,
      loginNormalized,
      networkId,
      accountKind,
      expiresAt,
    });

    return { authUserId, networkId };
  });

  return { ...account, login: loginNormalized, password };
};

export const resetAccountPassword = async (
  db: RequestDatabase,
  input: { login: string; password?: string; accountKind?: AccountKind },
) => {
  const loginNormalized = parseLogin(input.login);
  const password =
    input.password !== undefined ? parsePassword(input.password) : generatePassword();
  const passwordHash = await hashPassword(password);

  await db.transaction(async (transaction) => {
    const account = await findAccountForUpdate(transaction, loginNormalized, input.accountKind);
    const updated = await transaction
      .update(authAccounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(authAccounts.userId, account.authUserId),
          eq(authAccounts.providerId, "credential"),
          eq(authAccounts.issuer, credentialIssuer),
          eq(authAccounts.accountId, account.authUserId),
        ),
      )
      .returning({ id: authAccounts.id });
    if (!updated[0]) throw new AdminAccountError("Credential account is missing");
    await transaction.delete(authSessions).where(eq(authSessions.userId, account.authUserId));
    await transaction
      .delete(authVerifications)
      .where(eq(authVerifications.value, account.authUserId));
  });

  return { login: loginNormalized, password };
};

/** Revoke MFA enrollment and every active session for a specifically confirmed account. */
export const resetAccountMfa = async (
  db: RequestDatabase,
  input: { login: string; accountKind?: AccountKind },
) => {
  const loginNormalized = parseLogin(input.login);
  await db.transaction(async (transaction) => {
    const account = await findAccountForUpdate(transaction, loginNormalized, input.accountKind);
    await transaction
      .update(authUsers)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(authUsers.id, account.authUserId));
    await transaction.delete(authTwoFactors).where(eq(authTwoFactors.userId, account.authUserId));
    await transaction.delete(authSessions).where(eq(authSessions.userId, account.authUserId));
    await transaction
      .delete(authVerifications)
      .where(eq(authVerifications.value, account.authUserId));
  });
  return { login: loginNormalized };
};

export const disableAccount = async (
  db: RequestDatabase,
  input: { login: string; accountKind?: AccountKind },
) => {
  const loginNormalized = parseLogin(input.login);
  await db.transaction(async (transaction) => {
    const account = await findAccountForUpdate(transaction, loginNormalized, input.accountKind);
    await transaction
      .update(appUsers)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(appUsers.id, account.appUserId));
    await transaction.delete(authSessions).where(eq(authSessions.userId, account.authUserId));
    await transaction
      .delete(authVerifications)
      .where(eq(authVerifications.value, account.authUserId));
  });
  return { login: loginNormalized };
};

export const deleteAccount = async (
  db: RequestDatabase,
  input: { login: string; accountKind?: AccountKind },
) => {
  const loginNormalized = parseLogin(input.login);
  await db.transaction(async (transaction) => {
    const account = await findAccountForUpdate(transaction, loginNormalized, input.accountKind);
    if (account.accountKind !== "demo" && account.accountKind !== "e2e") {
      throw new AdminAccountError("Only an explicitly selected demo or e2e account may be deleted");
    }

    await transaction.delete(networks).where(eq(networks.id, account.networkId));
    await transaction.delete(authUsers).where(eq(authUsers.id, account.authUserId));
  });
  return { login: loginNormalized };
};
