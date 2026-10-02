param([Parameter(Mandatory=$true)][string]$OutputDirectory,[switch]$ConfirmPrivateBackup)
$ErrorActionPreference='Stop'
if (-not $ConfirmPrivateBackup) { throw 'PRIVATE_BACKUP_CONFIRMATION_REQUIRED' }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw 'EXISTING_PG_DUMP_REQUIRED' }
if ($env:PGHOST -ne 'db.fmgccmqxfjppqydkhaiu.supabase.co' -or $env:PGDATABASE -ne 'postgres') { throw 'BACKUP_SOURCE_TARGET_MISMATCH' }
if (-not $env:PGUSER -or -not $env:PGPASSFILE -or -not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) { throw 'PRIVATE_POSTGRES_CREDENTIAL_CONFIGURATION_REQUIRED' }
if ($env:PGSERVICE -or $env:PGSERVICEFILE -or $env:PGOPTIONS) { throw 'BACKUP_CONNECTION_OVERRIDE_NOT_ALLOWED' }
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.local-backups'))
$target=[IO.Path]::GetFullPath($OutputDirectory)
if (-not $target.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'PRIVATE_BACKUP_DIRECTORY_REQUIRED' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
$archive=Join-Path $target 'quizbox.dump'
if (Test-Path -LiteralPath $archive) { throw 'BACKUP_ARCHIVE_ALREADY_EXISTS' }
$env:PGSSLMODE='require'
# pg_dump uses a consistent read-only snapshot. The archive includes sensitive Auth data.
& pg_dump --format=custom --no-owner --no-acl --schema=public --schema=quizbox_private --schema=auth --schema=storage --host $env:PGHOST --username $env:PGUSER --dbname postgres --file $archive
if ($LASTEXITCODE -ne 0) { throw 'CONSISTENT_ARCHIVE_EXPORT_FAILED' }
(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
Write-Output 'CONSISTENT_ARCHIVE_EXPORTED: preserve privately; storage binaries need separate export; restore not verified'
