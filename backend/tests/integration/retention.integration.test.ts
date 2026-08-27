import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Client } from "pg";

import { createAccount, deleteAccount } from "../../src/admin/accounts.ts";
import { withRequestDatabase } from "../../src/db/client.ts";
import { cleanupProductEvents } from "../../src/events/retention.ts";

const ownerUrl = process.env.DATABASE_TEST_URL;
const describeIntegration = describe.skipIf(!ownerUrl);

describeIntegration("product event retention cleanup", () => {
  const client = new Client({ connectionString: ownerUrl });
  let account: Awaited<ReturnType<typeof createAccount>>;
  let appUserId: string;

  beforeAll(async () => {
    await client.connect();
    account = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, {
        login: `stage12-retention-${crypto.randomUUID().slice(0, 8)}`,
        password: `test-${crypto.randomUUID()}`,
        accountKind: "e2e",
      }),
    );
    const result = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM app.app_users WHERE network_id = $1",
      [account.networkId],
    );
    appUserId = result.rows[0]!.id;
    await client.query(
      `INSERT INTO app.product_events
         (id, network_id, user_id, type, route, metadata, occurred_at)
       VALUES
         ($1, $2, $3, 'section_viewed', 'overview', '{}'::jsonb, $4),
         ($5, $2, $3, 'filter_changed', 'sales', '{}'::jsonb, $6),
         ($7, $2, $3, 'section_viewed', 'settings', '{}'::jsonb, $8)`,
      [
        crypto.randomUUID(),
        account.networkId,
        appUserId,
        "2026-01-01T00:00:00.000Z",
        crypto.randomUUID(),
        "2026-05-01T00:00:00.000Z",
        crypto.randomUUID(),
        "2026-08-01T00:00:00.000Z",
      ],
    );
  });

  afterAll(async () => {
    if (account) {
      await withRequestDatabase(ownerUrl!, (db) =>
        deleteAccount(db, { login: account.login, accountKind: "e2e" }),
      );
    }
    await client.end();
  });

  it("reports aggregate storage only and deletes in committed bounded runs", async () => {
    const now = new Date("2026-08-26T00:00:00.000Z");
    const dryRun = await withRequestDatabase(ownerUrl!, (db) =>
      cleanupProductEvents(db, { now, batchSize: 1 }),
    );
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.candidates).toBe(2);
    expect(dryRun.deleted).toBe(0);
    expect(dryRun.remainingCandidates).toBe(2);
    expect(dryRun.hasMore).toBe(true);
    expect(JSON.stringify(dryRun)).not.toContain("overview");

    const firstRun = await withRequestDatabase(ownerUrl!, (db) =>
      cleanupProductEvents(db, { now, batchSize: 1, maxRows: 1, dryRun: false }),
    );
    expect(firstRun.deleted).toBe(1);
    expect(firstRun.batches).toBe(1);
    expect(firstRun.remainingCandidates).toBe(1);
    expect(firstRun.hasMore).toBe(true);

    const executed = await withRequestDatabase(ownerUrl!, (db) =>
      cleanupProductEvents(db, { now, batchSize: 1, dryRun: false }),
    );
    expect(executed.deleted).toBe(1);
    expect(executed.batches).toBe(1);
    expect(executed.remainingCandidates).toBe(0);
    expect(executed.hasMore).toBe(false);

    const remaining = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.product_events WHERE network_id = $1",
      [account.networkId],
    );
    expect(remaining.rows[0]?.count).toBe("1");
  });
});
