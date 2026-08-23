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
  tenantContextUnset: boolean;
  tenantRowsHidden: boolean;
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

    const currentUser = identity.rows[0]?.current_user;
    const networkId = identity.rows[0]?.network_id ?? null;
    const hasTenantRows = tenantRows.rows[0]?.has_rows;
    const queryOk = probe.rows[0]?.ok === 1 && typeof hasTenantRows === "boolean";
    const runtimeRole = currentUser === "brew_runtime";
    const tenantContextUnset = networkId === null;
    const tenantRowsHidden = hasTenantRows === false;
    const ok = queryOk && runtimeRole && tenantContextUnset && tenantRowsHidden;

    return json(
      {
        ok,
        queryOk,
        runtimeRole,
        tenantContextUnset,
        tenantRowsHidden,
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
