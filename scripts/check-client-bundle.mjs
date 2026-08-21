import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const clientOutput = path.join(root, "webapp", "dist", "client");
const forbiddenMarkers = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_SECRET_KEY",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
];

try {
  await access(clientOutput);
} catch {
  console.error(`Client bundle directory is missing: ${clientOutput}`);
  process.exitCode = 1;
}

const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(entryPath);
    else files.push(entryPath);
  }
}

if (process.exitCode !== 1) {
  await collect(clientOutput);
  const leaks = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const marker of forbiddenMarkers) {
      if (content.includes(marker)) leaks.push(`${path.relative(root, file)} contains ${marker}`);
    }
  }

  if (leaks.length > 0) {
    console.error("Client bundle secret check failed:");
    for (const leak of leaks) console.error(`- ${leak}`);
    process.exitCode = 1;
  } else {
    console.log("Client bundle secret check passed.");
  }
}
