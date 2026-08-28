import { Client } from "pg";

const smokePath = "/__hyperdrive_smoke";
const smokeTokenHeader = "x-brew-smoke-token";

export type HyperdriveSmokeEnv = {
  HYPERDRIVE: Hyperdrive;
  HYPERDRIVE_SMOKE_TOKEN: string;
};

export type HyperdriveSmokePayload = {
  ok: boolean;
  queryOk: boolean;
  runtimeRole: boolean;
  runtimeRoleSafe: boolean;
  runtimeGrantsValid: boolean;
  tenantContextUnset: boolean;
  tenantRowsHidden: boolean;
  tenantTablesRlsEnabled: boolean;
  runtimeOwnsNoTenantTables: boolean;
  tenantPoliciesPresent: boolean;
  migrationHeadApplied: boolean;
};

const tenantTables = [
  "categories",
  "demo_generations",
  "feedback_responses",
  "idempotency_keys",
  "inventory_balances",
  "inventory_items",
  "inventory_movements",
  "locations",
  "networks",
  "order_items",
  "orders",
  "product_events",
  "products",
  "revenue_targets",
] as const;

const json = (payload: Record<string, unknown>, status: number) =>
  Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });

const isSmokeRequest = (request: Request) => {
  const url = new URL(request.url);
  return request.method === "GET" && url.pathname === smokePath;
};

const isAuthorized = (request: Request, env: HyperdriveSmokeEnv) =>
  request.headers.get(smokeTokenHeader) === env.HYPERDRIVE_SMOKE_TOKEN;

const handler = async (request: Request, env: HyperdriveSmokeEnv): Promise<Response> => {
  if (!isSmokeRequest(request)) {
    return json({ ok: false }, 404);
  }

  if (!isAuthorized(request, env)) {
    return json({ ok: false }, 401);
  }

  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  let connected = false;

  try {
    await client.connect();
    connected = true;

    const probe = await client.query<{ ok: number }>("SELECT 1 AS ok");
    const identity = await client.query<{
      current_user: string;
      network_id: string | null;
    }>("SELECT current_user, NULLIF(current_setting('app.network_id', true), '') AS network_id");
    const tenantRows = await client.query<{ has_rows: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM app.locations) AS has_rows",
    );
    const catalog = await client.query<{
      runtime_role_safe: boolean;
      runtime_grants_valid: boolean;
      tenant_tables_rls_enabled: boolean;
      runtime_owns_no_tenant_tables: boolean;
      tenant_policies_present: boolean;
      migration_head_applied: boolean;
    }>(
      `
        WITH tenant_tables(table_name) AS (
          SELECT unnest($1::text[])
        ),
        required_table_privileges(schema_name, table_name, privileges) AS (
          VALUES
            ('auth', 'users', 'SELECT'),
            ('auth', 'accounts', 'SELECT'),
            ('auth', 'sessions', 'SELECT, INSERT, UPDATE, DELETE'),
            ('auth', 'rate_limits', 'SELECT, INSERT, UPDATE, DELETE'),
            ('app', 'app_users', 'SELECT, UPDATE'),
            ('app', 'networks', 'SELECT, UPDATE'),
            ('app', 'locations', 'SELECT, INSERT'),
            ('app', 'categories', 'SELECT, INSERT, DELETE'),
            ('app', 'orders', 'SELECT, INSERT, DELETE'),
            ('app', 'order_items', 'SELECT, INSERT, DELETE'),
            ('app', 'inventory_items', 'SELECT, INSERT, DELETE'),
            ('app', 'products', 'SELECT, INSERT, UPDATE, DELETE'),
            ('app', 'revenue_targets', 'SELECT, INSERT, UPDATE, DELETE'),
            ('app', 'idempotency_keys', 'SELECT, INSERT, UPDATE, DELETE'),
            ('app', 'feedback_responses', 'SELECT, INSERT, UPDATE'),
            ('app', 'demo_generations', 'SELECT, INSERT'),
            ('app', 'product_events', 'SELECT, INSERT'),
            ('app', 'inventory_balances', 'SELECT'),
            ('app', 'inventory_movements', 'SELECT')
        ),
        denied_table_privileges(schema_name, table_name, privilege) AS (
          VALUES
            ('auth', 'users', 'INSERT'), ('auth', 'users', 'UPDATE'), ('auth', 'users', 'DELETE'),
            ('auth', 'accounts', 'INSERT'), ('auth', 'accounts', 'UPDATE'), ('auth', 'accounts', 'DELETE'),
            ('auth', 'verifications', 'SELECT'), ('auth', 'verifications', 'INSERT'),
            ('auth', 'verifications', 'UPDATE'), ('auth', 'verifications', 'DELETE'),
            ('app', 'app_users', 'INSERT'), ('app', 'app_users', 'DELETE'),
            ('app', 'networks', 'INSERT'), ('app', 'networks', 'DELETE'),
            ('app', 'locations', 'UPDATE'), ('app', 'locations', 'DELETE'),
            ('app', 'categories', 'UPDATE'), ('app', 'orders', 'UPDATE'),
            ('app', 'order_items', 'UPDATE'), ('app', 'inventory_items', 'UPDATE'),
            ('app', 'feedback_responses', 'DELETE'),
            ('app', 'demo_generations', 'UPDATE'), ('app', 'demo_generations', 'DELETE'),
            ('app', 'product_events', 'UPDATE'), ('app', 'product_events', 'DELETE'),
            ('app', 'inventory_balances', 'INSERT'), ('app', 'inventory_balances', 'UPDATE'),
            ('app', 'inventory_balances', 'DELETE'), ('app', 'inventory_movements', 'INSERT'),
            ('app', 'inventory_movements', 'UPDATE'), ('app', 'inventory_movements', 'DELETE')
        )
        SELECT
          EXISTS (
            SELECT 1
            FROM pg_roles
            WHERE rolname = 'brew_runtime'
              AND NOT rolsuper
              AND NOT rolbypassrls
              AND NOT rolcreatedb
              AND NOT rolcreaterole
          ) AS runtime_role_safe,
          has_schema_privilege('brew_runtime', 'app', 'USAGE')
            AND has_schema_privilege('brew_runtime', 'auth', 'USAGE')
            AND has_function_privilege(
              'brew_runtime',
              'app.apply_inventory_movement(uuid,uuid,app.movement_type,numeric,character varying,uuid,timestamp with time zone)',
              'EXECUTE'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_auth_members AS membership
              JOIN pg_roles AS member ON member.oid = membership.member
              WHERE member.rolname = 'brew_runtime'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM required_table_privileges AS expected
              WHERE NOT has_table_privilege(
                'brew_runtime',
                format('%I.%I', expected.schema_name, expected.table_name),
                expected.privileges
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM denied_table_privileges AS denied
              WHERE has_table_privilege(
                'brew_runtime',
                format('%I.%I', denied.schema_name, denied.table_name),
                denied.privilege
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class AS relation
              JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname IN ('app', 'auth')
                AND relation.relkind IN ('r', 'p')
                AND (
                  has_table_privilege('brew_runtime', relation.oid, 'TRUNCATE')
                  OR has_table_privilege('brew_runtime', relation.oid, 'REFERENCES')
                  OR has_table_privilege('brew_runtime', relation.oid, 'TRIGGER')
                  OR has_table_privilege('public', relation.oid, 'INSERT, UPDATE, DELETE')
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class AS relation
              JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname IN ('app', 'auth')
                AND relation.relkind = 'S'
                AND (
                  has_table_privilege('brew_runtime', relation.oid, 'SELECT')
                  OR has_table_privilege('brew_runtime', relation.oid, 'UPDATE')
                  OR has_sequence_privilege('brew_runtime', relation.oid, 'USAGE')
                )
            ) AS runtime_grants_valid,
          NOT EXISTS (
            SELECT 1
            FROM tenant_tables AS tenant
            LEFT JOIN pg_class AS relation
              ON relation.relname = tenant.table_name
             AND relation.relnamespace = 'app'::regnamespace
            WHERE relation.oid IS NULL OR NOT relation.relrowsecurity
          ) AS tenant_tables_rls_enabled,
          NOT EXISTS (
            SELECT 1
            FROM tenant_tables AS tenant
            JOIN pg_class AS relation
              ON relation.relname = tenant.table_name
             AND relation.relnamespace = 'app'::regnamespace
            JOIN pg_roles AS role ON role.oid = relation.relowner
            WHERE role.rolname = 'brew_runtime'
          ) AS runtime_owns_no_tenant_tables,
          NOT EXISTS (
            SELECT 1
            FROM tenant_tables AS tenant
            WHERE NOT EXISTS (
              SELECT 1
              FROM pg_policies AS policy
              WHERE policy.schemaname = 'app'
                AND policy.tablename = tenant.table_name
                AND policy.policyname = tenant.table_name || '_tenant_isolation'
                AND policy.qual IS NOT NULL
                AND policy.with_check IS NOT NULL
            )
          ) AS tenant_policies_present,
          NOT has_table_privilege('brew_runtime', 'auth.verifications', 'SELECT')
            AS migration_head_applied
      `,
      [tenantTables],
    );

    const currentUser = identity.rows[0]?.current_user;
    const networkId = identity.rows[0]?.network_id ?? null;
    const hasTenantRows = tenantRows.rows[0]?.has_rows;
    const queryOk = probe.rows[0]?.ok === 1 && typeof hasTenantRows === "boolean";
    const runtimeRole = currentUser === "brew_runtime";
    const runtimeGrantsValid = catalog.rows[0]?.runtime_grants_valid === true;
    const tenantContextUnset = networkId === null;
    const tenantRowsHidden = hasTenantRows === false;
    const runtimeRoleSafe = catalog.rows[0]?.runtime_role_safe === true;
    const tenantTablesRlsEnabled = catalog.rows[0]?.tenant_tables_rls_enabled === true;
    const runtimeOwnsNoTenantTables = catalog.rows[0]?.runtime_owns_no_tenant_tables === true;
    const tenantPoliciesPresent = catalog.rows[0]?.tenant_policies_present === true;
    const migrationHeadApplied = catalog.rows[0]?.migration_head_applied === true;
    const ok =
      queryOk &&
      runtimeRole &&
      runtimeRoleSafe &&
      runtimeGrantsValid &&
      tenantContextUnset &&
      tenantRowsHidden &&
      tenantTablesRlsEnabled &&
      runtimeOwnsNoTenantTables &&
      tenantPoliciesPresent &&
      migrationHeadApplied;

    return json(
      {
        ok,
        queryOk,
        runtimeRole,
        runtimeRoleSafe,
        runtimeGrantsValid,
        tenantContextUnset,
        tenantRowsHidden,
        tenantTablesRlsEnabled,
        runtimeOwnsNoTenantTables,
        tenantPoliciesPresent,
        migrationHeadApplied,
      },
      ok ? 200 : 503,
    );
  } catch {
    return json({ ok: false }, 503);
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
};

export default {
  fetch: handler,
} satisfies ExportedHandler<HyperdriveSmokeEnv>;
