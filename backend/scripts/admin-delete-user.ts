import { deleteAccount } from "../src/admin/accounts.ts";
import {
  parseAccountKind,
  parseAdminArguments,
  readAdminDatabaseUrl,
  requireExactConfirmation,
  requireFlag,
  requireProductionAdmin,
  withAdminDatabase,
} from "./admin-common.ts";

const argumentsMap = parseAdminArguments([
  "--login",
  "--account-kind",
  "--confirm-login",
  "--confirm-production",
]);
const databaseUrl = readAdminDatabaseUrl();
requireProductionAdmin(databaseUrl, argumentsMap.get("--confirm-production"));
const login = requireFlag(argumentsMap, "--login");
requireExactConfirmation(login, requireFlag(argumentsMap, "--confirm-login"));
const result = await withAdminDatabase((db) =>
  deleteAccount(db, {
    login,
    accountKind: parseAccountKind(requireFlag(argumentsMap, "--account-kind")),
  }),
);

console.log(`Deleted account: ${result.login}`);
