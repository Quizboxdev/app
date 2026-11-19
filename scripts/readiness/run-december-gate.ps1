# December 2026 release-readiness gate runner. PREVIEW (or a local scratch database) ONLY. It refuses Production.
#
# The gate (supabase/tests/december_readiness_gate.sql) creates a synthetic school, two teachers, learners, parents and a sponsor, runs 88 checks as the
# real browser roles (authenticated / anon) against the real RPCs and RLS policies, and then ROLLS BACK. Nothing is kept. Synthetic addresses end in @e2e.quizbox.invalid.
#
#   run-december-gate.ps1 -Target Preview          Preview database through the Preview pooler (asks for the Preview password)
#   run-december-gate.ps1 -Target Local            the throw-away scratch database from scripts/readiness/build-scratch-db.sh (localhost:55433, no password)
#   -Out <file>                                    also saves the output (default: gate-evidence-<target>-<time>.txt in the current folder)
param([Parameter(Mandatory = $true)][ValidateSet("Preview", "Local")][string]$Target, [string]$Out)
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$file = Join-Path $repo "supabase\tests\december_readiness_gate.sql"
if (-not (Test-Path $file)) { Write-Host "STOPPED: $file not found." -ForegroundColor Red; exit 1 }
$sql = Get-Content $file -Raw
if ($sql -notmatch "(?im)^rollback;\s*$" -or $sql -match "(?im)^\s*commit\s*;") { Write-Host "STOPPED: the gate file must end in ROLLBACK and contain no COMMIT." -ForegroundColor Red; exit 1 }
$PRODUCTION_REF = "fmgccmqxfjppqydkhaiu"; $PREVIEW_REF = "fngdtxayfoiffbcbmcum"
$env:PGPORT = "5432"; $env:PGDATABASE = "postgres"
if ($Target -eq "Preview") { $env:PGUSER = "postgres.$PREVIEW_REF"; $env:PGHOST = "aws-1-eu-central-1.pooler.supabase.com" }
else { $env:PGUSER = "postgres"; $env:PGHOST = "localhost"; $env:PGPORT = "55433"; $env:PGDATABASE = "qb_test" }
if ($env:PGUSER -match $PRODUCTION_REF -or $env:PGHOST -match "aws-0-eu-central-1") { Write-Host "STOPPED: this runner never touches Production." -ForegroundColor Red; exit 1 }
Write-Host "Target: $($Target.ToUpper())   user: $($env:PGUSER)   host: $($env:PGHOST)" -ForegroundColor Yellow
if ($Target -eq "Preview") {
  $sec = Read-Host "PREVIEW database password (typed text is hidden)" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $proof = & psql -X -t -A -c "select current_user" 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED: could not log in to Preview: $proof" -ForegroundColor Red; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; exit 1 }
  if ((Read-Host "Type  RUN GATE ON PREVIEW  (it writes synthetic rows and then rolls everything back)") -ne "RUN GATE ON PREVIEW") { Write-Host "Not confirmed. Nothing was run." -ForegroundColor Red; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; exit 1 }
}
if (-not $Out) { $Out = "gate-evidence-$($Target.ToLower())-$(Get-Date -Format 'yyyyMMdd-HHmm').txt" }
& psql -X -q -v ON_ERROR_STOP=1 -P pager=off -P format=unaligned -P fieldsep=" | " -f $file 2>&1 | Tee-Object -FilePath $Out | ForEach-Object { Write-Host $_ }
$code = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($code -ne 0) { Write-Host ""; Write-Host "The gate stopped with an error (see above). The transaction was rolled back; nothing was kept. Paste the output to Claude." -ForegroundColor Red; exit 1 }
Write-Host ""; Write-Host "Done. Nothing was kept. Evidence saved to $Out. Paste the lines above into the chat." -ForegroundColor Green
