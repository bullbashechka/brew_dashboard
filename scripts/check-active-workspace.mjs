import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lockfileText = await readFile(path.join(root, "bun.lock"), "utf8");
const expectedWorkspaces = ["webapp", "backend", "packages/*"];
const forbiddenPackageNames = [
  "astro",
  "@astrojs",
  "prisma",
  "@prisma",
  "supabase",
  "@supabase",
  "expo",
  "react-native",
  "jsonwebtoken",
  "jose",
  "nodemailer",
  "terraform",
  "doctl",
  "digitalocean",
  "yandex-cloud",
];

const failures = [];

if (JSON.stringify(rootManifest.workspaces) !== JSON.stringify(expectedWorkspaces)) {
  failures.push(`Expected workspaces ${JSON.stringify(expectedWorkspaces)}`);
}

const manifests = [
  ["package.json", rootManifest],
  [
    "backend/package.json",
    JSON.parse(await readFile(path.join(root, "backend/package.json"), "utf8")),
  ],
  [
    "packages/contracts/package.json",
    JSON.parse(await readFile(path.join(root, "packages/contracts/package.json"), "utf8")),
  ],
  [
    "webapp/package.json",
    JSON.parse(await readFile(path.join(root, "webapp/package.json"), "utf8")),
  ],
];

const packageNameIsForbidden = (name) =>
  forbiddenPackageNames.some(
    (forbidden) =>
      name === forbidden || name.startsWith(`${forbidden}@`) || name.startsWith(`${forbidden}/`),
  );

for (const [manifestPath, manifest] of manifests) {
  const packageNames = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  for (const packageName of packageNames) {
    if (packageNameIsForbidden(packageName)) {
      failures.push(`${manifestPath} contains removed package ${packageName}`);
    }
  }
}

const lockPackageNames = [...lockfileText.matchAll(/^\s{4}"([^"\\]+)": \[/gm)].map(
  (match) => match[1],
);
for (const packageName of lockPackageNames) {
  if (packageNameIsForbidden(packageName)) {
    failures.push(`bun.lock contains removed package ${packageName}`);
  }
}

for (const [manifestPath, manifest] of manifests) {
  const scriptText = JSON.stringify(manifest.scripts ?? {}).toLowerCase();
  for (const term of [
    "astro",
    "prisma",
    "supabase",
    "terraform",
    "digitalocean",
    "doctl",
    "yandex",
  ]) {
    if (scriptText.includes(term)) {
      failures.push(`${manifestPath} scripts contain removed technology ${term}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Active workspace check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Active workspace check passed.");
}
