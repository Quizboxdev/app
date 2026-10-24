"""Starts the Next dev server on port 3100 against the PREVIEW Supabase project (values from devenv.json; production keys in .env.local are overridden)."""
import json, os, subprocess
root = r"C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment"
import tempfile
scratch = os.environ.get('QB_AUDIT_SCRATCH') or os.path.join(tempfile.gettempdir(), 'qb-audit'); os.makedirs(scratch, exist_ok=True)   # never inside the repository
env = dict(os.environ); env.update(json.load(open(os.path.join(scratch, "devenv.json"))))
env["NEXT_TELEMETRY_DISABLED"] = "1"
subprocess.run(["npx", "next", "dev", "-p", "3100"], cwd=root, env=env, shell=True)
