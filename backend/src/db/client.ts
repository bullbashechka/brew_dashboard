import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client, type ClientConfig } from "pg";

import * as schema from "./schema.ts";

export type RequestDatabase = NodePgDatabase<typeof schema>;
type TransactionCallback = Parameters<RequestDatabase["transaction"]>[0];
export type RequestTransaction = Parameters<TransactionCallback>[0];
export type DatabaseExecutor = RequestDatabase | RequestTransaction;

type RequestClientLifecycle = {
  connect: () => Promise<unknown>;
  end: () => Promise<void>;
};

export class DatabaseConnectionCloseError extends Error {
  constructor() {
    super("Database connection could not be closed");
    this.name = "DatabaseConnectionCloseError";
  }
}

export const REQUEST_DATABASE_CLIENT_CONFIG = {
  connectionTimeoutMillis: 5_000,
  lock_timeout: 3_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
  idle_in_transaction_session_timeout: 20_000,
  application_name: "brew-dashboard-worker",
} satisfies Omit<ClientConfig, "connectionString">;

const withClientLifecycle = async <T>(
  client: RequestClientLifecycle,
  callback: () => Promise<T>,
): Promise<T> => {
  let primaryFailed = false;
  let primaryError: unknown;
  let result: T | undefined;
  try {
    await client.connect();
    result = await callback();
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  }
  try {
    await client.end();
  } catch (error) {
    console.error({
      event: "database_connection_close_failed.v1",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (!primaryFailed) throw new DatabaseConnectionCloseError();
  }
  if (primaryFailed) throw primaryError;
  return result as T;
};

export const withRequestDatabase = async <T>(
  connectionString: string,
  callback: (db: RequestDatabase) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString, ...REQUEST_DATABASE_CLIENT_CONFIG });
  return withClientLifecycle(client, () => callback(drizzle(client, { schema })));
};

export const setTenantContext = async (transaction: RequestTransaction, networkId: string) => {
  await transaction.execute(sql`select set_config('app.network_id', ${networkId}, true)`);
};

export const setAuthUserContext = async (transaction: RequestTransaction, authUserId: string) => {
  await transaction.execute(sql`select set_config('app.auth_user_id', ${authUserId}, true)`);
};

const advisoryLock = async (transaction: RequestTransaction, key: string) => {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
};

export const lockLogin = (transaction: RequestTransaction, accountKey: string) =>
  advisoryLock(transaction, `brew-dashboard:login:${accountKey}`);

export const lockAuthUser = (transaction: RequestTransaction, authUserId: string) =>
  advisoryLock(transaction, `brew-dashboard:user:${authUserId}`);

export const lockNetwork = (transaction: RequestTransaction, networkId: string) =>
  advisoryLock(transaction, `brew-dashboard:network:${networkId}`);

export const lockProductEvent = (transaction: RequestTransaction, eventId: string) =>
  advisoryLock(transaction, `brew-dashboard:product-event:${eventId}`);

export const lockRateLimit = (transaction: RequestTransaction, key: string) =>
  advisoryLock(transaction, `brew-dashboard:rate-limit:${key}`);

export const lockActiveDemoLimit = (transaction: RequestTransaction) =>
  advisoryLock(transaction, "brew-dashboard:active-demo-limit");

export const __test = { withClientLifecycle };
