<#
.SYNOPSIS
  Puts the next piece of SQL (or a git command block) on the Windows clipboard, ready to paste.

.DESCRIPTION
  Run from the project folder in PowerShell. Nothing here touches a database: it only copies text.
  You paste into Supabase, SQL Editor, press Run, then come back and press Enter for the next part.

  .\scripts\release\Copy-Sql.ps1 -List                       what exists, how many parts, notes
  .\scripts\release\Copy-Sql.ps1 -Fingerprint                read-only check, parts A then B: run on BOTH projects and compare
  .\scripts\release\Copy-Sql.ps1 -History                    read-only: which migrations the project has recorded
  .\scripts\release\Copy-Sql.ps1 -Migration 20261047100000   copy that migration (every part, one at a time)
  .\scripts\release\Copy-Sql.ps1 -Migration 20261030100000,20261031100000   several, in the order given
  .\scripts\release\Copy-Sql.ps1 -Rollback attempt_save_failure_log          the undo script for the newest migration
  .\scripts\release\Copy-Sql.ps1 -Git                        the git commands for the code release (choose a block)
  Add -NoPrompt to copy only the first piece and stop (used for testing).
#>
param(
  [switch]$List,
  [switch]$Fingerprint,
  [switch]$History,
  [string[]]$Migration,
  [string]$Rollback,
  [switch]$Git,
  [switch]$NoPrompt
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$parts = Join-Path $root "docs\release\sql-parts"
$index = Get-Content -Raw -Encoding UTF8 (Join-Path $parts "index.json") | ConvertFrom-Json

function Copy-Text([string]$text, [string]$what) {
  Set-Clipboard -Value $text
  Write-Host ("  Copied to clipboard: {0} ({1:N0} characters)" -f $what, $text.Length) -ForegroundColor Green
}
function Wait-Enter([string]$prompt) {
  if ($NoPrompt) { return "q" }
  return (Read-Host $prompt)
}
function Show-Project {
  Write-Host ""
  Write-Host "  Open the right Supabase project first:" -ForegroundColor Yellow
  Write-Host "    PREVIEW     fngdtxayfoiffbcbmcum   (apply here first)"
  Write-Host "    PRODUCTION  fmgccmqxfjppqydkhaiu"
  Write-Host "  Supabase, SQL Editor, New query, paste, Run. Expected: Success."
  Write-Host ""
}

if ($List -or (-not ($Fingerprint -or $History -or $Migration -or $Rollback -or $Git))) {
  Write-Host "`nMigrations from 20261020 (parts are pasted one at a time; 1 part = a single paste)`n"
  $index | ForEach-Object { "{0}  {1,-34} {2,2} part(s)  {3}" -f $_.version, $_.name, $_.parts, $_.note } | Write-Host
  Write-Host "`nRule: apply a migration to a project only when the fingerprint says MISSING there. Never re-run one that says ok or PARTIAL; send the result to be looked at.`n"
  return
}

if ($Fingerprint) {
  Show-Project
  foreach ($p in "A", "B") {
    $sql = Get-Content -Raw -Encoding UTF8 (Join-Path $root "docs\release\db_fingerprint_$p.sql")
    Copy-Text $sql "fingerprint part $p (read-only)"
    Write-Host "  Run it on this project, then copy the result table (or screenshot it)." -ForegroundColor Cyan
    if ((Wait-Enter "  Press Enter for the next part, q to stop") -eq "q") { return }
  }
  Write-Host "`n  Do the same on the other project and compare the 'status' column row by row.`n"
  return
}

if ($History) {
  $q = "-- Read-only. Which migrations this project has recorded (it can be empty if they were pasted by hand).`nselect version, name from supabase_migrations.schema_migrations where version >= '20261020' order by version;"
  Copy-Text $q "migration history query (read-only)"
  return
}

if ($Rollback) {
  $f = Join-Path $root "supabase\rollback\$Rollback.sql"
  if (-not (Test-Path $f)) { throw "No rollback file named $Rollback.sql in supabase\rollback" }
  Show-Project
  Copy-Text (Get-Content -Raw -Encoding UTF8 $f) "rollback: $Rollback"
  return
}

if ($Git) {
  $blocks = [ordered]@{
    "1 Preview: branch, stage the named files, commit, push (Vercel builds a Preview)" = @"
git checkout -b release/ux-and-resilience-2026-10-24
git --literal-pathspecs add --pathspec-from-file=scripts/release/release-files.txt
git status --short
git commit -m "UX audit fixes: accessibility, offline and save queue, caching, share cards, button system; release kit"
git push -u origin release/ux-and-resilience-2026-10-24
"@
    "2 Production: after Preview passes, move main to the same commit" = @"
git fetch origin
git merge-base --is-ancestor origin/main HEAD; if ($?) { 'OK: main can be fast-forwarded' } else { 'STOP: main has moved on, do not push' }
git push origin release/ux-and-resilience-2026-10-24:main
"@
    "3 Check nothing unrelated is staged (run before committing)" = @"
git diff --cached --name-only | Select-String -Pattern 'Questions Bank|Images/|scripts/question-bank|reports/|\.docx|\.xlsx|scratch/|evidence/'
"@
  }
  $keys = @($blocks.Keys)
  for ($i = 0; $i -lt $keys.Count; $i++) { Write-Host ("  " + $keys[$i]) }
  $pick = if ($NoPrompt) { "1" } else { Read-Host "`n  Which block to copy (1-3)" }
  $n = [int]$pick - 1
  if ($n -lt 0 -or $n -ge $keys.Count) { throw "Choose 1, 2 or 3" }
  Copy-Text $blocks[$keys[$n]] $keys[$n]
  return
}

# -Migration
Show-Project
foreach ($v in $Migration) {
  $m = $index | Where-Object { $_.version -eq $v }
  if (-not $m) { throw "Unknown migration $v. Run with -List to see the versions." }
  Write-Host ("`n=== {0}  {1}  ({2} part(s)) ===" -f $m.version, $m.name, $m.parts) -ForegroundColor Cyan
  if ($m.note) { Write-Host ("  NOTE: " + $m.note) -ForegroundColor Yellow }
  for ($i = 1; $i -le $m.parts; $i++) {
    $sql = Get-Content -Raw -Encoding UTF8 (Join-Path $parts "$v\p$i.sql")
    Copy-Text $sql ("{0} part {1} of {2}" -f $m.name, $i, $m.parts)
    $last = ($i -eq $m.parts)
    $ans = Wait-Enter ("  Pasted and ran with no error? Enter = " + $(if ($last) { "done with this migration" } else { "copy the next part" }) + ", q = stop here")
    if ($ans -eq "q") { Write-Host "  Stopped. If a part failed, send me its error text before running anything else." ; return }
  }
  Write-Host "  Finished $($m.name). Run the fingerprint again to confirm it now says ok." -ForegroundColor Green
}
