# Security Policy

## Supported versions

Office ONE is distributed as a Windows desktop application. Only the latest
released version receives security fixes.

| Version | Supported |
|---|---|
| 10.x | Yes |
| < 10.0 | No |

## Reporting a vulnerability

Please report security issues **privately**, not as a public issue.

Use GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
— open the **Security** tab of this repository and choose *Report a vulnerability*.

Please include the affected version, your platform, what an attacker gains, and
the steps to reproduce. A proof of concept helps but is not required.

Expect an initial response within 7 days. If a report is confirmed, you will be
credited in the release notes unless you ask otherwise.

## Threat model

Office ONE is **fully offline**. There is no application server, no cloud sync,
and no outbound network access — the renderer's Content-Security-Policy sets
`connect-src 'none'`. Data lives in one local SQLite database in the operating
system's per-user application data folder.

What this means for reports:

- **In scope:** escaping the renderer sandbox or the context-isolation boundary;
  bypassing the IPC argument contracts or the trusted-sender check; reading or
  writing another account's data; path traversal out of the data directory
  through an upload, a document, or a backup restore; HTML sanitizer bypasses in
  the Knowledge Hub; recovering a stored credential without the ability to
  decrypt it; authentication or login-throttling bypass; corrupting the database
  through a crafted backup bundle.

- **Out of scope by design:**
  - **Any attacker who already runs code as the signed-in Windows user.**
    Client credentials are encrypted at rest with Electron's `safeStorage`,
    which on Windows wraps the key with DPAPI for that user account. This
    protects the database against offline inspection — a copied `.db` file is
    not readable elsewhere — but code running as the same OS user can request
    decryption by design. OS account security and full-disk encryption are part
    of the deployment, not of this application.
  - **There is no administrator tier.** Any authenticated account may perform
    any action, including backup restore and account management. This is a
    deliberate design decision for a small trusted team: the safeguard is
    attribution, not permission, and shared-data changes are recorded against
    the acting account. "A non-admin user can do X" is not a vulnerability here.
  - **There is no network password reset.** Lockout recovery is deliberately
    manual and local, and requires filesystem access to the database.
  - Vulnerabilities in a modified build, or ones that require the user to
    disable the sandbox or context isolation.

## Handling your own data

- A Full Backup taken **with a passphrase** re-wraps stored credentials in a
  portable, passphrase-derived form so the bundle restores on another machine.
  A backup taken **without** one is only as portable as the machine key that
  encrypted it.
- The `Local State` file beside the database holds the DPAPI-wrapped encryption
  key. It is not a disposable cache — moving a database without it makes every
  stored credential permanently unreadable.

## Verifying a release

Released installers are Authenticode-signed once signing credentials are
configured for the release workflow; until then they are unsigned and Windows
SmartScreen warns on first run. Every release publishes `SHA256SUMS.txt` and a
CycloneDX SBOM — check the checksum in all cases, and the signature when the
release is a signed one:

```powershell
Get-ChildItem *.exe | Get-FileHash -Algorithm SHA256
Get-ChildItem *.exe | Get-AuthenticodeSignature | Format-List Path, Status
```
