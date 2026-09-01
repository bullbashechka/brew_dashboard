import { createAccount } from "../src/admin/accounts.ts";
import {
  parseAccountKind,
  parseAdminArguments,
  parseExpiry,
  assertInteractivePasswordAllowed,
  readAdminDatabaseUrl,
  readInteractivePassword,
  requireFlag,
  requireProductionAdmin,
  withAdminDatabase,
} from "./admin-common.ts";

const argumentsMap = parseAdminArguments(
  ["--login", "--account-kind", "--expires-at", "--interactive-password", "--confirm-production"],
  ["--interactive-password"],
);
const databaseUrl = readAdminDatabaseUrl();
requireProductionAdmin(databaseUrl, argumentsMap.get("--confirm-production"));
const interactivePassword = argumentsMap.has("--interactive-password");
assertInteractivePasswordAllowed(databaseUrl, interactivePassword);
const password = interactivePassword ? await readInteractivePassword() : undefined;
const result = await withAdminDatabase((db) => {
  const input = {
    login: requireFlag(argumentsMap, "--login"),
    accountKind: parseAccountKind(argumentsMap.get("--account-kind") ?? "demo"),
    expiresAt: parseExpiry(argumentsMap.get("--expires-at")),
    ...(interactivePassword ? { password: password! } : {}),
  };
  return createAccount(db, input);
});

console.log(`Login: ${result.login}`);
if (interactivePassword) {
  console.log("Password was accepted interactively and is not echoed.");
} else {
  console.log(`Password (shown once): ${result.password}`);
}
