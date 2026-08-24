import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import * as schema from "./schema.ts";

export type RequestDatabase = NodePgDatabase<typeof schema>;
type TransactionCallback = Parameters<RequestDatabase["transaction"]>[0];
export type RequestTransaction = Parameters<TransactionCallback>[0];
export type DatabaseExecutor = RequestDatabase | RequestTransaction;

export const withRequestDatabase = async <T>(
  connectionString: string,
  callback: (db: RequestDatabase) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return await callback(drizzle(client, { schema }));
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const setTenantContext = async (transaction: RequestTransaction, networkId: string) => {
  await transaction.execute(sql`select set_config('app.network_id', ${networkId}, true)`);
};

export const withTenantTransaction = async <T>(
  db: RequestDatabase,
  networkId: string,
  callback: (transaction: RequestTransaction) => Promise<T>,
): Promise<T> =>
  db.transaction(async (transaction) => {
    await setTenantContext(transaction, networkId);
    return callback(transaction);
  });

const advisoryLock = async (transaction: RequestTransaction, key: string) => {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
};

export const lockLogin = (transaction: RequestTransaction, loginNormalized: string) =>
  advisoryLock(transaction, `brew-dashboard:login:${loginNormalized}`);

export const lockAuthUser = (transaction: RequestTransaction, authUserId: string) =>
  advisoryLock(transaction, `brew-dashboard:user:${authUserId}`);

export const lockActiveDemoLimit = (transaction: RequestTransaction) =>
  advisoryLock(transaction, "brew-dashboard:active-demo-limit");
