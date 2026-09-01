import { Client } from "pg";
import {
  APP_RUNTIME_COLUMN_GRANTS,
  APP_RUNTIME_FUNCTIONS,
  APP_RUNTIME_TABLE_GRANTS,
  AUTH_RUNTIME_TABLE_GRANTS,
  TENANT_TABLES,
} from "../src/db/runtime-role-manifest.ts";

const smokePath = "/__hyperdrive_smoke";
const smokeTokenHeader = "x-brew-smoke-token";

export type HyperdriveSmokeEnv = {
  AUTH_HYPERDRIVE: Hyperdrive;
  APP_HYPERDRIVE: Hyperdrive;
  HYPERDRIVE_SMOKE_TOKEN: string;
  EXPECTED_LEGACY_REVOKED: "0" | "1";
};

export type HyperdriveSmokePayload = {
  ok: boolean;
  queryOk: boolean;
  authRuntimeRole: boolean;
  authRuntimeRoleSafe: boolean;
  authRuntimeGrantsValid: boolean;
  runtimeRole: boolean;
  runtimeRoleSafe: boolean;
  runtimeGrantsValid: boolean;
  tenantContextUnset: boolean;
  tenantRowsHidden: boolean;
  tenantTablesRlsEnabled: boolean;
  appUsersRlsEnabled: boolean;
  appUsersPolicyPresent: boolean;
  runtimeOwnsNoTenantTables: boolean;
  tenantPoliciesPresent: boolean;
  baselineFunctionsGranted: boolean;
  migrationHeadApplied: boolean;
  legacyRuntimeRevoked: boolean;
  legacyRuntimeActive: boolean;
};

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

const clientFor = (connectionString: string) =>
  new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });

const probeAuth = async (client: Client) => {
  const result = await client.query<{
    query_ok: boolean;
    runtime_role: boolean;
    role_safe: boolean;
    grants_valid: boolean;
  }>(
    `
      WITH expected_grants AS (
        SELECT table_name, trim(privilege) AS privilege
        FROM jsonb_to_recordset($1::jsonb) AS expected(table_name text, privileges text),
          LATERAL regexp_split_to_table(expected.privileges, ',') AS privilege
      ),
      protected_relations AS (
        SELECT namespace.nspname || '.' || relation.relname AS table_name, relation.oid
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('app', 'auth') AND relation.relkind IN ('r', 'p', 'v', 'm')
      ),
      table_privileges(privilege) AS (
        VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
          ('REFERENCES'), ('TRIGGER')
      )
      SELECT
        (SELECT 1) = 1 AS query_ok,
        current_user = 'brew_auth_runtime' AS runtime_role,
        EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = current_user
            AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
            AND NOT rolcreaterole AND NOT rolreplication AND rolcanlogin
        ) AS role_safe,
        has_schema_privilege(current_user, 'auth', 'USAGE')
          AND NOT has_schema_privilege(current_user, 'app', 'USAGE')
          AND NOT EXISTS (
            SELECT 1 FROM protected_relations AS relation
            CROSS JOIN table_privileges AS candidate
            WHERE has_table_privilege(current_user, relation.oid, candidate.privilege)
              <> EXISTS (
                SELECT 1 FROM expected_grants AS expected
                WHERE expected.table_name = relation.table_name
                  AND expected.privilege = candidate.privilege
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_class AS relation
            JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname IN ('app', 'auth') AND relation.relkind = 'S'
              AND (has_sequence_privilege(current_user, relation.oid, 'SELECT')
                OR has_sequence_privilege(current_user, relation.oid, 'UPDATE')
                OR has_sequence_privilege(current_user, relation.oid, 'USAGE'))
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_proc AS function
            JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
            WHERE namespace.nspname IN ('app', 'auth')
              AND has_function_privilege(current_user, function.oid, 'EXECUTE')
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_auth_members AS membership
            JOIN pg_roles AS member ON member.oid = membership.member
            JOIN pg_roles AS parent ON parent.oid = membership.roleid
            WHERE member.rolname = current_user OR parent.rolname = current_user
          )
          AND to_regclass('auth.two_factor') IS NOT NULL AS grants_valid
    `,
    [
      JSON.stringify(
        AUTH_RUNTIME_TABLE_GRANTS.map(([table_name, privileges]) => ({ table_name, privileges })),
      ),
    ],
  );
  return result.rows[0];
};

const probeApp = async (client: Client) => {
  const probe = await client.query<{ query_ok: boolean }>("SELECT 1 = 1 AS query_ok");
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
    app_users_rls_enabled: boolean;
    app_users_policy_present: boolean;
    baseline_functions_granted: boolean;
    tenant_tables_rls_enabled: boolean;
    runtime_owns_no_tenant_tables: boolean;
    tenant_policies_present: boolean;
    migration_head_applied: boolean;
    legacy_runtime_revoked: boolean;
    legacy_runtime_active: boolean;
  }>(
    `
      WITH tenant_tables(table_name) AS (SELECT unnest($1::text[])),
      expected_table_privileges(table_name, privilege) AS (
        SELECT table_name, trim(privilege)
        FROM jsonb_to_recordset($2::jsonb) AS expected(table_name text, privileges text),
          LATERAL regexp_split_to_table(expected.privileges, ',') AS privilege
      ),
      protected_relations AS (
        SELECT namespace.nspname || '.' || relation.relname AS table_name, relation.oid
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('app', 'auth') AND relation.relkind IN ('r', 'p', 'v', 'm')
      ),
      table_privileges(privilege) AS (
        VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
          ('REFERENCES'), ('TRIGGER')
      ),
      expected_functions(signature) AS (
        SELECT value FROM jsonb_array_elements_text($3::jsonb)
      ),
      expected_column_updates(table_name, column_name) AS (
        SELECT item.table_name, column_name
        FROM jsonb_to_recordset($4::jsonb) AS item(table_name text, columns jsonb),
          LATERAL jsonb_array_elements_text(item.columns) AS column_name
      )
      SELECT
        EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = current_user
            AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
            AND NOT rolcreaterole AND NOT rolreplication AND rolcanlogin
        ) AS runtime_role_safe,
        current_user = 'brew_app_runtime'
          AND has_schema_privilege(current_user, 'app', 'USAGE')
          AND NOT has_schema_privilege(current_user, 'auth', 'USAGE')
          AND NOT EXISTS (
            SELECT 1 FROM protected_relations AS relation
            CROSS JOIN table_privileges AS candidate
            WHERE has_table_privilege(current_user, relation.oid, candidate.privilege)
              <> EXISTS (
                SELECT 1 FROM expected_table_privileges AS expected
                WHERE expected.table_name = relation.table_name
                  AND expected.privilege = candidate.privilege
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns definition
            JOIN pg_class relation ON relation.relname = definition.table_name
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
              AND namespace.nspname = definition.table_schema
            WHERE EXISTS (
              SELECT 1 FROM expected_column_updates expected
              WHERE expected.table_name = definition.table_schema || '.' || definition.table_name
            )
              AND has_column_privilege(current_user, relation.oid, definition.column_name, 'UPDATE')
                <> EXISTS (
                  SELECT 1 FROM expected_column_updates expected
                  WHERE expected.table_name = definition.table_schema || '.' || definition.table_name
                    AND expected.column_name = definition.column_name
                )
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_class AS relation
            JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname IN ('app', 'auth')
              AND relation.relkind = 'S'
              AND (
                has_sequence_privilege(current_user, relation.oid, 'SELECT')
                OR has_sequence_privilege(current_user, relation.oid, 'UPDATE')
                OR has_sequence_privilege(current_user, relation.oid, 'USAGE')
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_auth_members AS membership
            JOIN pg_roles AS member ON member.oid = membership.member
            JOIN pg_roles AS parent ON parent.oid = membership.roleid
            WHERE member.rolname = current_user OR parent.rolname = current_user
          ) AS runtime_grants_valid,
        NOT EXISTS (
          SELECT 1 FROM pg_proc AS function
          JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
          WHERE namespace.nspname IN ('app', 'auth')
            AND has_function_privilege(current_user, function.oid, 'EXECUTE')
              <> EXISTS (
                SELECT 1 FROM expected_functions AS expected
                WHERE to_regprocedure(expected.signature) = function.oid
              )
        ) AS baseline_functions_granted,
        EXISTS (
          SELECT 1 FROM pg_class AS relation
          WHERE relation.oid = 'app.app_users'::regclass AND relation.relrowsecurity
        ) AS app_users_rls_enabled,
        (SELECT COUNT(*) = 1 AND bool_and(policyname = 'app_users_auth_user_isolation'
          AND permissive = 'PERMISSIVE' AND cmd = 'ALL' AND roles = ARRAY['public']::name[]
          AND qual LIKE '%current_setting(''app.auth_user_id''%'
          AND with_check LIKE '%current_setting(''app.auth_user_id''%'
          AND qual LIKE '%current_setting(''app.network_id''%'
          AND with_check LIKE '%current_setting(''app.network_id''%')
         FROM pg_policies WHERE schemaname = 'app' AND tablename = 'app_users') AS app_users_policy_present,
        NOT EXISTS (
          SELECT 1 FROM tenant_tables AS tenant
          LEFT JOIN pg_class AS relation
            ON relation.relname = tenant.table_name
           AND relation.relnamespace = 'app'::regnamespace
          WHERE relation.oid IS NULL OR NOT relation.relrowsecurity
        ) AS tenant_tables_rls_enabled,
        NOT EXISTS (
          SELECT 1 FROM tenant_tables AS tenant
          JOIN pg_class AS relation
            ON relation.relname = tenant.table_name
           AND relation.relnamespace = 'app'::regnamespace
          JOIN pg_roles AS role ON role.oid = relation.relowner
          WHERE role.rolname = current_user
        ) AS runtime_owns_no_tenant_tables,
        NOT EXISTS (
          SELECT 1 FROM tenant_tables AS tenant
          WHERE 1 <> (SELECT COUNT(*) FROM pg_policies AS policy
            WHERE policy.schemaname = 'app'
              AND policy.tablename = tenant.table_name)
            OR NOT EXISTS (SELECT 1 FROM pg_policies AS policy
            WHERE policy.schemaname = 'app'
              AND policy.tablename = tenant.table_name
              AND policy.policyname = tenant.table_name || '_tenant_isolation'
              AND policy.permissive = 'PERMISSIVE' AND policy.cmd = 'ALL'
              AND policy.roles = ARRAY['public']::name[]
              AND policy.qual LIKE '%current_setting(''app.network_id''%'
              AND policy.with_check LIKE '%current_setting(''app.network_id''%')
        ) AS tenant_policies_present,
        app.security_migration_head_applied()
          AND current_setting('jit') = 'off'
          AND NOT EXISTS (
            SELECT 1 FROM pg_namespace AS namespace,
              LATERAL aclexplode(namespace.nspacl) AS privilege
            WHERE namespace.nspname IN ('app', 'auth')
              AND privilege.grantee = 0 AND privilege.privilege_type = 'USAGE'
          ) AS migration_head_applied
        ,NOT EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = 'brew_runtime'
            AND (
              rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
              OR rolcanlogin
              OR has_schema_privilege('brew_runtime', 'app', 'USAGE')
              OR has_schema_privilege('brew_runtime', 'auth', 'USAGE')
              OR EXISTS (
                SELECT 1 FROM pg_class AS relation
                JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS candidate(privilege)
                WHERE namespace.nspname IN ('app', 'auth')
                  AND relation.relkind IN ('r', 'p', 'v', 'm')
                  AND has_table_privilege('brew_runtime', relation.oid, candidate.privilege)
              )
              OR EXISTS (
                SELECT 1 FROM pg_class AS relation
                JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                CROSS JOIN unnest(ARRAY['SELECT','UPDATE','USAGE']) AS candidate(privilege)
                WHERE namespace.nspname IN ('app', 'auth') AND relation.relkind = 'S'
                  AND has_sequence_privilege('brew_runtime', relation.oid, candidate.privilege)
              )
              OR EXISTS (
                SELECT 1 FROM pg_proc AS function
                JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
                WHERE namespace.nspname IN ('app', 'auth')
                  AND has_function_privilege('brew_runtime', function.oid, 'EXECUTE')
              )
              OR EXISTS (
                SELECT 1 FROM pg_auth_members AS membership
                JOIN pg_roles AS member ON member.oid = membership.member
                JOIN pg_roles AS parent ON parent.oid = membership.roleid
                WHERE member.rolname = 'brew_runtime' OR parent.rolname = 'brew_runtime'
              )
            )
        ) AS legacy_runtime_revoked
        ,EXISTS (
          SELECT 1 FROM pg_roles role
          WHERE role.rolname = 'brew_runtime' AND role.rolcanlogin
            AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
            AND NOT role.rolreplication AND NOT role.rolbypassrls
            AND has_schema_privilege('brew_runtime', 'app', 'USAGE')
            AND has_schema_privilege('brew_runtime', 'auth', 'USAGE')
        ) AND NOT EXISTS (
          SELECT 1 FROM pg_auth_members membership
          JOIN pg_roles member ON member.oid = membership.member
          JOIN pg_roles parent ON parent.oid = membership.roleid
          WHERE member.rolname = 'brew_runtime' OR parent.rolname = 'brew_runtime'
        ) AS legacy_runtime_active
    `,
    [
      TENANT_TABLES,
      JSON.stringify(
        APP_RUNTIME_TABLE_GRANTS.map(([table_name, privileges]) => ({ table_name, privileges })),
      ),
      JSON.stringify(APP_RUNTIME_FUNCTIONS),
      JSON.stringify(
        APP_RUNTIME_COLUMN_GRANTS.map(([table_name, columns]) => ({ table_name, columns })),
      ),
    ],
  );
  return {
    probe: probe.rows[0],
    identity: identity.rows[0],
    tenantRows: tenantRows.rows[0],
    catalog: catalog.rows[0],
  };
};

const handler = async (request: Request, env: HyperdriveSmokeEnv): Promise<Response> => {
  if (!isSmokeRequest(request)) return json({ ok: false }, 404);
  if (!isAuthorized(request, env)) return json({ ok: false }, 401);

  const authClient = clientFor(env.AUTH_HYPERDRIVE.connectionString);
  const appClient = clientFor(env.APP_HYPERDRIVE.connectionString);
  try {
    await Promise.all([authClient.connect(), appClient.connect()]);
    const [auth, app] = await Promise.all([probeAuth(authClient), probeApp(appClient)]);
    const queryOk = auth?.query_ok === true && app.probe?.query_ok === true;
    const authRuntimeRole = auth?.runtime_role === true;
    const authRuntimeRoleSafe = auth?.role_safe === true;
    const authRuntimeGrantsValid = auth?.grants_valid === true;
    const runtimeRole = app.identity?.current_user === "brew_app_runtime";
    const runtimeRoleSafe = app.catalog?.runtime_role_safe === true;
    const runtimeGrantsValid = app.catalog?.runtime_grants_valid === true;
    const tenantContextUnset = (app.identity?.network_id ?? null) === null;
    const tenantRowsHidden = app.tenantRows?.has_rows === false;
    const tenantTablesRlsEnabled = app.catalog?.tenant_tables_rls_enabled === true;
    const appUsersRlsEnabled = app.catalog?.app_users_rls_enabled === true;
    const appUsersPolicyPresent = app.catalog?.app_users_policy_present === true;
    const runtimeOwnsNoTenantTables = app.catalog?.runtime_owns_no_tenant_tables === true;
    const tenantPoliciesPresent = app.catalog?.tenant_policies_present === true;
    const baselineFunctionsGranted = app.catalog?.baseline_functions_granted === true;
    const migrationHeadApplied = app.catalog?.migration_head_applied === true;
    const legacyRuntimeRevoked = app.catalog?.legacy_runtime_revoked === true;
    const legacyRuntimeActive = app.catalog?.legacy_runtime_active === true;
    const legacyStateValid =
      env.EXPECTED_LEGACY_REVOKED === "1"
        ? legacyRuntimeRevoked
        : env.EXPECTED_LEGACY_REVOKED === "0" && legacyRuntimeActive;
    const ok =
      queryOk &&
      authRuntimeRole &&
      authRuntimeRoleSafe &&
      authRuntimeGrantsValid &&
      runtimeRole &&
      runtimeRoleSafe &&
      runtimeGrantsValid &&
      tenantContextUnset &&
      tenantRowsHidden &&
      tenantTablesRlsEnabled &&
      appUsersRlsEnabled &&
      appUsersPolicyPresent &&
      runtimeOwnsNoTenantTables &&
      tenantPoliciesPresent &&
      baselineFunctionsGranted &&
      migrationHeadApplied &&
      legacyStateValid;
    return json(
      {
        ok,
        queryOk,
        authRuntimeRole,
        authRuntimeRoleSafe,
        authRuntimeGrantsValid,
        runtimeRole,
        runtimeRoleSafe,
        runtimeGrantsValid,
        tenantContextUnset,
        tenantRowsHidden,
        tenantTablesRlsEnabled,
        appUsersRlsEnabled,
        appUsersPolicyPresent,
        runtimeOwnsNoTenantTables,
        tenantPoliciesPresent,
        baselineFunctionsGranted,
        migrationHeadApplied,
        legacyRuntimeRevoked,
        legacyRuntimeActive,
      },
      ok ? 200 : 503,
    );
  } catch {
    return json({ ok: false }, 503);
  } finally {
    await Promise.all([
      authClient.end().catch(() => undefined),
      appClient.end().catch(() => undefined),
    ]);
  }
};

export default {
  fetch: handler,
} satisfies ExportedHandler<HyperdriveSmokeEnv>;
