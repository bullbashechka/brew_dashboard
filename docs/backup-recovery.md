# Backup and recovery runbook

Production data is protected by three independent layers. The Worker never receives a database
password or an encryption key.

1. **Railway native layer.** Enable the Railway PostgreSQL daily backup/snapshot policy and confirm
   the provider's documented restore window. Keep the retention at least 30 days. Verify the policy
   and the latest successful snapshot in the Railway dashboard after every infrastructure change.
2. **Encrypted off-site layer.** Once per day run `bun run backup:dump` from a protected operator
   host. The command invokes `pg_dump` through the owner/unpooled URL, encrypts the custom-format
   stream with AES-256-GCM, writes an atomic `0600` artifact and an HMAC-authenticated manifest,
   then uploads both files to a private R2/S3 bucket with object versioning and a 30-day lifecycle.
   Store `BACKUP_ENCRYPTION_KEY` in a secret manager separate from the bucket. Never put it in
   Worker variables, a command argument, a tracked file, or the bucket next to the ciphertext.
3. **Restore-proof layer.** Once per month download one recent artifact to an isolated disposable
   PostgreSQL instance, run `bun run backup:verify -- --file <absolute-file>`, then use the guarded
   `backup:restore` command below. The integration runner also performs this drill against a fresh
   loopback database. Record the restore timestamp, artifact checksum and result. Destroy the
   disposable instance after the drill; the command removes its temporary plaintext in `finally`.

## Daily dump

Use a dedicated directory outside the repository and home directory. The command is fail-closed for
remote databases unless the operator explicitly confirms production:

```bash
DATABASE_MIGRATION_URL='postgresql://owner@host/database?sslmode=verify-full&sslrootcert=/absolute/ca.pem' \
BACKUP_OUTPUT_DIR='/var/lib/brew-dashboard-backups' \
BACKUP_ENCRYPTION_KEY='<32-byte-base64url-key-from-secret-manager>' \
BACKUP_ENCRYPTION_KEY_ID='backup-key-2026-08' \
ALLOW_PRODUCTION_BACKUP=1 \
bun run backup:dump -- --confirm-production production --retention-days 30 --prune
```

The command does not log the URL, password, key, dump contents or `pg_dump` stderr. Use the
operator host's secret manager to inject the variables, and let the host's scheduler retry a failed
run and alert when the daily manifest is missing. Upload only after the command exits successfully;
verify the uploaded object checksum against the manifest.

For a local disposable database, omit the production confirmation and use a temporary output
directory. Do not point the command at the Worker Hyperdrive URL: backups use the unpooled migration
connection so a backup cannot consume request capacity.

Remote PostgreSQL URLs must use `sslmode=verify-full` and an explicit `sslrootcert`; alternatively
inject `PGSSLROOTCERT`. `disable`, `allow`, `prefer`, `require`, and `verify-ca` are rejected. The
URL fields and supported libpq query options are mapped to the child environment without logging
credentials or certificate paths. Set `DATABASE_TARGET_ENVIRONMENT=production` when production is
reached through a loopback tunnel; Railway environment markers trigger the same production gates.

## Guarded restore

Restore only into a newly created empty database. The confirmation must exactly match the database
name in `DATABASE_RESTORE_URL`; a remote target additionally requires `ALLOW_PRODUCTION_RESTORE=1`.
The key ID must match the sidecar manifest before decryption starts.

```bash
DATABASE_RESTORE_URL='postgresql://owner@127.0.0.1/brew_dashboard_restore' \
BACKUP_ENCRYPTION_KEY='<32-byte-base64url-key-from-secret-manager>' \
BACKUP_ENCRYPTION_KEY_ID='backup-key-2026-08' \
bun run backup:restore -- \
  --file /absolute/backups/brew-dashboard-....dump.enc \
  --manifest /absolute/backups/brew-dashboard-....dump.enc.manifest.json \
  --confirm-empty-target brew_dashboard_restore
```

The command authenticates the manifest metadata with an HMAC derived from the backup key, validates
its name, byte count, SHA-256, format and key ID; authenticates the complete AES-GCM stream; verifies
the `PGDMP` signature; and only then runs `pg_restore` with
`--no-owner --no-privileges --exit-on-error --single-transaction`. It finally recreates and
validates the two `NOLOGIN NOBYPASSRLS` runtime roles, exact grants, default privileges and RLS
catalog state while revoking legacy `brew_runtime`. Use `bun run db:bootstrap-runtime-roles` to
repeat the idempotent privilege repair/validation after an owner restore.

Manifests created before the authenticated `manifestMac` field was introduced are intentionally
rejected. Retain the matching application revision or regenerate a protected manifest during a
controlled recovery exercise; never weaken the current restore command to accept unsigned metadata.
`SIGINT` and `SIGTERM` trigger plaintext cleanup, while a host crash or `SIGKILL` still requires the
operator to sweep the protected temporary directory before returning the host to service.

## Recovery order

1. Declare the incident and stop application writes if consistency requires it. Preserve the latest
   encrypted artifact and manifest; do not rotate away the key used by that artifact.
2. Prefer a Railway native restore when it satisfies the required recovery point. Otherwise download
   the newest verified off-site artifact, run `backup:verify`, then run guarded `backup:restore`.
3. Restore into a new isolated PostgreSQL database, run migrations/checks and verify tenant counts,
   auth/session tables, MFA records, and a representative analytics response. Do not overwrite the
   source database until the verification is recorded.
4. Provision fresh `brew_auth_runtime` and `brew_app_runtime` passwords, point the two cache-disabled
   Hyperdrive configurations at the restored database, and deploy only after health, auth, MFA and
   tenant-isolation smoke checks pass.
5. Keep the original database read-only for the incident window and retain the incident artifact,
   checksum and restore log for at least 30 days. Delete temporary plaintext files immediately.

## Key rotation

Create a new random 32-byte key in the secret manager, set a new `BACKUP_ENCRYPTION_KEY_ID`, and
keep the previous key available until every artifact encrypted with it has expired and the latest
restore drill has passed. Never re-encrypt or rewrite historical artifacts in place. A missing key,
checksum mismatch, failed verification, or stale Railway snapshot is an operational release blocker.
