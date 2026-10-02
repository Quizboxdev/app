param([Parameter(Mandatory=$true)][string]$Archive,[switch]$ConfirmIsolatedRestore)
$ErrorActionPreference='Stop'
if (-not $ConfirmIsolatedRestore -or $env:QB_ENVIRONMENT -ne 'restore') { throw 'ISOLATED_RESTORE_CONFIRMATION_REQUIRED' }
$ref=$env:QB_RESTORE_PROJECT_REF
if (-not $ref -or $ref -eq $env:QB_PRODUCTION_PROJECT_REF -or $ref -eq 'fmgccmqxfjppqydkhaiu') { throw 'RESTORE_TARGET_IS_NOT_ISOLATED' }
if ($env:PGHOST -ne "db.$ref.supabase.co" -or $env:PGDATABASE -ne 'postgres') { throw 'RESTORE_CONNECTION_TARGET_MISMATCH' }
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw 'RESTORE_ARCHIVE_MISSING' }
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw 'EXISTING_PG_RESTORE_REQUIRED' }
if (-not $env:PGUSER -or -not $env:PGPASSFILE -or -not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) { throw 'PRIVATE_POSTGRES_CREDENTIAL_CONFIGURATION_REQUIRED' }
if ($env:PGSERVICE -or $env:PGSERVICEFILE -or $env:PGOPTIONS) { throw 'RESTORE_CONNECTION_OVERRIDE_NOT_ALLOWED' }
if (-not (Test-Path -LiteralPath "$Archive.sha256" -PathType Leaf)) { throw 'RESTORE_CHECKSUM_RECEIPT_REQUIRED' }
$expected=(Get-Content -LiteralPath "$Archive.sha256" -Raw).Trim()
if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $expected) { throw 'RESTORE_ARCHIVE_CHECKSUM_MISMATCH' }
# Use an operator-managed PGPASSFILE; never place credentials in command arguments.
& pg_restore --list $Archive | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'RESTORE_ARCHIVE_INVALID' }
& pg_restore --single-transaction --exit-on-error --no-owner --no-acl --host $env:PGHOST --username $env:PGUSER --dbname postgres $Archive
if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_RESTORE_FAILED' }
Write-Output 'RESTORE_EXECUTED: compare row counts/checksums and run authenticated regression before certification'
