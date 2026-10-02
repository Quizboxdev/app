# P0 Release Clearance

Run all commands from `Codes/QuizBox_Batch1_Student_Teacher_Assessment`.

## Review Wave 1

Open `/admin/content` as the authorised admin. The production-only queue contains
45 Wave 1 drafts; select subject and exact indicator code, then review each item.
Source grade B10 and canonical grade SHS1 remain separate fields. The reviewer
shows the actual taxonomy ancestry; incomplete imported titles are not invented.
Select editorial state `needs_revision` for the two unmapped legacy items.
Set the attestation per question before Approve & Next; Revise/Reject & Next
remain explicit individual decisions. Record a note for changes/rejection.
Approve only academically sound content, then use Publish Approved separately.
No mass approval or unattended publication is performed.

## Password protection and six credentials

In Supabase Authentication > Sign In / Providers > Email > Password security,
enable Prevent use of leaked passwords and save:
https://supabase.com/dashboard/project/fmgccmqxfjppqydkhaiu/auth/providers?provider=Email

The connector can detect the disabled advisor but cannot read affirmative Auth
configuration. For automatic verification, set `QB_SUPABASE_MANAGEMENT_TOKEN`
privately in ignored `.env.local` with Auth-config read permission. Never use a
NEXT_PUBLIC variable. Only `password_hibp_enabled` is retained in the receipt;
the complete configuration, SMTP secrets and token are never printed or saved.
No token/config access means a blocking FAIL, not inferred success from absence
of an advisor. No subscription upgrade or configuration write is automated.
Reference: https://supabase.com/docs/reference/api/v1-get-auth-service-config

Configure per-role environment email/passwords for admin, student, student2,
teacher, sponsor and seller in ignored `.env.acceptance.local`. Never paste
passwords into chat. Authorise the non-production acceptance context:

```powershell
$env:QB_ENVIRONMENT='acceptance'
$env:QB_ACCEPTANCE_PROJECT_REF='fmgccmqxfjppqydkhaiu'
npx.cmd tsx scripts/rotate-acceptance-credentials.ts --apply --confirm-test-rotation
```

This targets only the six reserved acceptance accounts, preflights all identities,
creates distinct random credentials in ignored `.env.acceptance.rotated.local`,
revokes refresh sessions, verifies old-password denial and replacement login.
Preserve the old ignored file for rejection probes. Never overwrite an incomplete
rotation receipt/replacement file blindly; reconcile partial rotation first.
The rotated file overrides legacy per-role values; missing rotated fields fail
instead of silently falling back. Old access JWTs must expire before clearance.
Physical removal/isolation of fixture content remains an operator deployment decision.

After rotation, the single authoritative verification command is:

```powershell
npm.cmd run release:check
```

It checks live Auth configuration, six replacement identities, rejection of old
passwords, the rotation receipt, expiry of old access tokens, and current credential
fingerprints. It also runs the 95 live tests, local quality checks and restore gate.
For security-only diagnostics use `npm.cmd run release:verify-security`.
Authentication/configuration failures are recorded separately from executed
application/database-contract test failures in `reports/authenticated-acceptance.json`.

## Three-command isolated recovery rehearsal

Prerequisites: existing `pg_dump`, `pg_restore`, `psql`, a private `PGPASSFILE`,
and a separately provisioned compatible disposable database. No runtime is installed.
Supabase managed Auth/Storage schemas may conflict with a full archive; prepare
the isolated target with an operator before restoring. No --clean/drop workaround
is performed, and the current project is explicitly refused as a restore target.
Use equivalent database roles/owners so grants and security-definer ownership can
be compared. Storage file contents require a separate private export/checksum list.

1. Set source `PGHOST=db.fmgccmqxfjppqydkhaiu.supabase.co`, `PGDATABASE=postgres`,
   `PGUSER`, `PGPASSFILE`. Export in a quiet window:

```powershell
powershell -File scripts/backup-schema.ps1 -OutputDirectory "$PWD/.local-backups/consistent-archive" -ConfirmPrivateBackup
```

The consistent archive preserves ACLs. Read-only before/after fingerprints must
match; concurrent source changes reject the baseline. Private artifacts contain
Auth data and must be encrypted/access-controlled. Keep all source metadata private.

2. Set `QB_ENVIRONMENT=restore`, `QB_RESTORE_PROJECT_REF=<isolated-ref>`,
   `QB_PRODUCTION_PROJECT_REF=fmgccmqxfjppqydkhaiu`, and target `PGHOST`, `PGUSER`,
   `PGDATABASE=postgres`, `PGPASSFILE`. Restore transactionally:

```powershell
powershell -File scripts/restore-isolated.ps1 -Archive "$PWD/.local-backups/consistent-archive/quizbox.dump" -ConfirmIsolatedRestore
```

3. Download/check restored storage files against the source export first. Then:

```powershell
npm.cmd run restore:verify -- --archive "$PWD/.local-backups/consistent-archive/quizbox.dump" --confirm-storage-verified
```

Omit the storage attestation until downloads/checksums are verified; the gate stays
FAIL. The verifier requires the isolated execution receipt and archive SHA256;
compares schema table counts, columns/types, enums, functions, ownership, ACLs,
RLS/policies, indexes/triggers, every table's row count and ordered row hashes;
checks every restored FK for orphaned/partial-null relationships; and requires
users/profiles, taxonomy/questions/versions, assignments/snapshots, responses,
results, learning events, mastery and XP tables. It emits
`reports/restore-verification.json` with no passwords, user rows or answer keys.
SQL row fingerprints are MD5 comparison checks; archive integrity uses SHA256.
Run authenticated acceptance against the isolated target too; do not confuse a
database integrity rehearsal with successful end-to-end application testing.

## Final gate

Return to the explicitly authorised acceptance environment and run
`npm.cmd run release:check`. READY requires active approved mapped production
content, affirmative fresh password configuration, fresh current six-account
rotation verification, matching isolated restore evidence including storage, all
95 authenticated tests executed successfully, and all local/security checks.
Missing evidence, stale/different-project credentials, skipped live tests or any
P0 finding remain FAIL. No push is performed by these commands.
