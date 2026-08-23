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
              FROM pg_class AS relation
              JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname IN ('app', 'auth')
                AND relation.relkind IN ('r', 'p')
                AND (
                  NOT has_table_privilege('brew_runtime', relation.oid, 'SELECT')
                  OR (
                    relation.relname NOT IN ('inventory_balances', 'inventory_movements')
                    AND NOT has_table_privilege('brew_runtime', relation.oid, 'INSERT, UPDATE, DELETE')
                  )
                  OR (
                    relation.relname IN ('inventory_balances', 'inventory_movements')
                    AND has_table_privilege('brew_runtime', relation.oid, 'INSERT, UPDATE, DELETE')
                  )
                  OR has_table_privilege('public', relation.oid, 'INSERT, UPDATE, DELETE')
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
              FROM pg_policy AS policy
              JOIN pg_class AS relation ON relation.oid = policy.polrelid
              WHERE relation.relnamespace = 'app'::regnamespace
                AND relation.relname = tenant.table_name
                AND policy.polname = tenant.table_name || '_tenant_isolation'
                AND policy.polcmd = '*'
                AND policy.polroles = ARRAY[0::oid]
                AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%app.network_id%'
                AND pg_get_expr(policy.polwithcheck, policy.polrelid) LIKE '%app.network_id%'
                AND pg_get_expr(policy.polqual, policy.polrelid) NOT LIKE '%true%'
                AND pg_get_expr(policy.polwithcheck, policy.polrelid) NOT LIKE '%true%'
            )
          ) AS tenant_policies_present,
          to_regprocedure('app.enforce_inventory_balance_unit()') IS NOT NULL
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
