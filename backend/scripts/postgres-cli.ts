import { isLoopbackHostname } from "../src/security/hosts.ts";
import { createChildEnvironment } from "./child-environment.ts";
import { readFile } from "node:fs/promises";
import type { ClientConfig } from "pg";

const postgresProtocols = new Set(["postgres:", "postgresql:"]);

export const parsePostgresUrl = (value: string | undefined, label: string) => {
  if (!value) throw new Error(`${label} is required`);
  const url = new URL(value);
  if (!postgresProtocols.has(url.protocol)) throw new Error(`${label} must use PostgreSQL`);
  if (!url.hostname || url.pathname.length <= 1) {
    throw new Error(`${label} must include a host and database name`);
  }
  return url;
};

export const databaseNameFor = (url: URL) => decodeURIComponent(url.pathname.slice(1));

/** Transport hostname is not environment identity: Railway/SSH may expose production on loopback. */
export const isProductionDatabaseTarget = (url: URL, source: NodeJS.ProcessEnv = process.env) => {
  const declared = source.DATABASE_TARGET_ENVIRONMENT;
  if (declared !== undefined && declared !== "local" && declared !== "production") {
    throw new Error("DATABASE_TARGET_ENVIRONMENT must be local or production");
  }
  return (
    !isLoopbackHostname(url.hostname) ||
    declared === "production" ||
    Boolean(source.RAILWAY_ENVIRONMENT_ID || source.RAILWAY_PROJECT_ID)
  );
};

const queryEnvironmentNames = new Map([
  ["sslmode", "PGSSLMODE"],
  ["sslrootcert", "PGSSLROOTCERT"],
  ["sslcert", "PGSSLCERT"],
  ["sslkey", "PGSSLKEY"],
  ["sslcrl", "PGSSLCRL"],
  ["application_name", "PGAPPNAME"],
  ["connect_timeout", "PGCONNECT_TIMEOUT"],
  ["options", "PGOPTIONS"],
  ["target_session_attrs", "PGTARGETSESSIONATTRS"],
  ["channel_binding", "PGCHANNELBINDING"],
]);

/** Build a libpq environment without placing credentials in argv or weakening URL options. */
export const postgresChildEnvironment = (url: URL, source: NodeJS.ProcessEnv = process.env) => {
  const environment = createChildEnvironment(source);

  if (!isLoopbackHostname(url.hostname)) {
    if (url.searchParams.get("sslmode") !== "verify-full") {
      throw new Error("Remote PostgreSQL connections require sslmode=verify-full");
    }
    const rootCertificate = url.searchParams.get("sslrootcert") ?? source.PGSSLROOTCERT;
    if (!rootCertificate) {
      throw new Error("Remote PostgreSQL connections require sslrootcert or PGSSLROOTCERT");
    }
    if (!url.searchParams.has("sslrootcert")) environment.PGSSLROOTCERT = rootCertificate;
  }

  environment.PGHOST = decodeURIComponent(url.hostname);
  if (url.port) environment.PGPORT = url.port;
  if (url.username) environment.PGUSER = decodeURIComponent(url.username);
  if (url.password) environment.PGPASSWORD = decodeURIComponent(url.password);
  environment.PGDATABASE = databaseNameFor(url);
  for (const [name, value] of url.searchParams) {
    const environmentName = queryEnvironmentNames.get(name);
    if (!environmentName) throw new Error(`Unsupported PostgreSQL URL option: ${name}`);
    environment[environmentName] = value;
  }
  return environment;
};

/** Configure node-postgres with the same fail-closed remote TLS policy used by libpq tools. */
export const postgresClientConfiguration = async (
  url: URL,
  source: NodeJS.ProcessEnv = process.env,
): Promise<ClientConfig> => {
  // Reuse the child policy as the single validation point for remote TLS requirements.
  postgresChildEnvironment(url, source);
  if (isLoopbackHostname(url.hostname)) return { connectionString: url.toString() };

  const rootCertificate = url.searchParams.get("sslrootcert") ?? source.PGSSLROOTCERT;
  const connectionUrl = new URL(url);
  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslrootcert");
  return {
    connectionString: connectionUrl.toString(),
    ssl: {
      ca: await readFile(rootCertificate!, "utf8"),
      rejectUnauthorized: true,
    },
  };
};

export const __test = {
  parsePostgresUrl,
  databaseNameFor,
  postgresChildEnvironment,
  postgresClientConfiguration,
  isProductionDatabaseTarget,
};
