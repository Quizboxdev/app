param([Parameter(Mandatory=$true)][string]$Archive,[switch]$ConfirmIsolatedRestore)
$ErrorActionPreference='Stop'
if (-not $ConfirmIsolatedRestore -or $env:QB_ENVIRONMENT -ne 'restore') { throw 'ISOLATED_RESTORE_CONFIRMATION_REQUIRED' }
$ref=$env:QB_RESTORE_PROJECT_REF
if (-not $ref -or -not $env:QB_PRODUCTION_PROJECT_REF -or $ref -eq $env:QB_PRODUCTION_PROJECT_REF -or $ref -eq 'fmgccmqxfjppqydkhaiu') { throw 'RESTORE_TARGET_IS_NOT_ISOLATED' }
# Direct host, or the IPv4 session pooler bound to the same project by its project-qualified user.
$direct = $env:PGHOST -eq "db.$ref.supabase.co" -and $env:PGUSER -eq 'postgres'
$pooler = $env:PGHOST -match '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -and $env:PGUSER -eq "postgres.$ref"
if (-not ($direct -or $pooler) -or $env:PGDATABASE -ne 'postgres') { throw 'RESTORE_CONNECTION_TARGET_MISMATCH' }
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw 'RESTORE_ARCHIVE_MISSING' }
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue) -or -not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'EXISTING_PG_RESTORE_REQUIRED' }
if (-not $env:PGUSER -or -not $env:PGPASSFILE -or -not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) { throw 'PRIVATE_POSTGRES_CREDENTIAL_CONFIGURATION_REQUIRED' }
if ($env:PGSERVICE -or $env:PGSERVICEFILE -or $env:PGOPTIONS) { throw 'RESTORE_CONNECTION_OVERRIDE_NOT_ALLOWED' }
if (-not (Test-Path -LiteralPath "$Archive.sha256" -PathType Leaf)) { throw 'RESTORE_CHECKSUM_RECEIPT_REQUIRED' }
$expected=(Get-Content -LiteralPath "$Archive.sha256" -Raw).Trim()
if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $expected) { throw 'RESTORE_ARCHIVE_CHECKSUM_MISMATCH' }
# Use an operator-managed PGPASSFILE; never place credentials in command arguments.
$toc = & pg_restore --list $Archive
if ($LASTEXITCODE -ne 0) { throw 'RESTORE_ARCHIVE_INVALID' }
$env:PGSSLMODE='require'
function Invoke-TargetQuery([string]$sql) { $out = & psql -X -q -t -A -v ON_ERROR_STOP=1 --host $env:PGHOST --username $env:PGUSER --dbname postgres -c $sql; if ($LASTEXITCODE -ne 0) { throw 'RESTORE_TARGET_QUERY_FAILED' }; return $out }

# The target must be an empty project: no QuizBox objects before restore.
$state = Invoke-TargetQuery "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S'))||':'||(to_regnamespace('quizbox_private') is not null)::text"
if ($state -ne '0:false') { throw 'RESTORE_TARGET_NOT_EMPTY' }

# Platform-managed schemas (auth, storage) already exist on a Supabase target with the platform's own definitions,
# roles and migration ledgers. Their definitions are never recreated or dropped: only their table data is restored.
$managed = @('auth','storage')
$bootstrap = @('auth schema_migrations','storage migrations')   # the target's own platform ledgers stay authoritative
# Parent tables first: the target already enforces the platform foreign keys during the data load.
$parents = @('auth users','auth sso_providers','auth oauth_clients','auth flow_state','auth sessions','auth mfa_factors','auth mfa_challenges','auth mfa_recovery_code_sets','storage buckets','storage s3_multipart_uploads')
# Managed tables that were empty in the sealed source baseline carry no rows; skipping them avoids touching
# platform-internal tables the project role cannot write. Any non-empty table still fails loudly.
$baselineFile = Join-Path (Split-Path -Parent $Archive) 'source-verification.json'
if (-not (Test-Path -LiteralPath $baselineFile -PathType Leaf)) { throw 'SEALED_SOURCE_BASELINE_REQUIRED' }
$sourceRows = @{}; foreach ($t in (Get-Content -LiteralPath $baselineFile -Raw | ConvertFrom-Json).tables) { $sourceRows[$t.table] = [int]$t.rows }
$entry = '^\d+; \d+ \d+ (?<type>TABLE DATA|SEQUENCE SET|SEQUENCE OWNED BY|FK CONSTRAINT|DEFAULT ACL|ROW SECURITY|MATERIALIZED VIEW DATA|MATERIALIZED VIEW|[A-Z]+) (?<schema>\S+) (?<rest>.*) (?<owner>\S+)$'
$owned = New-Object System.Collections.Generic.List[string]; $managedData = New-Object System.Collections.Generic.List[string]
$excluded = 0; $preexisting = @{}
foreach ($line in $toc) {
  if ($line -match '^\s*;' -or -not $line.Trim()) { continue }
  if ($line -notmatch $entry) { throw "RESTORE_TOC_UNPARSEABLE: $line" }
  $type=$Matches.type; $schema=$Matches.schema; $rest=$Matches.rest; $owner=$Matches.owner
  if ($schema -in @('public','quizbox_private')) {
    if ($type -eq 'DEFAULT ACL' -and $owner -ne 'postgres') { $excluded++; continue }   # other roles' defaults belong to the platform
    $owned.Add($line); continue
  }
  if ($schema -eq '-') {
    # TOC lists the schema itself as "SCHEMA - <name>" and its ACL/comment as "<TYPE> - SCHEMA <name>".
    if (($type -eq 'SCHEMA' -and $rest -eq 'quizbox_private') -or ($type -in @('ACL','COMMENT') -and $rest -eq 'SCHEMA quizbox_private') -or ($type -eq 'ACL' -and $rest -eq 'SCHEMA public')) { $owned.Add($line) } else { $excluded++ }
    continue
  }
  if ($schema -in $managed) {
    $table = ($rest -split ' ')[0]
    if ($type -eq 'TABLE DATA' -and "$schema $table" -notin $bootstrap) { if (-not $sourceRows.ContainsKey("$schema.$table")) { throw "SOURCE_BASELINE_TABLE_MISSING: $schema.$table" }; if ($sourceRows["$schema.$table"] -gt 0) { $managedData.Add($line) } else { $excluded++ }; continue }
    if ($type -eq 'SEQUENCE SET') { $managedData.Add($line); continue }
  }
  $excluded++
}
$orderedManaged = $managedData | Sort-Object { $m = [regex]::Match($_, $entry); $key = "$($m.Groups['schema'].Value) $(($m.Groups['rest'].Value -split ' ')[0])"; $i = [array]::IndexOf($parents, $key); if ($m.Groups['type'].Value -eq 'SEQUENCE SET') { 1000 } elseif ($i -ge 0) { $i } else { 500 } }

# Record target rows that existed before the restore (platform bootstrap and anything the operator created).
foreach ($line in $orderedManaged) { $m=[regex]::Match($line,$entry); if ($m.Groups['type'].Value -eq 'TABLE DATA') { $t="$($m.Groups['schema'].Value).$(($m.Groups['rest'].Value -split ' ')[0])"; $n=[int](Invoke-TargetQuery "select count(*) from $t"); if ($n -gt 0) { $preexisting[$t]=$n } } }
if ($preexisting.ContainsKey('auth.users')) { throw 'RESTORE_TARGET_AUTH_NOT_EMPTY' }

# Single transaction: QuizBox schemas (definitions + data) and managed-schema data; post-data constraints run after all data.
$listFile = Join-Path (Split-Path -Parent $Archive) 'restore-list.txt'
$pre = New-Object System.Collections.Generic.List[string]; $post = New-Object System.Collections.Generic.List[string]
$seenData = $false
foreach ($line in $owned) { $t=[regex]::Match($line,$entry).Groups['type'].Value; if ($t -in @('TABLE DATA','SEQUENCE SET')) { $seenData=$true }; if (-not $seenData) { $pre.Add($line) } else { $post.Add($line) } }
$ownedData = $post | Where-Object { [regex]::Match($_,$entry).Groups['type'].Value -in @('TABLE DATA','SEQUENCE SET') }
$ownedPost = $post | Where-Object { [regex]::Match($_,$entry).Groups['type'].Value -notin @('TABLE DATA','SEQUENCE SET') }
@($pre) + @($ownedData) + @($orderedManaged) + @($ownedPost) | Set-Content -LiteralPath $listFile -Encoding ascii
# pg_dump records object grants relative to PostgreSQL's built-in defaults, not the project's default privileges.
# A Supabase target auto-grants anon/authenticated/service_role on new objects, which would keep grants production
# revoked. Neutralize the restoring role's defaults so restored ACLs equal production; the archive's own DEFAULT ACL
# entries then reinstate production's defaults at the end of the restore.
$defaults = @('tables','functions','sequences')
foreach ($kind in $defaults) { Invoke-TargetQuery "alter default privileges for role postgres in schema public revoke all on $kind from anon, authenticated, service_role" | Out-Null }
try {
  & pg_restore --single-transaction --exit-on-error --no-owner --host $env:PGHOST --username $env:PGUSER --dbname postgres --use-list $listFile $Archive
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_RESTORE_FAILED' }
} catch {
  foreach ($kind in $defaults) { Invoke-TargetQuery "alter default privileges for role postgres in schema public grant all on $kind to anon, authenticated, service_role" | Out-Null }
  throw
}

# Execution log only; the restore receipt is written by verify-restore.ts after every check passes.
$log=@{status='EXECUTED';sourceProject='fmgccmqxfjppqydkhaiu';targetProject=$ref;archiveSha256=$expected.ToLowerInvariant();checkedAt=[DateTime]::UtcNow.ToString('o');
  restoredSchemas=@('public','quizbox_private','auth','storage');managedSchemas=$managed;managedBootstrapExcluded=$bootstrap;preexistingRows=$preexisting;
  restoredEntries=$pre.Count+$post.Count+$orderedManaged.Count;excludedEntries=$excluded}
$log | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $Archive) 'restore-execution.json') -Encoding ascii
Write-Output "RESTORE_EXECUTED: $($pre.Count+$post.Count) QuizBox entries, $($orderedManaged.Count) managed data entries, $excluded platform definitions excluded; run verify-restore.ts"
