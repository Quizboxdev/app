# Collect what the eight accounts saved in the Drive vault and run the checker on it, here, in the real repository.
# Usage (PowerShell, from the repository folder):
#   .\scripts\question-bank\collect-outputs.ps1 -Vault "C:\path\to\QUizBox Questions Vault"
# -Vault is the vault folder as a normal folder on this PC: use Google Drive for desktop, or download the vault (or just its _outputs folder) from drive.google.com.
# It copies each account's returns\*.csv (one file per topic) into Questions Bank\_work\returns, skips files already processed, then runs bank.py assemble and status.
param([Parameter(Mandatory = $true)][string]$Vault)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$returns = Join-Path $repo "Questions Bank\_work\returns"
$done = Join-Path $returns "_done"
New-Item -ItemType Directory -Force $returns, $done | Out-Null
$outputs = Join-Path $Vault "_outputs"
if (-not (Test-Path $outputs)) { $outputs = Join-Path $Vault "Questions Bank\_outputs" }
if (-not (Test-Path $outputs)) { throw "No _outputs folder found under $Vault" }
$new = 0; $skipped = 0
foreach ($acct in Get-ChildItem $outputs -Directory | Where-Object { $_.Name -match '^A[1-8]$' }) {
  $src = Join-Path $acct.FullName "returns"
  if (-not (Test-Path $src)) { continue }
  foreach ($f in Get-ChildItem $src -Filter *.csv -File) {
    if ((Test-Path (Join-Path $done $f.Name)) -or (Test-Path (Join-Path $returns $f.Name))) { $skipped++; continue }
    Copy-Item $f.FullName $returns; $new++
  }
  Write-Host ("{0}: {1}" -f $acct.Name, (Get-Content (Join-Path $acct.FullName "progress.csv") -ErrorAction SilentlyContinue | Measure-Object -Line).Lines)
}
Write-Host "$new new topic files copied, $skipped already processed."
if ($new -gt 0) { Push-Location $repo; python scripts/question-bank/bank.py assemble; Pop-Location }
Push-Location $repo; python scripts/question-bank/bank.py status; Pop-Location
