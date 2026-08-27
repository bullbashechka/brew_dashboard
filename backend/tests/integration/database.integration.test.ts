import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
const networkA = "00000000-0000-0000-0000-000000000001";
const networkB = "00000000-0000-0000-0000-000000000002";
const locationA = "20000000-0000-0000-0000-000000000001";
const locationB = "20000000-0000-0000-0000-000000000002";
const itemA = "30000000-0000-0000-0000-000000000001";
const itemB = "30000000-0000-0000-0000-000000000002";
const balanceA = "40000000-0000-0000-0000-000000000001";
const balanceB = "40000000-0000-0000-0000-000000000002";
const targetA = "60000000-0000-0000-0000-000000000001";
const feedbackA = "70000000-0000-0000-0000-000000000001";
const generationA = "80000000-0000-0000-0000-000000000001";

describe.skipIf(!databaseUrl)("isolated PostgreSQL migration, constraints and RLS", () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query(`
      INSERT INTO auth.users (id, name, email, username, display_username)
      VALUES ('auth-a', 'Owner A', 'owner-a@example.test', 'owner_a', 'owner_a'),
             ('auth-b', 'Owner B', 'owner-b@example.test', 'owner_b', 'owner_b')
    `);
    await client.query(
      `INSERT INTO app.networks
        (id, name, owner_name, country_code, currency_code, timezone, language)
       VALUES ($1, 'Network A', 'Owner A', 'KZ', 'KZT', 'Asia/Almaty', 'en'),
              ($2, 'Network B', 'Owner B', 'KZ', 'KZT', 'Asia/Almaty', 'en')`,
      [networkA, networkB],
    );
    await client.query(
      `INSERT INTO app.app_users
        (id, auth_user_id, login_normalized, network_id, account_kind)
       VALUES ('10000000-0000-0000-0000-000000000001', 'auth-a', 'owner_a', $1, 'e2e'),
              ('10000000-0000-0000-0000-000000000002', 'auth-b', 'owner_b', $2, 'e2e')`,
      [networkA, networkB],
    );
    await client.query(
      `INSERT INTO app.locations (id, network_id, name, name_normalized, sort_order)
       VALUES ($3, $1, 'Central', 'central', 1),
              ($4, $2, 'Central', 'central', 1)`,
      [networkA, networkB, locationA, locationB],
    );
    await client.query(
      `INSERT INTO app.inventory_items (id, network_id, name, unit)
       VALUES ($2, $1, 'Beans', 'kg'),
              ($4, $3, 'Beans', 'kg')`,
      [networkA, itemA, networkB, itemB],
    );
    await client.query(
      `INSERT INTO app.inventory_balances
        (id, network_id, location_id, inventory_item_id, on_hand, min_threshold)
       VALUES ($4, $1, $2, $3, 5.000, 1.000),
              ($8, $5, $6, $7, 5.000, 1.000)`,
      [networkA, locationA, itemA, balanceA, networkB, locationB, itemB, balanceB],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it("keeps the runtime role non-privileged and tenant-scoped", async () => {
    const role = await client.query<{
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
       FROM pg_roles WHERE rolname = 'brew_runtime'`,
    );
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
    });

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE brew_runtime");
      await client.query("SELECT set_config('app.network_id', $1, true)", [networkA]);
      const locations = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.locations",
      );
      const foreignRows = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.inventory_balances WHERE id = $1",
        [balanceB],
      );
      expect(locations.rows[0]?.count).toBe("1");
      expect(foreignRows.rows[0]?.count).toBe("0");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("uses explicit runtime grants and denies future table privileges by default", async () => {
    const granted = [
      ["auth.users", "SELECT"],
      ["auth.accounts", "SELECT"],
      ["auth.sessions", "SELECT, INSERT, UPDATE, DELETE"],
      ["auth.rate_limits", "SELECT, INSERT, UPDATE, DELETE"],
      ["app.app_users", "SELECT, UPDATE"],
      ["app.networks", "SELECT, UPDATE"],
      ["app.locations", "SELECT, INSERT"],
      ["app.categories", "SELECT, INSERT, DELETE"],
      ["app.orders", "SELECT, INSERT, DELETE"],
      ["app.order_items", "SELECT, INSERT, DELETE"],
      ["app.inventory_items", "SELECT, INSERT, DELETE"],
      ["app.products", "SELECT, INSERT, UPDATE, DELETE"],
      ["app.revenue_targets", "SELECT, INSERT, UPDATE, DELETE"],
      ["app.idempotency_keys", "SELECT, INSERT, UPDATE, DELETE"],
      ["app.feedback_responses", "SELECT, INSERT, UPDATE"],
      ["app.demo_generations", "SELECT, INSERT"],
      ["app.product_events", "SELECT, INSERT"],
      ["app.inventory_balances", "SELECT"],
      ["app.inventory_movements", "SELECT"],
    ] as const;
    for (const [table, privileges] of granted) {
      const result = await client.query<{ granted: boolean }>(
        "SELECT has_table_privilege('brew_runtime', $1, $2) AS granted",
        [table, privileges],
      );
      expect(result.rows[0]?.granted).toBe(true);
    }

    for (const [table, privilege] of [
      ["auth.verifications", "SELECT"],
      ["app.inventory_balances", "INSERT"],
      ["app.inventory_movements", "DELETE"],
      ["app.locations", "UPDATE"],
      ["app.feedback_responses", "DELETE"],
    ] as const) {
      const result = await client.query<{ granted: boolean }>(
        "SELECT has_table_privilege('brew_runtime', $1, $2) AS granted",
        [table, privilege],
      );
      expect(result.rows[0]?.granted).toBe(false);
    }

    const excessive = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname IN ('app', 'auth')
           AND relation.relkind IN ('r', 'p')
           AND (
             has_table_privilege('brew_runtime', relation.oid, 'TRUNCATE')
             OR has_table_privilege('brew_runtime', relation.oid, 'REFERENCES')
             OR has_table_privilege('brew_runtime', relation.oid, 'TRIGGER')
           )
       ) AS exists`,
    );
    expect(excessive.rows[0]?.exists).toBe(false);

    const sequencePrivileges = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname IN ('app', 'auth')
           AND relation.relkind = 'S'
           AND (
             has_table_privilege('brew_runtime', relation.oid, 'SELECT')
             OR has_table_privilege('brew_runtime', relation.oid, 'UPDATE')
             OR has_sequence_privilege('brew_runtime', relation.oid, 'USAGE')
           )
       ) AS exists`,
    );
    expect(sequencePrivileges.rows[0]?.exists).toBe(false);

    try {
      await client.query("CREATE TABLE app.runtime_grant_probe_app (id uuid PRIMARY KEY)");
      await client.query("CREATE TABLE auth.runtime_grant_probe_auth (id text PRIMARY KEY)");
      for (const table of ["app.runtime_grant_probe_app", "auth.runtime_grant_probe_auth"]) {
        const result = await client.query<{ granted: boolean }>(
          "SELECT has_table_privilege('brew_runtime', $1, 'SELECT, INSERT, UPDATE, DELETE') AS granted",
          [table],
        );
        expect(result.rows[0]?.granted).toBe(false);
      }
    } finally {
      await client.query("DROP TABLE IF EXISTS app.runtime_grant_probe_app");
      await client.query("DROP TABLE IF EXISTS auth.runtime_grant_probe_auth");
    }
  });

  it("creates the Better Auth account identity required by the pinned adapter", async () => {
    const issuer = await client.query<{ attnotnull: boolean }>(
      `SELECT attnotnull
       FROM pg_attribute
       WHERE attrelid = 'auth.accounts'::regclass AND attname = 'issuer'`,
    );
    const identityIndex = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_class index_class
         JOIN pg_index index_meta ON index_meta.indexrelid = index_class.oid
         JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
         JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
         JOIN LATERAL (
           SELECT array_agg(attribute.attname ORDER BY key.ordinality) AS columns
           FROM unnest(index_meta.indkey) WITH ORDINALITY AS key(attnum, ordinality)
           JOIN pg_attribute attribute
             ON attribute.attrelid = table_class.oid AND attribute.attnum = key.attnum
         ) index_columns ON true
         WHERE namespace.nspname = 'auth'
           AND table_class.relname = 'accounts'
           AND index_class.relname = 'auth_accounts_issuer_account_id_uidx'
           AND index_meta.indisunique
           AND index_meta.indisvalid
           AND index_meta.indnkeyatts = 2
           AND index_meta.indexprs IS NULL
           AND index_meta.indpred IS NULL
           AND index_columns.columns = ARRAY['issuer', 'account_id']::name[]
       ) AS exists`,
    );

    expect(issuer.rows[0]?.attnotnull).toBe(true);
    expect(identityIndex.rows[0]?.exists).toBe(true);
  });

  it("denies tenant reads without context and enforces composite foreign keys", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE brew_runtime");
      const rows = await client.query("SELECT * FROM app.locations");
      expect(rows.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }

    await expect(
      client.query(
        `INSERT INTO app.inventory_balances
          (network_id, location_id, inventory_item_id, on_hand, min_threshold)
         VALUES ($1, $2, $3, 1.000, 0.000)`,
        [networkA, locationB, itemA],
      ),
    ).rejects.toThrow();
  });

  it("prevents the runtime role from bypassing atomic inventory movement", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE brew_runtime");
      await client.query("SELECT set_config('app.network_id', $1, true)", [networkA]);
      await expect(
        client.query(
          `INSERT INTO app.inventory_movements
            (network_id, location_id, inventory_item_id, type, quantity, occurred_at)
           VALUES ($1, $2, $3, 'receipt', 1.000, now())`,
          [networkA, locationA, itemA],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("applies inventory movement atomically and idempotently", async () => {
    const hash = "a".repeat(64);
    const key = "50000000-0000-0000-0000-000000000001";
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE brew_runtime");
    await client.query("SELECT set_config('app.network_id', $1, true)", [networkA]);
    const first = await client.query<{ movement_id: string; on_hand: string }>(
      `SELECT * FROM app.apply_inventory_movement($1, $2, 'writeoff', 2.000, $3, $4)`,
      [locationA, itemA, hash, key],
    );
    const second = await client.query<{ movement_id: string; on_hand: string }>(
      `SELECT * FROM app.apply_inventory_movement($1, $2, 'writeoff', 2.000, $3, $4)`,
      [locationA, itemA, hash, key],
    );
    const movementCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.inventory_movements
       WHERE network_id = $1 AND location_id = $2 AND inventory_item_id = $3`,
      [networkA, locationA, itemA],
    );
    await client.query("COMMIT");

    expect(second.rows[0]?.movement_id).toBe(first.rows[0]?.movement_id);
    expect(second.rows[0]?.on_hand).toBe("3.000");
    expect(movementCount.rows[0]?.count).toBe("1");

    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE brew_runtime");
    await client.query("SELECT set_config('app.network_id', $1, true)", [networkA]);
    await expect(
      client.query(
        `SELECT * FROM app.apply_inventory_movement($1, $2, 'writeoff', 2.000, $3, $4)`,
        [locationA, itemA, "b".repeat(64), key],
      ),
    ).rejects.toThrow();
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE brew_runtime");
    await client.query("SELECT set_config('app.network_id', $1, true)", [networkA]);
    await expect(
      client.query(
        `SELECT * FROM app.apply_inventory_movement($1, $2, 'writeoff', 4.000, $3, $4)`,
        [locationA, itemA, "c".repeat(64), "50000000-0000-0000-0000-000000000002"],
      ),
    ).rejects.toThrow(/writeoff exceeds current balance/);
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE brew_runtime");
    await client.query("SELECT set_config('app.network_id', $1, true)", [networkA]);
    await expect(
      client.query(
        `SELECT * FROM app.apply_inventory_movement($1, $2, 'receipt', 1.0001, $3, $4)`,
        [locationA, itemA, "d".repeat(64), "50000000-0000-0000-0000-000000000003"],
      ),
    ).rejects.toThrow(/three decimal places/);
    await client.query("ROLLBACK");
  });

  it("serializes concurrent write offs so stock cannot become negative", async () => {
    const concurrentItem = "30000000-0000-0000-0000-000000000003";
    const concurrentBalance = "40000000-0000-0000-0000-000000000003";
    await client.query(
      `INSERT INTO app.inventory_items (id, network_id, name, unit)
       VALUES ($1, $2, 'Concurrent beans', 'kg')`,
      [concurrentItem, networkA],
    );
    await client.query(
      `INSERT INTO app.inventory_balances
        (id, network_id, location_id, inventory_item_id, on_hand, min_threshold)
       VALUES ($1, $2, $3, $4, 5.000, 1.000)`,
      [concurrentBalance, networkA, locationA, concurrentItem],
    );
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect()]);
    const apply = async (connection: Client, key: string) => {
      await connection.query("BEGIN");
      try {
        await connection.query("SET LOCAL ROLE brew_runtime");
        await connection.query("SELECT set_config('app.network_id', $1, true)", [networkA]);
        await connection.query(
          `SELECT * FROM app.apply_inventory_movement($1, $2, 'writeoff', 4.000, $3, $4)`,
          [locationA, concurrentItem, key.slice(0, 64), key.slice(64)],
        );
        await connection.query("COMMIT");
        return true;
      } catch {
        await connection.query("ROLLBACK");
        return false;
      }
    };
    try {
      const [firstResult, secondResult] = await Promise.all([
        apply(first, `${"e".repeat(64)}50000000-0000-0000-0000-000000000004`),
        apply(second, `${"f".repeat(64)}50000000-0000-0000-0000-000000000005`),
      ]);
      expect([firstResult, secondResult].sort()).toEqual([false, true]);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
    const after = await client.query<{ on_hand: string; movement_count: string }>(
      `SELECT b.on_hand::text AS on_hand,
              (SELECT count(*)::text FROM app.inventory_movements m WHERE m.inventory_item_id = $1) AS movement_count
         FROM app.inventory_balances b
        WHERE b.id = $2`,
      [concurrentItem, concurrentBalance],
    );
    expect(after.rows[0]).toEqual({ on_hand: "1.000", movement_count: "1" });
  });

  it("rejects invalid values and duplicate per-network records", async () => {
    await expect(
      client.query(
        `UPDATE app.inventory_balances
         SET on_hand = 1.0001
         WHERE id = $1`,
        [balanceA],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `INSERT INTO app.revenue_targets (id, network_id, month, amount)
         VALUES ('60000000-0000-0000-0000-000000000003', $1, '2026-09-01', 100.001)`,
        [networkA],
      ),
    ).rejects.toThrow();

    await client.query(`UPDATE app.inventory_items SET unit = 'pcs' WHERE id = $1`, [itemA]);
    await expect(
      client.query(
        `UPDATE app.inventory_balances
         SET min_threshold = 0.500
         WHERE id = $1`,
        [balanceA],
      ),
    ).rejects.toThrow(/piece quantities must be whole numbers/);

    await expect(
      client.query(
        `INSERT INTO app.inventory_balances
          (id, network_id, location_id, inventory_item_id, on_hand, min_threshold)
         VALUES ('40000000-0000-0000-0000-000000000003', $1, $2, $3, -1.000, 0.000)`,
        [networkA, locationA, itemA],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `INSERT INTO app.inventory_balances
          (id, network_id, location_id, inventory_item_id, on_hand, min_threshold)
         VALUES ('40000000-0000-0000-0000-000000000004', $1, $2, $3, 1.000, 0.000)`,
        [networkA, locationA, itemA],
      ),
    ).rejects.toThrow();

    await client.query(
      `INSERT INTO app.revenue_targets (id, network_id, month, amount)
       VALUES ($1, $2, '2026-08-01', 100.00)`,
      [targetA, networkA],
    );
    await expect(
      client.query(
        `INSERT INTO app.revenue_targets (id, network_id, month, amount)
         VALUES ('60000000-0000-0000-0000-000000000002', $1, '2026-08-01', 120.00)`,
        [networkA],
      ),
    ).rejects.toThrow();

    await client.query(
      `INSERT INTO app.feedback_responses
        (id, network_id, rating, comment, desired_features)
       VALUES ($1, $2, 5, '', 'POS')`,
      [feedbackA, networkA],
    );
    await expect(
      client.query(
        `INSERT INTO app.feedback_responses
          (id, network_id, rating, comment, desired_features)
         VALUES ('70000000-0000-0000-0000-000000000002', $1, 4, '', 'Reports')`,
        [networkA],
      ),
    ).rejects.toThrow();

    await client.query(
      `INSERT INTO app.demo_generations (id, network_id, generated_for_date, seed, version)
       VALUES ($1, $2, '2026-08-23', 1, 'v1')`,
      [generationA, networkA],
    );
    await expect(
      client.query(
        `INSERT INTO app.demo_generations (id, network_id, generated_for_date, seed, version)
         VALUES ('80000000-0000-0000-0000-000000000002', $1, '2026-08-23', 2, 'v1')`,
        [networkA],
      ),
    ).rejects.toThrow();
  });
});
