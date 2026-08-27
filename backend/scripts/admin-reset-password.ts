import { resetAccountPassword } from "../src/admin/accounts.ts";
import {
  parseAccountKind,
  parseAdminArguments,
  readAdminDatabaseUrl,
  readInteractivePassword,
  requireExactConfirmation,
  requireFlag,
  requireProductionAdmin,
  withAdminDatabase,
} from "./admin-common.ts";

const argumentsMap = parseAdminArguments(
  [
    "--login",
    "--account-kind",
    "--confirm-login",
    "--interactive-password",
    "--confirm-production",
  ],
  ["--interactive-password"],
);
const databaseUrl = readAdminDatabaseUrl();
requireProductionAdmin(databaseUrl, argumentsMap.get("--confirm-production"));
const login = requireFlag(argumentsMap, "--login");
requireExactConfirmation(login, requireFlag(argumentsMap, "--confirm-login"));
const password = argumentsMap.has("--interactive-password")
  ? await readInteractivePassword()
  : undefined;
const result = await withAdminDatabase((db) => {
  const input = {
    login,
    accountKind: parseAccountKind(requireFlag(argumentsMap, "--account-kind")),
    ...(argumentsMap.has("--interactive-password") ? { password: password! } : {}),
  };
  return resetAccountPassword(db, input);
});

console.log(`Login: ${result.login}`);
console.log(`Password (shown once): ${result.password}`);
