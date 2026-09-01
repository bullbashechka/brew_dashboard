import { runReleaseDeploymentCli } from "./release-deploy.mjs";

// Stage B is the rollback-safe prerequisite: the Worker uses both split runtime bindings while
// brew_runtime remains available to the previous version. Stage C may revoke legacy only after
// this version is live and its health/auth paths have been checked.
runReleaseDeploymentCli("B");
