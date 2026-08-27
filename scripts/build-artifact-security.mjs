import { access, lstat, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const buildArtifactRoot = path.join(repositoryRoot, "webapp", "dist");

const forbiddenMarkers = [
  "DATABASE_URL",
  "DATABASE_PUBLIC_URL",
  "BETTER_AUTH_SECRET",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_SECRET_KEY",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
];
const sensitiveKeyPattern =
  /(SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|SERVICE_ROLE|PRIVATE_KEY)/i;
const sourceSecretDirectories = [
  repositoryRoot,
  path.join(repositoryRoot, "backend"),
  path.join(repositoryRoot, "webapp"),
];

const isLocalSecretFile = (filePath) => {
  const name = path.basename(filePath);
  return (
    name === ".dev.vars" ||
    name.startsWith(".dev.vars.") ||
    name === ".env" ||
    name.startsWith(".env.")
  );
};

const collectFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else files.push(entryPath);
  }
  return files;
};

const collectSourceSecretFiles = async () => {
  const files = [];
  for (const directory of sourceSecretDirectories) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && isLocalSecretFile(entry.name)) {
        files.push(path.join(directory, entry.name));
      }
    }
  }
  return files;
};

const parseSecretEntries = (content) => {
  const entries = [];
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.*?))\s*$/u);
    if (!match || !sensitiveKeyPattern.test(match[1])) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (value.length >= 8 && !/^<[^>]+>$/u.test(value)) {
      entries.push({ label: match[1], value });
    }
  }
  return entries;
};

const collectSensitiveValues = async () => {
  const entries = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (value && sensitiveKeyPattern.test(key) && value.length >= 8) {
      entries.push({ label: key, value });
    }
  }
  for (const file of await collectSourceSecretFiles()) {
    entries.push(...parseSecretEntries(await readFile(file, "utf8")));
  }
  const unique = new Map();
  for (const entry of entries) {
    if (!unique.has(entry.value)) unique.set(entry.value, entry.label);
  }
  return [...unique.entries()].map(([value, label]) => ({ label, value }));
};

const assertArtifactExists = async (directory) => {
  try {
    await access(directory);
  } catch {
    throw new Error(`Build artifact directory is missing: ${directory}`);
  }
};

/** Remove only preview secret files emitted below the generated build tree. */
export const sanitizeBuildArtifact = async (directory = buildArtifactRoot) => {
  await assertArtifactExists(directory);
  const files = await collectFiles(directory);
  const secretFiles = files.filter(isLocalSecretFile);
  for (const file of secretFiles) {
    const stats = await lstat(file);
    if (!stats.isFile()) throw new Error(`Refusing to remove non-file artifact entry: ${file}`);
    await unlink(file);
  }
  return secretFiles.map((file) => path.relative(repositoryRoot, file));
};

/** Scan every regular file in the generated artifact for secret files/markers/values. */
export const checkBuildArtifact = async (directory = buildArtifactRoot) => {
  await assertArtifactExists(directory);
  const files = await collectFiles(directory);
  const sensitiveValues = await collectSensitiveValues();
  const leaks = [];
  for (const file of files) {
    const relativeFile = path.relative(repositoryRoot, file);
    const relativeArtifactFile = path.relative(directory, file);
    const isClientBundle =
      relativeArtifactFile === "client" || relativeArtifactFile.startsWith("client/");
    if (isLocalSecretFile(file)) {
      leaks.push(`${relativeFile} is a local secret file`);
      continue;
    }
    const content = await readFile(file);
    if (isClientBundle) {
      for (const marker of forbiddenMarkers) {
        if (content.includes(Buffer.from(marker))) leaks.push(`${relativeFile} contains ${marker}`);
      }
    }
    for (const { label, value } of sensitiveValues) {
      if (content.includes(Buffer.from(value))) leaks.push(`${relativeFile} contains ${label}`);
    }
  }
  return { files, leaks };
};

const main = async () => {
  const command = process.argv[2];
  if (command === "sanitize") {
    const removed = await sanitizeBuildArtifact();
    console.log(`Removed ${removed.length} local secret file(s) from the build artifact.`);
    return;
  }
  if (command === "check") {
    const result = await checkBuildArtifact();
    if (result.leaks.length) {
      console.error("Build artifact secret check failed:");
      for (const leak of result.leaks) console.error(`- ${leak}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Build artifact secret check passed (${result.files.length} files checked).`);
    return;
  }
  throw new Error("Usage: build-artifact-security.mjs <sanitize|check>");
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Build artifact security check failed");
    process.exitCode = 1;
  }
}
