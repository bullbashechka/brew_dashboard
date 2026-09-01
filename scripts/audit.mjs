import { spawnSync } from "node:child_process";

const audit = spawnSync("bun", ["audit", "--json"], { encoding: "utf8" });
const jsonLine = audit.stdout
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line.startsWith("{") && line.endsWith("}"));
let findings = {};
if (jsonLine) {
  try {
    findings = JSON.parse(jsonLine);
  } catch {
    console.error("Unable to parse bun audit output");
    process.exit(1);
  }
} else if (audit.status !== 0) {
  console.error(audit.stderr || audit.stdout || "bun audit failed without a report");
  process.exit(audit.status ?? 1);
}

const advisories = Object.entries(findings).flatMap(([packageName, entries]) =>
  entries.map((entry) => ({ packageName, ...entry })),
);
const reviewedDevelopmentExceptions = new Map([
  ["esbuild:1102341", { severity: "moderate", expiresOn: "2026-09-30" }],
]);
const exceptionFor = (advisory) =>
  reviewedDevelopmentExceptions.get(`${advisory.packageName}:${String(advisory.id)}`);
const blocking = advisories.filter((advisory) => {
  const severity = String(advisory.severity).toLowerCase();
  if (["high", "critical"].includes(severity)) return true;
  const exception = exceptionFor(advisory);
  if (!exception || exception.severity !== severity) return true;
  return Date.now() > Date.parse(`${exception.expiresOn}T23:59:59.999Z`);
});
if (advisories.length) {
  console.warn(
    `bun audit found ${advisories.length} advisory(s): ${advisories
      .map((advisory) => `${advisory.packageName} (${advisory.severity}, ${advisory.id})`)
      .join(", ")}`,
  );
}
if (blocking.length) {
  console.error(
    "Unreviewed, expired, high or critical dependency advisories block the release gate",
  );
  process.exit(1);
}

const secrets = spawnSync(process.execPath, ["scripts/security-scan.mjs"], {
  stdio: "inherit",
});
process.exit(secrets.status ?? 1);
