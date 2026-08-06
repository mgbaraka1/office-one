# Password recovery (administrator)

Office ONE is fully offline and has no email/SMS/network layer, so there is no
"forgot password" flow in the app itself. If the sole administrator forgets
their password, recovery is a manual, local procedure: generate a new bcrypt
hash and write it directly into the SQLite database on the machine that holds
it. This is safe and fully supported — it uses the same password-hashing
library (`bcryptjs`) and the same `node:sqlite` module the app itself uses,
just run by hand instead of through the UI.

This only works on the machine that has the data file. There is no remote or
cloud recovery path, by design (see AGENTS.md's Security section).

## Before you start

1. **Close the app completely.** Check no `electron.exe` process for this app
   is still running (Task Manager), so nothing else has the database file
   open while you edit it.
2. **Back up the database file first.** Copy
   `%APPDATA%\timesheet\cooperation-tools.db` (and its `-wal`/`-shm`
   companions, if present) somewhere safe before changing anything. If
   something goes wrong, restore this copy.
3. You'll need a terminal open **in the app's project/install directory**
   (wherever `node_modules` lives, since step 2 below uses `bcryptjs` and
   `node:sqlite` from there) and Node.js 24+ installed.

## Steps

**1. Generate a new bcrypt hash for a temporary password.** Pick a temporary
password you'll change immediately after logging back in. Run this from the
app's directory (it uses the app's own `bcryptjs` dependency, cost 12 — the
same the app itself uses):

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" "YourTempPassword123!"
```

This prints a hash starting with `$2a$12$…` or `$2b$12$…`. Copy the whole
string.

**2. Write the new hash into the database.** Close the app first (step 1
above), then run this from the app's directory, editing the file path and
username as needed:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(String.raw\`C:\Users\<you>\AppData\Roaming\timesheet\cooperation-tools.db\`);
const changes = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
  .run('PASTE_THE_HASH_FROM_STEP_1_HERE', 'the-admin-username').changes;
console.log('rows updated:', changes);
db.close();
"
```

`changes` should print `1`. If it prints `0`, the username didn't match —
check it against `SELECT username FROM users;` run the same way.

**3. Clear any active login lockout (if present).** Since a repeated wrong
password locks the account out for 30 seconds after 5 failed attempts, and
that lockout is now persisted across restarts (`machine_prefs` key
`login_failures` — a JSON object keyed by lowercased username), clear it so
you're not stuck waiting between attempts while testing:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(String.raw\`C:\Users\<you>\AppData\Roaming\timesheet\cooperation-tools.db\`);
db.prepare(\"DELETE FROM machine_prefs WHERE key = 'login_failures'\").run();
db.close();
"
```

**4. Start the app and log in** with the username and the temporary password
from step 1.

**5. Change the password immediately** from inside the app (the user-card
menu → change password, or User Management if you also want to review other
accounts), so the temporary password recorded in your shell history isn't
the account's long-term credential.

**6. Delete the backup copy from step "Before you start"** once you've
confirmed the account works normally again, or keep it if you'd rather retain
an extra recovery point — it's an exact prior snapshot of the whole database,
not just this one field.

## If there's no active user at all

If every account is deactivated (`is_active = 0` for everyone — this
shouldn't normally happen since the app refuses to let the last active
administrator be deactivated, but a manual DB edit elsewhere could in theory
cause it), reactivate one the same way: run step 2's `UPDATE` against
`is_active` and `is_admin` instead of `password_hash`:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(String.raw\`C:\Users\<you>\AppData\Roaming\timesheet\cooperation-tools.db\`);
db.prepare('UPDATE users SET is_active = 1, is_admin = 1 WHERE username = ?').run('the-admin-username');
db.close();
"
```

Then continue from step 1 above to also reset its password.
