import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

export type SmokeWranglerConfig = {
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: string[];
  hyperdrive: [HyperdriveBinding];
};

export const isValidSmokePayload = (payload: unknown): payload is HyperdriveSmokePayload => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<HyperdriveSmokePayload>;
  const keys = Object.keys(candidate).sort().join(",");
  return (
    keys ===
      "migrationHeadApplied,ok,queryOk,runtimeGrantsValid,runtimeOwnsNoTenantTables,runtimeRole,runtimeRoleSafe,tenantContextUnset,tenantPoliciesPresent,tenantRowsHidden,tenantTablesRlsEnabled" &&
    candidate.ok === true &&
    candidate.queryOk === true &&
    candidate.runtimeRole === true &&
    candidate.runtimeRoleSafe === true &&
    candidate.runtimeGrantsValid === true &&
    candidate.tenantContextUnset === true &&
    candidate.tenantRowsHidden === true &&
    candidate.tenantTablesRlsEnabled === true &&
    candidate.runtimeOwnsNoTenantTables === true &&
    candidate.tenantPoliciesPresent === true &&
    candidate.migrationHeadApplied === true
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
    throw new Error("A real HYPERDRIVE binding ID is required before running the smoke");
  }

  const hyperdriveBindings = config.hyperdrive.filter(
    (binding): binding is { binding: unknown; id: unknown } =>
      Boolean(binding) && typeof binding === "object" && "binding" in binding && "id" in binding,
  );
  const appBindings = hyperdriveBindings.filter((binding) => binding.binding === "HYPERDRIVE");
  const binding = appBindings[0];
  const bindingId = typeof binding?.id === "string" ? binding.id.trim() : undefined;
  if (appBindings.length !== 1 || !bindingId || /^<.*>$/.test(bindingId)) {
    throw new Error("A real HYPERDRIVE binding ID is required before running the smoke");
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
    hyperdrive: [{ binding: "HYPERDRIVE", id: bindingId }],
  };
};

export const buildWranglerCommand = (options: {
  configPath: string;
  port: number;
  token: string;
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
];

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
  const token = randomUUID();
  const port = await findFreePort();
  const smokeConfigPath = join(temporaryDirectory, `hyperdrive-smoke-${token}.json`);
  let child: ReturnType<typeof Bun.spawn> | undefined;

  await mkdir(temporaryDirectory, { recursive: true });

  try {
    const rootConfig = Bun.JSON5.parse(await readFile(rootWranglerConfigPath, "utf8"));
    const smokeConfig = createSmokeConfig(
      rootConfig,
      relative(temporaryDirectory, smokeEntrypointPath),
    );
    await writeFile(smokeConfigPath, `${JSON.stringify(smokeConfig, null, 2)}\n`, {
      mode: 0o600,
    });

    const childEnvironment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        childEnvironment[key] = value;
      }
    }
    delete childEnvironment.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;
    childEnvironment.WRANGLER_WRITE_LOGS = "false";

    child = Bun.spawn(buildWranglerCommand({ configPath: smokeConfigPath, port, token }), {
      cwd: repositoryRoot,
      detached: true,
      env: childEnvironment,
      stdout: "ignore",
      stderr: "ignore",
    });

    const url = smokeUrl(port);
    await waitForLocalWorker(url, child);

    const response = await fetch(url, {
      headers: { "x-brew-smoke-token": token },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const payload: unknown = await response.json().catch(() => undefined);

    if (response.status !== 200 || !isValidSmokePayload(payload)) {
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
