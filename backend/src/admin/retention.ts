import { sql } from "drizzle-orm";

import type { RequestDatabase, RequestTransaction } from "../db/client.ts";

export const EXPIRED_SECURITY_DATA_GRACE_HOURS = 24;
export const COMPLETED_IDEMPOTENCY_RETENTION_DAYS = 30;
export const SECURITY_DATA_CLEANUP_BATCH_SIZE = 500;
export const SECURITY_DATA_CLEANUP_MAX_ROWS = 10_000;

type CleanupKind = "sessions" | "verifications" | "completedIdempotency" | "pendingIdempotency";
type Counts = Record<CleanupKind, number>;
type QueryResult<T> = { rows: T[] };

export type SecurityDataCleanupOptions = {
  now?: Date;
  batchSize?: number;
  maxRows?: number;
  dryRun?: boolean;
};

export type SecurityDataCleanupReport = {
  dryRun: boolean;
  graceCutoff: string;
  completedIdempotencyCutoff: string;
  batchSize: number;
  maxRows: number;
  candidates: Counts;
  deleted: Counts;
  batches: number;
  remainingCandidates: Counts;
  hasMore: boolean;
};

const emptyCounts = (): Counts => ({
  sessions: 0,
  verifications: 0,
  completedIdempotency: 0,
  pendingIdempotency: 0,
});

const rowsOf = <T>(result: unknown): T[] => (result as QueryResult<T>).rows ?? [];

const validateOptions = (options: SecurityDataCleanupOptions) => {
  const batchSize = options.batchSize ?? SECURITY_DATA_CLEANUP_BATCH_SIZE;
  const maxRows = options.maxRows ?? SECURITY_DATA_CLEANUP_MAX_ROWS;
  const now = options.now ?? new Date();
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > SECURITY_DATA_CLEANUP_BATCH_SIZE
  ) {
    throw new Error(
      `batchSize must be an integer between 1 and ${SECURITY_DATA_CLEANUP_BATCH_SIZE}`,
    );
  }
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > SECURITY_DATA_CLEANUP_MAX_ROWS) {
    throw new Error(`maxRows must be an integer between 1 and ${SECURITY_DATA_CLEANUP_MAX_ROWS}`);
  }
  if (!Number.isFinite(now.getTime())) throw new Error("now must be a valid date");
  return { now, batchSize, maxRows, dryRun: options.dryRun ?? true };
};

const countCandidates = async (
  db: RequestDatabase,
  graceCutoff: Date,
  completedCutoff: Date,
): Promise<Counts> => {
  const result = rowsOf<{
    sessions: string;
    verifications: string;
    completedIdempotency: string;
    pendingIdempotency: string;
  }>(
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM auth.sessions WHERE expires_at < ${graceCutoff})::text AS sessions,
        (SELECT count(*) FROM auth.verifications WHERE expires_at < ${graceCutoff})::text AS verifications,
        (SELECT count(*) FROM app.idempotency_keys WHERE completed_at < ${completedCutoff})::text AS "completedIdempotency",
        (SELECT count(*) FROM app.idempotency_keys WHERE completed_at IS NULL AND created_at < ${graceCutoff})::text AS "pendingIdempotency"
    `),
  )[0];
  return {
    sessions: Number(result?.sessions ?? 0),
    verifications: Number(result?.verifications ?? 0),
    completedIdempotency: Number(result?.completedIdempotency ?? 0),
    pendingIdempotency: Number(result?.pendingIdempotency ?? 0),
  };
};

const deleteBatch = async (db: RequestDatabase, kind: CleanupKind, cutoff: Date, limit: number) =>
  db.transaction(async (transaction: RequestTransaction) => {
    await transaction.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await transaction.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const predicate =
      kind === "sessions"
        ? sql`expires_at < ${cutoff}`
        : kind === "verifications"
          ? sql`expires_at < ${cutoff}`
          : kind === "completedIdempotency"
            ? sql`completed_at < ${cutoff}`
            : sql`completed_at IS NULL AND created_at < ${cutoff}`;
    const table =
      kind === "sessions"
        ? sql`auth.sessions`
        : kind === "verifications"
          ? sql`auth.verifications`
          : sql`app.idempotency_keys`;
    const orderColumn =
      kind === "completedIdempotency"
        ? sql`completed_at`
        : kind === "pendingIdempotency"
          ? sql`created_at`
          : sql`expires_at`;
    const deleted = rowsOf<{ id: string }>(
      await transaction.execute(sql`
        WITH doomed AS (
          SELECT id FROM ${table}
          WHERE ${predicate}
          ORDER BY ${orderColumn} ASC, id ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM ${table} target
        USING doomed
        WHERE target.id = doomed.id
        RETURNING target.id
      `),
    );
    return deleted.length;
  });

/**
 * Bounded owner-only cleanup for expired credentials and idempotency keys.
 * It returns aggregate counts only and defaults to a dry run.
 */
export const cleanupExpiredSecurityData = async (
  db: RequestDatabase,
  options: SecurityDataCleanupOptions = {},
): Promise<SecurityDataCleanupReport> => {
  const { now, batchSize, maxRows, dryRun } = validateOptions(options);
  const graceCutoff = new Date(now.getTime() - EXPIRED_SECURITY_DATA_GRACE_HOURS * 60 * 60 * 1000);
  const completedCutoff = new Date(
    now.getTime() - COMPLETED_IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const candidates = await countCandidates(db, graceCutoff, completedCutoff);
  const deleted = emptyCounts();
  let batches = 0;

  if (!dryRun) {
    const cutoffs: Record<CleanupKind, Date> = {
      sessions: graceCutoff,
      verifications: graceCutoff,
      completedIdempotency: completedCutoff,
      pendingIdempotency: graceCutoff,
    };
    for (const kind of Object.keys(candidates) as CleanupKind[]) {
      while (
        deleted[kind] < candidates[kind] &&
        Object.values(deleted).reduce((a, b) => a + b, 0) < maxRows
      ) {
        const remaining = maxRows - Object.values(deleted).reduce((a, b) => a + b, 0);
        const removed = await deleteBatch(db, kind, cutoffs[kind], Math.min(batchSize, remaining));
        if (removed === 0) break;
        deleted[kind] += removed;
        batches += 1;
      }
    }
  }

  const remainingCandidates = dryRun
    ? candidates
    : await countCandidates(db, graceCutoff, completedCutoff);
  return {
    dryRun,
    graceCutoff: graceCutoff.toISOString(),
    completedIdempotencyCutoff: completedCutoff.toISOString(),
    batchSize,
    maxRows,
    candidates,
    deleted,
    batches,
    remainingCandidates,
    hasMore: Object.values(remainingCandidates).some((count) => count > 0),
  };
};

export const __test = { validateOptions };
