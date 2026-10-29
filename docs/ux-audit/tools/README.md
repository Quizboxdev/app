# Audit tools

Run these only against the **Preview** database. They never touch production: `prepare_audit_env.py` refuses to continue if the Supabase URL in `.env.acceptance.local` is the production project, and it replaces the production service-role, Paystack and Resend keys with dummy values for the local dev server.

| File | Purpose |
|---|---|
| `prepare_audit_env.py` | Reads `.env.acceptance.local` (KEY=value lines and the free-text account lines) and writes `creds.json` and `devenv.json` to a folder **outside the repository** (`QB_AUDIT_SCRATCH`, default `%TEMP%\qb-audit`). Prints no values. |
| `run_audit_dev.py` | Starts `next dev` on port 3100 using `devenv.json`. |
| `cred_server.js` | Serves the accounts on `127.0.0.1:3199` so the browser tool can fill the login form without a password appearing in a command. Stop it when finished. |
| `signin.js` | Signs in as one role through the real sign-in form (edit `ROLE` and `INDEX`). |
| `sweep.js` | Visits a list of routes at 360/390/768/1440 px; screenshots, axe-core, console errors, overflow, LCP/CLS. |

Account lines in `.env.acceptance.local` should be `KEY=value` (for example `QB_TEST_STUDENT_EMAIL=`, `QB_TEST_STUDENT_PASSWORD=`) so tools never have to guess. Never commit credentials; `.gitignore` here excludes the two generated files.
