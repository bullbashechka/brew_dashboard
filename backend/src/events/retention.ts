import { sql } from "drizzle-orm";

import type { DatabaseExecutor, RequestDatabase, RequestTransaction } from "../db/client.ts";

export const PRODUCT_EVENTS_RETENTION_DAYS = 90;
export const PRODUCT_EVENTS_CLEANUP_BATCH_SIZE = 500;
export const PRODUCT_EVENTS_MAX_ROWS_PER_RUN = 10_000;

type QueryResult<T> = { rows: T[] };

type RetentionStats = {
  count: number;
  relationBytes: number;
};

export type ProductEventsRetentionOptions = {
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
  maxRows?: number;
  dryRun?: boolean;
};

export type ProductEventsRetentionReport = {
  cutoff: string;
  retentionDays: number;
  batchSize: number;
  maxRows: number;
  dryRun: boolean;
  candidates: number;
  deleted: number;
  batches: number;
  beforeCount: number;
  afterCount: number;
  relationBytesBefore: number;
  remainingCandidates: number;
  hasMore: boolean;
};

const rowsOf = <T>(result: unknown): T[] => (result as QueryResult<T>).rows ?? [];

const validateOptions = (options: ProductEventsRetentionOptions) => {
  const retentionDays = options.retentionDays ?? PRODUCT_EVENTS_RETENTION_DAYS;
  const batchSize = options.batchSize ?? PRODUCT_EVENTS_CLEANUP_BATCH_SIZE;
  const maxRows = options.maxRows ?? PRODUCT_EVENTS_MAX_ROWS_PER_RUN;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("retentionDays must be an integer between 1 and 3650");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("batchSize must be an integer between 1 and 500");
  }
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > PRODUCT_EVENTS_MAX_ROWS_PER_RUN) {
    throw new Error(`maxRows must be an integer between 1 and ${PRODUCT_EVENTS_MAX_ROWS_PER_RUN}`);
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("now must be a valid date");
  return {
    now,
    retentionDays,
    batchSize,
    maxRows,
    dryRun: options.dryRun ?? true,
  };
};

const readStats = async (executor: DatabaseExecutor): Promise<RetentionStats> => {
  const result = rowsOf<{ count: string; relationBytes: string }>(
    await executor.execute(sql`
      SELECT count(*)::text AS count,
             pg_total_relation_size('app.product_events')::text AS "relationBytes"
        FROM app.product_events
    `),
  );
  const row = result[0];
  return {
    count: Number(row?.count ?? 0),
    relationBytes: Number(row?.relationBytes ?? 0),
  };
};

const countCandidates = async (executor: DatabaseExecutor, cutoff: Date) => {
  const result = rowsOf<{ count: string }>(
    await executor.execute(sql`
      SELECT count(*)::text AS count
        FROM app.product_events
       WHERE occurred_at < ${cutoff}
    `),
  );
  return Number(result[0]?.count ?? 0);
};

const deleteBatch = async (db: RequestDatabase, cutoff: Date, batchSize: number) =>
  db.transaction(async (transaction: RequestTransaction) => {
    await transaction.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await transaction.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const removed = rowsOf<{ id: string }>(
      await transaction.execute(sql`
        WITH doomed AS (
          SELECT id
            FROM app.product_events
           WHERE occurred_at < ${cutoff}
           ORDER BY occurred_at ASC, id ASC
           LIMIT ${batchSize}
        )
        DELETE FROM app.product_events events
         USING doomed
         WHERE events.id = doomed.id
        RETURNING events.id
      `),
    );
    return removed.length;
  });

/**
 * Inspect and, unless dryRun is true, delete product events older than the
 * retention cutoff in bounded batches. Only aggregate storage statistics are
 * returned; event IDs, routes and metadata never leave this service.
 */
export const cleanupProductEvents = async (
  db: RequestDatabase,
  options: ProductEventsRetentionOptions = {},
): Promise<ProductEventsRetentionReport> => {
  const { now, retentionDays, batchSize, maxRows, dryRun } = validateOptions(options);
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const before = await readStats(db);
  const candidates = await countCandidates(db, cutoff);
  const target = Math.min(candidates, maxRows);
  let deleted = 0;
  let batches = 0;

  if (!dryRun) {
    while (deleted < target) {
      const removed = await deleteBatch(db, cutoff, Math.min(batchSize, target - deleted));
      if (removed === 0) break;
      deleted += removed;
      batches += 1;
    }
  }

  const after = await readStats(db);
  const remainingCandidates = dryRun ? candidates : await countCandidates(db, cutoff);
  return {
    cutoff: cutoff.toISOString(),
    retentionDays,
    batchSize,
    maxRows,
    dryRun,
    candidates,
    deleted,
    batches,
    beforeCount: before.count,
    afterCount: after.count,
    relationBytesBefore: before.relationBytes,
    remainingCandidates,
    hasMore: remainingCandidates > 0,
  };
};

export const __test = { validateOptions };
