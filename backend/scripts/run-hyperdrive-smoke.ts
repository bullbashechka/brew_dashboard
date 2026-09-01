import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChildEnvironment } from "./child-environment.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const webappDirectory = join(repositoryRoot, "webapp");
const rootWranglerConfigPath = join(repositoryRoot, "wrangler.jsonc");
const smokeEntrypointPath = join(repositoryRoot, "backend/scripts/hyperdrive-smoke-worker.ts");
const temporaryDirectory = join(repositoryRoot, ".scratch");
const smokeUrl = (port: number) => `http://127.0.0.1:${port}/__hyperdrive_smoke`;
const startupTimeoutMs = 30_000;
const requestTimeoutMs = 5_000;
const cleanupTimeoutMs = 5_000;

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

type RootWranglerConfig = {
  name?: unknown;
  compatibility_date?: unknown;
  compatibility_flags?: unknown;
  hyperdrive?: unknown;
};

type HyperdriveBinding = {
  binding: string;
  id: string;
};

const isRealHyperdriveId = (value: string) => /^[a-f0-9]{32}$/iu.test(value);

export type SmokeWranglerConfig = {
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: string[];
  hyperdrive: [HyperdriveBinding, HyperdriveBinding];
};

export const isValidSmokePayload = (
  payload: unknown,
  expectedLegacyRevoked = true,
): payload is HyperdriveSmokePayload => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<HyperdriveSmokePayload>;
  const keys = Object.keys(candidate).sort().join(",");
  return (
    keys ===
      "appUsersPolicyPresent,appUsersRlsEnabled,authRuntimeGrantsValid,authRuntimeRole,authRuntimeRoleSafe,baselineFunctionsGranted,legacyRuntimeActive,legacyRuntimeRevoked,migrationHeadApplied,ok,queryOk,runtimeGrantsValid,runtimeOwnsNoTenantTables,runtimeRole,runtimeRoleSafe,tenantContextUnset,tenantPoliciesPresent,tenantRowsHidden,tenantTablesRlsEnabled" &&
    candidate.ok === true &&
    candidate.queryOk === true &&
    candidate.authRuntimeRole === true &&
    candidate.authRuntimeRoleSafe === true &&
    candidate.authRuntimeGrantsValid === true &&
    candidate.runtimeRole === true &&
    candidate.runtimeRoleSafe === true &&
    candidate.runtimeGrantsValid === true &&
    candidate.tenantContextUnset === true &&
    candidate.tenantRowsHidden === true &&
    candidate.tenantTablesRlsEnabled === true &&
    candidate.appUsersRlsEnabled === true &&
    candidate.appUsersPolicyPresent === true &&
    candidate.runtimeOwnsNoTenantTables === true &&
    candidate.tenantPoliciesPresent === true &&
    candidate.baselineFunctionsGranted === true &&
    candidate.migrationHeadApplied === true &&
    candidate.legacyRuntimeRevoked === expectedLegacyRevoked &&
    (expectedLegacyRevoked
      ? candidate.legacyRuntimeActive === false
      : candidate.legacyRuntimeActive === true)
  );
};

export const createSmokeConfig = (rootConfig: unknown, smokeMain: string): SmokeWranglerConfig => {
  if (!rootConfig || typeof rootConfig !== "object") {
    throw new Error("Could not read the root Wrangler configuration");
  }

  const config = rootConfig as RootWranglerConfig;
  if (typeof config.compatibility_date !== "string") {
    throw new Error("The root Wrangler configuration has no compatibility date");
  }

  if (!Array.isArray(config.hyperdrive)) {
    throw new Error(
      "Real AUTH_HYPERDRIVE and APP_HYPERDRIVE binding IDs are required before running the smoke",
    );
  }

  const hyperdriveBindings = config.hyperdrive.filter(
    (binding): binding is { binding: unknown; id: unknown } =>
      Boolean(binding) && typeof binding === "object" && "binding" in binding && "id" in binding,
  );
  const requiredBindings = ["AUTH_HYPERDRIVE", "APP_HYPERDRIVE"] as const;
  const selected = requiredBindings.map((bindingName) => {
    const matches = hyperdriveBindings.filter((binding) => binding.binding === bindingName);
    const id = typeof matches[0]?.id === "string" ? matches[0].id.trim() : "";
    if (matches.length !== 1 || !isRealHyperdriveId(id)) {
      throw new Error(`A real ${bindingName} binding ID is required before running the smoke`);
    }
    return { binding: bindingName, id };
  }) as [HyperdriveBinding, HyperdriveBinding];
  if (new Set(selected.map((binding) => binding.id)).size !== selected.length) {
    throw new Error("AUTH_HYPERDRIVE and APP_HYPERDRIVE must use distinct configuration IDs");
  }

  const compatibilityFlags = Array.isArray(config.compatibility_flags)
    ? config.compatibility_flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const name = typeof config.name === "string" ? config.name : "brew-dashboard";

  return {
    name: `${name}-hyperdrive-smoke`,
    main: smokeMain,
    compatibility_date: config.compatibility_date,
    compatibility_flags: compatibilityFlags,
    hyperdrive: selected,
  };
};

export const buildWranglerCommand = (options: {
  configPath: string;
  port: number;
  token: string;
  expectedLegacyRevoked?: boolean;
}) => [
  "bun",
  "run",
  "--cwd",
  webappDirectory,
  "wrangler",
  "dev",
  smokeEntrypointPath,
  "--config",
  options.configPath,
  "--remote",
  "--ip",
  "127.0.0.1",
  "--port",
  String(options.port),
  "--log-level",
  "error",
  "--show-interactive-dev-session",
  "false",
  "--var",
  `HYPERDRIVE_SMOKE_TOKEN:${options.token}`,
  "--var",
  `EXPECTED_LEGACY_REVOKED:${options.expectedLegacyRevoked === false ? "0" : "1"}`,
];

export const parseSmokeArguments = (argumentsList: string[]) => {
  let expectedLegacyRevoked = true;
  let configPath = rootWranglerConfigPath;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--expect-legacy" && (value === "active" || value === "revoked")) {
      expectedLegacyRevoked = value === "revoked";
      index += 1;
      continue;
    }
    if (argument === "--config" && value && isAbsolute(value)) {
      configPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(
      "Usage: db:smoke:hyperdrive [--config <absolute>] [--expect-legacy active|revoked]",
    );
  }
  return { expectedLegacyRevoked, configPath };
};

export const parseLegacyExpectation = (argumentsList: string[]) =>
  parseSmokeArguments(argumentsList).expectedLegacyRevoked;

const findFreePort = async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine a free smoke port");
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
};

const wait = (milliseconds: number) => Bun.sleep(milliseconds);

const waitForLocalWorker = async (url: string, child: ReturnType<typeof Bun.spawn>) => {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Hyperdrive smoke Worker exited before becoming ready");
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.status === 401) {
        return;
      }
    } catch {
      // Wrangler is still starting or the local port is not listening yet.
    }

    await wait(250);
  }

  throw new Error("Timed out waiting for the Hyperdrive smoke Worker");
};

const signalChildGroup = (child: ReturnType<typeof Bun.spawn>, signal: NodeJS.Signals) => {
  if (child.pid === undefined) {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};

const waitForChildExit = async (child: ReturnType<typeof Bun.spawn>) => {
  const exited = child.exited.then(() => true);
  const timedOut = wait(cleanupTimeoutMs).then(() => false);
  return Promise.race([exited, timedOut]);
};

const stopChild = async (child: ReturnType<typeof Bun.spawn>) => {
  if (child.exitCode !== null) {
    return;
  }

  signalChildGroup(child, "SIGTERM");
  if (await waitForChildExit(child)) {
    return;
  }

  signalChildGroup(child, "SIGKILL");
  if (!(await waitForChildExit(child))) {
    throw new Error("Could not stop the temporary Hyperdrive smoke Worker");
  }
};

const run = async () => {
  const { expectedLegacyRevoked, configPath: inputConfigPath } = parseSmokeArguments(
    process.argv.slice(2),
  );
  const token = randomUUID();
  const port = await findFreePort();
  const smokeConfigPath = join(temporaryDirectory, `hyperdrive-smoke-${token}.json`);
  let child: ReturnType<typeof Bun.spawn> | undefined;

  await mkdir(temporaryDirectory, { recursive: true });

  try {
    const rootConfig = Bun.JSON5.parse(await readFile(inputConfigPath, "utf8"));
    const smokeConfig = createSmokeConfig(
      rootConfig,
      relative(temporaryDirectory, smokeEntrypointPath),
    );
    await writeFile(smokeConfigPath, `${JSON.stringify(smokeConfig, null, 2)}\n`, {
      mode: 0o600,
    });

    const childEnvironment = createChildEnvironment(process.env, {
      WRANGLER_WRITE_LOGS: "false",
      ...(process.env.CLOUDFLARE_API_TOKEN
        ? { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN }
        : {}),
      ...(process.env.CLOUDFLARE_ACCOUNT_ID
        ? { CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID }
        : {}),
    });

    child = Bun.spawn(
      buildWranglerCommand({ configPath: smokeConfigPath, port, token, expectedLegacyRevoked }),
      {
        cwd: repositoryRoot,
        detached: true,
        env: childEnvironment,
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    const url = smokeUrl(port);
    await waitForLocalWorker(url, child);

    const response = await fetch(url, {
      headers: { "x-brew-smoke-token": token },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const payload: unknown = await response.json().catch(() => undefined);

    if (response.status !== 200 || !isValidSmokePayload(payload, expectedLegacyRevoked)) {
      const safeResult =
        payload && typeof payload === "object"
          ? Object.fromEntries(
              Object.entries(payload).filter(([, value]) => typeof value === "boolean"),
            )
          : undefined;
      throw new Error(
        `Hyperdrive smoke did not satisfy the runtime tenant checks: ${JSON.stringify(safeResult)}`,
      );
    }

    console.log("Hyperdrive smoke passed: runtime role and tenant isolation checks are valid.");
  } finally {
    try {
      if (child) {
        await stopChild(child);
      }
    } finally {
      await unlink(smokeConfigPath).catch(() => undefined);
    }
  }
};

if (import.meta.main) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Hyperdrive smoke failed");
    process.exitCode = 1;
  }
}
