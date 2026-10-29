"""Parses .env.acceptance.local (KEY=VALUE lines and the free-text account lines) WITHOUT printing any value.
Writes: creds.json (role -> list of {email, passwords}) and devenv.json (env for the local dev server)."""
import json, os, re, sys
root = r"C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment"
import tempfile
scratch = os.environ.get('QB_AUDIT_SCRATCH') or os.path.join(tempfile.gettempdir(), 'qb-audit'); os.makedirs(scratch, exist_ok=True)   # never inside the repository
env, accounts, skipped = {}, [], 0
for raw in open(os.path.join(root, ".env.acceptance.local"), encoding="utf-8", errors="replace"):
    line = raw.strip()
    if not line or line.startswith("#"): continue
    m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"').strip("'"); continue
    em = re.search(r"[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", line)
    if not em:
        if "@" in line: skipped += 1
        continue
    rest = line.replace(em.group(0), " ", 1)
    role = next((r for r in ("Admin", "Teacher", "Sponsor", "Student") if re.search(r, rest, re.I)), None)
    if not role:
        skipped += 1; continue
    rest = re.sub(role, " ", rest, count=1, flags=re.I)
    cands = [t for t in re.split(r"\s+-\s+|\s*:\s*|\s+", rest.strip()) if t and t != "-"]
    accounts.append({"role": role.upper(), "email": em.group(0), "passwords": cands})
prod_ref = env.get("QB_PRODUCTION_PROJECT_REF", "")
url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
assert env.get("QB_ACCEPTANCE_PROJECT_REF") and env["QB_ACCEPTANCE_PROJECT_REF"] in url, "acceptance ref not in URL"
assert prod_ref not in url, "URL points at production - refusing"
devenv = {k: v for k, v in env.items() if k.startswith("NEXT_PUBLIC_") or k.startswith("QB_")}
devenv.update({"SUPABASE_SERVICE_ROLE_KEY": "disabled-in-audit", "PAYSTACK_SECRET_KEY": "disabled-in-audit", "RESEND_API_KEY": "disabled-in-audit"})
json.dump(accounts, open(os.path.join(scratch, "creds.json"), "w"))
json.dump(devenv, open(os.path.join(scratch, "devenv.json"), "w"))
print("lines with an @ that could not be read as an account:", skipped)
print("accounts parsed:", [(a["role"], len(a["passwords"])) for a in accounts])
print("env keys passed to dev server:", sorted(devenv))
print("supabase host is acceptance project:", env["QB_ACCEPTANCE_PROJECT_REF"] in url)
