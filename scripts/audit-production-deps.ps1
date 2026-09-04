# Fails the build on a high or critical advisory in the production dependency
# tree, and survives an npm registry that is having a bad day.
#
# Shared by ci.yml and release.yml so the two cannot drift: a release must apply
# exactly the gate CI applies, and on 2026-09-04 it did not -- CI had been
# hardened while release.yml still carried the bare one-liner.
#
# Why this is not just `npm audit --omit=dev --audit-level=high`: that call
# reaches a service outside GitHub, so it is the likeliest step to fail for
# reasons that have nothing to do with the commit. That day npm's advisories
# endpoint was answering 503 and timing out, and the bare form failed two builds
# on a good commit.
#
# Retrying is only sound because the verdict is read out of the audit's own JSON
# rather than from an exit code. A registry that answers and reports a high or
# critical advisory fails on the first attempt and is never retried, so no real
# finding can be retried away. Exhausting the attempts still fails: this is a
# security gate, and an audit that could not be performed is not a passing one.
$ErrorActionPreference = 'Continue'
$PSNativeCommandUseErrorActionPreference = $false
$attempts = 3
$stderrLog = Join-Path ([System.IO.Path]::GetTempPath()) 'npm-audit-stderr.log'
for ($attempt = 1; $attempt -le $attempts; $attempt++) {
  # --fetch-timeout is well below npm's 300000ms default so a hung request is
  # retried rather than burning five minutes per attempt. It is not tight,
  # either: a healthy audit answers in about a second, but this same call took
  # 73s locally and 95s on the runner while the endpoint was degraded.
  $raw = npm audit --omit=dev --audit-level=high --json --fetch-timeout=120000 2>$stderrLog | Out-String
  $report = $null
  try { $report = $raw | ConvertFrom-Json } catch { }
  $counts = $report.metadata.vulnerabilities
  if ($null -ne $counts) {
    Write-Host "Audit completed: critical=$($counts.critical) high=$($counts.high) moderate=$($counts.moderate) low=$($counts.low)"
    if ($counts.critical -gt 0 -or $counts.high -gt 0) {
      Write-Host $raw
      throw "npm audit found $($counts.critical) critical and $($counts.high) high advisories in production dependencies."
    }
    exit 0
  }
  Write-Warning "Attempt $attempt of $attempts produced no usable audit report; the registry did not answer."
  if (Test-Path $stderrLog) { Get-Content $stderrLog | Write-Host }
  if ($attempt -lt $attempts) { Start-Sleep -Seconds (15 * $attempt) }
}
throw "npm audit could not reach the registry in $attempts attempts. Failing closed: an audit that did not run is not a passing audit."
