# Copies the Office ONE data folder to D:\OfficeONE-Data and verifies it.
# COPIES, never moves: the source is left exactly as it is (it stays the recovery point).
param(
  [string]$Source = "$env:APPDATA\office-one",
  [string]$Dest   = 'D:\OfficeONE-Data'
)
$ErrorActionPreference = 'Stop'

# 1. Pre-checks
$running = Get-Process -Name 'Office ONE','electron' -ErrorAction SilentlyContinue
if ($running) { throw "Office ONE / electron is running (PID $($running.Id -join ', ')). Close it first." }
foreach ($f in 'cooperation-tools.db','Local State') {
  if (-not (Test-Path -LiteralPath (Join-Path $Source $f))) { throw "Source is missing '$f': $Source" }
}
if (Test-Path -LiteralPath (Join-Path $Dest 'cooperation-tools.db')) { throw "Destination already has a database: $Dest. Refusing to overwrite." }

# 2. Copy everything (DB, -wal/-shm if present, Local State, uploads, backups, UI prefs)
robocopy $Source $Dest /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NP | Out-Host
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE). Nothing in the source was changed." }

# 3. Verify
$ok = $true
foreach ($f in 'cooperation-tools.db','Local State') {
  $a = (Get-FileHash -LiteralPath (Join-Path $Source $f) -Algorithm SHA256).Hash
  $b = (Get-FileHash -LiteralPath (Join-Path $Dest   $f) -Algorithm SHA256).Hash
  $m = $a -eq $b; if (-not $m) { $ok = $false }
  '{0,-22} {1}  {2}' -f $f, ($(if ($m) {'MATCH'} else {'MISMATCH'})), $a
}
$sa = Get-ChildItem -LiteralPath $Source -Recurse -File -Force | Measure-Object Length -Sum
$da = Get-ChildItem -LiteralPath $Dest   -Recurse -File -Force | Measure-Object Length -Sum
$m = ($sa.Count -eq $da.Count) -and ($sa.Sum -eq $da.Sum); if (-not $m) { $ok = $false }
'{0,-22} {1}  source {2} files / {3} bytes, dest {4} files / {5} bytes' -f 'whole folder', ($(if ($m) {'MATCH'} else {'MISMATCH'})), $sa.Count, $sa.Sum, $da.Count, $da.Sum

if ($ok) { "`nVERIFIED. Start Office ONE: it should open on $Dest with all data and passwords." }
else     { "`nVERIFY FAILED. Do not start the app on $Dest. The source is untouched." ; exit 1 }
