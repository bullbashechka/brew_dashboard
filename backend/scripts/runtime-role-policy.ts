import type { Client } from "pg";

import {
  APP_RUNTIME_COLUMN_GRANTS,
  APP_RUNTIME_FUNCTIONS,
  APP_RUNTIME_ROLE,
  APP_RUNTIME_TABLE_GRANTS,
  AUTH_RUNTIME_ROLE,
  AUTH_RUNTIME_TABLE_GRANTS,
  LEGACY_RUNTIME_ROLE,
  TENANT_TABLES,
} from "../src/db/runtime-role-manifest.ts";

const createRole = async (client: Client, role: string) => {
  const exists = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
    [role],
  );
  if (!exists.rows[0]?.exists) {
    const statement = await client.query<{ sql: string }>(
      "SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', $1::text) AS sql",
      [role],
    );
    await client.query(statement.rows[0]!.sql);
  }
};

const grantTables = async (
  client: Client,
  role: string,
  grants: ReadonlyArray<readonly [string, string]>,
) => {
  for (const [table, privileges] of grants) {
    const statement = await client.query<{ sql: string }>(
      "SELECT format('GRANT %s ON TABLE %s TO %I', $1::text, $2::text, $3::text) AS sql",
      [privileges, table, role],
    );
    await client.query(statement.rows[0]!.sql);
  }
};

const grantColumns = async (
  client: Client,
  role: string,
  grants: ReadonlyArray<readonly [string, readonly string[]]>,
) => {
  for (const [table, columns] of grants) {
    const statement = await client.query<{ sql: string }>(
      "SELECT format('GRANT UPDATE (%s) ON TABLE %s TO %I', array_to_string(ARRAY(SELECT format('%I', column_name) FROM unnest($2::text[]) AS column_name), ', '), $1::text, $3::text) AS sql",
      [table, columns, role],
    );
    await client.query(statement.rows[0]!.sql);
  }
};

const validateExactTablePrivileges = async (
  client: Client,
  role: string,
  grants: ReadonlyArray<readonly [string, string]>,
) => {
  const result = await client.query<{ valid: boolean }>(
    `WITH expected AS (
       SELECT table_name, trim(privilege) AS privilege
       FROM jsonb_to_recordset($2::jsonb) AS item(table_name text, privileges text),
         LATERAL regexp_split_to_table(item.privileges, ',') AS privilege
     ), protected_relations AS (
       SELECT namespace.nspname || '.' || relation.relname AS table_name, relation.oid
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname IN ('app', 'auth') AND relation.relkind IN ('r', 'p', 'v', 'm')
     ), privileges(privilege) AS (
       VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
         ('REFERENCES'), ('TRIGGER')
     )
     SELECT NOT EXISTS (
       SELECT 1 FROM protected_relations relation CROSS JOIN privileges candidate
       WHERE has_table_privilege($1, relation.oid, candidate.privilege)
         <> EXISTS (
           SELECT 1 FROM expected
           WHERE expected.table_name = relation.table_name
             AND expected.privilege = candidate.privilege
         )
     ) AS valid`,
    [role, JSON.stringify(grants.map(([table_name, privileges]) => ({ table_name, privileges })))],
  );
  if (!result.rows[0]?.valid) throw new Error(`${role} table privileges differ from the manifest`);
};

const validateExactColumnPrivileges = async (
  client: Client,
  role: string,
  grants: ReadonlyArray<readonly [string, readonly string[]]>,
) => {
  const result = await client.query<{ valid: boolean }>(
    `WITH expected AS (
       SELECT item.table_name, column_name
       FROM jsonb_to_recordset($2::jsonb) AS item(table_name text, columns jsonb),
         LATERAL jsonb_array_elements_text(item.columns) AS column_name
     )
     SELECT NOT EXISTS (
       SELECT 1
       FROM information_schema.columns definition
       JOIN pg_class relation ON relation.relname = definition.table_name
       JOIN pg_namespace namespace
         ON namespace.oid = relation.relnamespace AND namespace.nspname = definition.table_schema
       WHERE EXISTS (
         SELECT 1 FROM expected
         WHERE expected.table_name = definition.table_schema || '.' || definition.table_name
       )
         AND has_column_privilege($1, relation.oid, definition.column_name, 'UPDATE')
           <> EXISTS (
             SELECT 1 FROM expected
             WHERE expected.table_name = definition.table_schema || '.' || definition.table_name
               AND expected.column_name = definition.column_name
           )
     ) AS valid`,
    [role, JSON.stringify(grants.map(([table_name, columns]) => ({ table_name, columns })))],
  );
  if (!result.rows[0]?.valid) throw new Error(`${role} column privileges differ from the manifest`);
};

export const validateRuntimeRolePolicy = async (
  client: Client,
  options: { expectLegacyRevoked?: boolean } = {},
) => {
  const roles = await client.query<{
    rolname: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
  }>(
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin
     FROM pg_roles WHERE rolname IN ($1, $2) ORDER BY rolname`,
    [AUTH_RUNTIME_ROLE, APP_RUNTIME_ROLE],
  );
  if (
    roles.rowCount !== 2 ||
    roles.rows.some(
      (role) =>
        role.rolsuper ||
        role.rolcreatedb ||
        role.rolcreaterole ||
        role.rolreplication ||
        role.rolbypassrls ||
        role.rolcanlogin,
    )
  ) {
    throw new Error("Runtime roles are missing or retain elevated attributes");
  }

  for (const [role, schema, deniedSchema, grants] of [
    [AUTH_RUNTIME_ROLE, "auth", "app", AUTH_RUNTIME_TABLE_GRANTS],
    [APP_RUNTIME_ROLE, "app", "auth", APP_RUNTIME_TABLE_GRANTS],
  ] as const) {
    const schemaAccess = await client.query<{ allowed: boolean; denied: boolean }>(
      "SELECT has_schema_privilege($1, $2, 'USAGE') AS allowed, has_schema_privilege($1, $3, 'USAGE') AS denied",
      [role, schema, deniedSchema],
    );
    if (!schemaAccess.rows[0]?.allowed || schemaAccess.rows[0]?.denied) {
      throw new Error(`${role} schema privileges are invalid`);
    }
    await validateExactTablePrivileges(client, role, grants);
  }
  await validateExactColumnPrivileges(client, APP_RUNTIME_ROLE, APP_RUNTIME_COLUMN_GRANTS);
  await validateExactColumnPrivileges(client, AUTH_RUNTIME_ROLE, []);

  const sequencePrivileges = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       CROSS JOIN unnest($1::text[]) AS role(role_name)
       WHERE namespace.nspname IN ('app', 'auth') AND relation.relkind = 'S'
         AND (has_sequence_privilege(role.role_name, relation.oid, 'SELECT')
           OR has_sequence_privilege(role.role_name, relation.oid, 'UPDATE')
           OR has_sequence_privilege(role.role_name, relation.oid, 'USAGE'))
     ) AS exists`,
    [[AUTH_RUNTIME_ROLE, APP_RUNTIME_ROLE]],
  );
  if (sequencePrivileges.rows[0]?.exists) {
    throw new Error("Runtime roles retain sequence privileges");
  }

  const functionPrivileges = await client.query<{ valid: boolean }>(
    `WITH expected(signature) AS (SELECT unnest($2::text[]))
     SELECT NOT EXISTS (
       SELECT 1 FROM pg_proc function
       JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname IN ('app', 'auth')
         AND has_function_privilege($1, function.oid, 'EXECUTE')
           <> EXISTS (
             SELECT 1 FROM expected WHERE to_regprocedure(expected.signature) = function.oid
           )
     ) AS valid`,
    [APP_RUNTIME_ROLE, APP_RUNTIME_FUNCTIONS],
  );
  const authFunctionPrivileges = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc function
       JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname IN ('app', 'auth')
         AND has_function_privilege($1, function.oid, 'EXECUTE')
     ) AS exists`,
    [AUTH_RUNTIME_ROLE],
  );
  if (!functionPrivileges.rows[0]?.valid || authFunctionPrivileges.rows[0]?.exists) {
    throw new Error("Runtime function privileges differ from the manifest");
  }

  const memberships = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles parent ON parent.oid = membership.roleid
       WHERE member.rolname IN ($1, $2) OR parent.rolname IN ($1, $2)
     ) AS exists`,
    [AUTH_RUNTIME_ROLE, APP_RUNTIME_ROLE],
  );
  if (memberships.rows[0]?.exists) throw new Error("Runtime roles retain role memberships");

  const defaultPrivilegeDrift = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_default_acl defaults
       JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace,
         LATERAL aclexplode(defaults.defaclacl) privilege
       LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
       WHERE namespace.nspname IN ('app', 'auth')
         AND (
           grantee.rolname IN ($1, $2)
           OR (privilege.grantee = 0 AND defaults.defaclobjtype = 'f')
         )
     ) AS exists`,
    [AUTH_RUNTIME_ROLE, APP_RUNTIME_ROLE],
  );
  if (defaultPrivilegeDrift.rows[0]?.exists) {
    throw new Error("Runtime or PUBLIC default privileges are unsafe");
  }

  const tenantRls = await client.query<{ valid: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM unnest($1::text[]) AS expected(table_name)
       LEFT JOIN pg_class relation
         ON relation.relname = expected.table_name
        AND relation.relnamespace = 'app'::regnamespace
       WHERE relation.oid IS NULL OR NOT relation.relrowsecurity
     ) AS valid`,
    [TENANT_TABLES],
  );
  const appUsersPolicy = await client.query<{ valid: boolean }>(
    `SELECT COUNT(*) = 1
       AND bool_and(policyname = 'app_users_auth_user_isolation' AND permissive = 'PERMISSIVE'
         AND cmd = 'ALL' AND roles = ARRAY['public']::name[]
         AND qual LIKE '%current_setting(''app.auth_user_id''%'
         AND with_check LIKE '%current_setting(''app.auth_user_id''%'
         AND qual LIKE '%current_setting(''app.network_id''%'
         AND with_check LIKE '%current_setting(''app.network_id''%') AS valid
     FROM pg_policies WHERE schemaname = 'app' AND tablename = 'app_users'`,
  );
  const tenantPolicies = await client.query<{ valid: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM unnest($1::text[]) AS expected(table_name)
       WHERE 1 <> (
         SELECT COUNT(*) FROM pg_policies policy
         WHERE policy.schemaname = 'app' AND policy.tablename = expected.table_name
       ) OR NOT EXISTS (
         SELECT 1 FROM pg_policies policy
         WHERE policy.schemaname = 'app' AND policy.tablename = expected.table_name
           AND policy.policyname = expected.table_name || '_tenant_isolation'
           AND policy.permissive = 'PERMISSIVE' AND policy.cmd = 'ALL'
           AND policy.roles = ARRAY['public']::name[]
           AND policy.qual LIKE '%current_setting(''app.network_id''%'
           AND policy.with_check LIKE '%current_setting(''app.network_id''%'
       )
     ) AS valid`,
    [TENANT_TABLES],
  );
  if (
    !tenantRls.rows[0]?.valid ||
    !appUsersPolicy.rows[0]?.valid ||
    !tenantPolicies.rows[0]?.valid
  ) {
    throw new Error("Required tenant RLS policies are missing");
  }

  if (options.expectLegacyRevoked === false) {
    const activeLegacy = await client.query<{ valid: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_roles role
         WHERE role.rolname = $1 AND role.rolcanlogin
           AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
           AND NOT role.rolreplication AND NOT role.rolbypassrls
           AND has_schema_privilege($1, 'app', 'USAGE')
           AND has_schema_privilege($1, 'auth', 'USAGE')
       ) AND NOT EXISTS (
         SELECT 1 FROM pg_auth_members membership
         JOIN pg_roles member ON member.oid = membership.member
         JOIN pg_roles parent ON parent.oid = membership.roleid
         WHERE member.rolname = $1 OR parent.rolname = $1
       ) AS valid`,
      [LEGACY_RUNTIME_ROLE],
    );
    if (!activeLegacy.rows[0]?.valid) throw new Error("Legacy runtime role is not safely active");
    return;
  }

  const legacy = await client.query<{ safe: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM pg_roles role
       WHERE role.rolname = $1 AND (
         role.rolcanlogin OR role.rolsuper OR role.rolcreatedb OR role.rolcreaterole
         OR role.rolreplication OR role.rolbypassrls
         OR has_schema_privilege($1, 'app', 'USAGE')
         OR has_schema_privilege($1, 'auth', 'USAGE')
         OR EXISTS (
           SELECT 1 FROM pg_class relation
           JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
           CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS candidate(privilege)
           WHERE namespace.nspname IN ('app', 'auth')
             AND relation.relkind IN ('r', 'p', 'v', 'm')
             AND has_table_privilege($1, relation.oid, candidate.privilege)
         )
         OR EXISTS (
           SELECT 1 FROM pg_class relation
           JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
           CROSS JOIN unnest(ARRAY['SELECT','UPDATE','USAGE']) AS candidate(privilege)
           WHERE namespace.nspname IN ('app', 'auth') AND relation.relkind = 'S'
             AND has_sequence_privilege($1, relation.oid, candidate.privilege)
         )
         OR EXISTS (
           SELECT 1 FROM pg_proc function
           JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
           WHERE namespace.nspname IN ('app', 'auth')
             AND has_function_privilege($1, function.oid, 'EXECUTE')
         )
         OR EXISTS (
           SELECT 1 FROM pg_auth_members membership
           JOIN pg_roles member ON member.oid = membership.member
           JOIN pg_roles parent ON parent.oid = membership.roleid
           WHERE member.rolname = $1 OR parent.rolname = $1
         )
       )
     ) AS safe`,
    [LEGACY_RUNTIME_ROLE],
  );
  if (!legacy.rows[0]?.safe) throw new Error("Legacy runtime role is not fully revoked");
};

export const bootstrapRuntimeRoles = async (
  client: Client,
  options: { revokeLegacy?: boolean } = {},
) => {
  await client.query("BEGIN");
  try {
    await createRole(client, AUTH_RUNTIME_ROLE);
    await createRole(client, APP_RUNTIME_ROLE);
    for (const role of [AUTH_RUNTIME_ROLE, APP_RUNTIME_ROLE]) {
      const harden = await client.query<{ sql: string }>(
        "SELECT format('ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN', $1::text) AS sql",
        [role],
      );
      await client.query(harden.rows[0]!.sql);
      const jit = await client.query<{ sql: string }>(
        "SELECT format('ALTER ROLE %I SET jit = off', $1::text) AS sql",
        [role],
      );
      await client.query(jit.rows[0]!.sql);
    }

    await client.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA app, auth FROM PUBLIC, ${AUTH_RUNTIME_ROLE}, ${APP_RUNTIME_ROLE}`,
    );
    await client.query(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, auth FROM PUBLIC, ${AUTH_RUNTIME_ROLE}, ${APP_RUNTIME_ROLE}`,
    );
    await client.query(
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, auth FROM PUBLIC, ${AUTH_RUNTIME_ROLE}, ${APP_RUNTIME_ROLE}`,
    );
    await client.query(
      `REVOKE ALL ON SCHEMA app, auth FROM PUBLIC, ${AUTH_RUNTIME_ROLE}, ${APP_RUNTIME_ROLE}`,
    );
    await client.query(`GRANT USAGE ON SCHEMA auth TO ${AUTH_RUNTIME_ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA app TO ${APP_RUNTIME_ROLE}`);
    await grantTables(client, AUTH_RUNTIME_ROLE, AUTH_RUNTIME_TABLE_GRANTS);
    await grantTables(client, APP_RUNTIME_ROLE, APP_RUNTIME_TABLE_GRANTS);
    await grantColumns(client, APP_RUNTIME_ROLE, APP_RUNTIME_COLUMN_GRANTS);
    for (const signature of APP_RUNTIME_FUNCTIONS) {
      await client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO ${APP_RUNTIME_ROLE}`);
    }
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE ALL ON TABLES FROM ${AUTH_RUNTIME_ROLE}, ${APP_RUNTIME_ROLE}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE ALL ON SEQUENCES FROM ${AUTH_RUNTIME_ROLE}, ${APP_RUNTIME_ROLE}`,
    );
    await client.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
    );

    // Remove inheritance in either direction. It is insufficient to only inspect what the
    // runtime role inherits: a forgotten role inheriting a runtime role is equally privileged.
    const memberships = await client.query<{ sql: string }>(
      `SELECT format('REVOKE %I FROM %I', parent.rolname, member.rolname) AS sql
       FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles parent ON parent.oid = membership.roleid
       WHERE member.rolname IN ($1, $2, $3) OR parent.rolname IN ($1, $2, $3)`,
      [AUTH_RUNTIME_ROLE, APP_RUNTIME_ROLE, LEGACY_RUNTIME_ROLE],
    );
    for (const membership of memberships.rows) await client.query(membership.sql);

    if (options.revokeLegacy !== false) {
      const legacy = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
        [LEGACY_RUNTIME_ROLE],
      );
      if (legacy.rows[0]?.exists) {
        await client.query(
          `ALTER ROLE ${LEGACY_RUNTIME_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
        );
        await client.query(
          `REVOKE ALL ON ALL TABLES IN SCHEMA app, auth FROM ${LEGACY_RUNTIME_ROLE}`,
        );
        await client.query(
          `REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, auth FROM ${LEGACY_RUNTIME_ROLE}`,
        );
        await client.query(
          `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, auth FROM ${LEGACY_RUNTIME_ROLE}`,
        );
        await client.query(`REVOKE ALL ON SCHEMA app, auth FROM ${LEGACY_RUNTIME_ROLE}`);
      }
    }
    await validateRuntimeRolePolicy(client, {
      expectLegacyRevoked: options.revokeLegacy !== false,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
};
