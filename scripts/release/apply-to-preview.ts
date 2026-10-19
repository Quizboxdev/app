import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { previewSql } from "../../lib/operations/live-fixture";

// Brings the PREVIEW database (never production: previewSql refuses any other project) up to date with supabase/migrations, in order, one file at a time.
// Stops at the first error. Records each applied migration in supabase_migrations.schema_migrations so history stays truthful.
// Usage: npx tsx scripts/release/apply-to-preview.ts [--dry]
const dry = process.argv.includes("--dry");
const dir = join(__dirname, "../../supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const done = new Set(previewSql("select version from supabase_migrations.schema_migrations", { idempotent: true }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
const last = [...done].sort().at(-1) ?? "";
const pending = files.filter((f) => !done.has(f.slice(0, 14)) && f.slice(0, 14) > last);
console.log(`Preview history ends at ${last}; ${pending.length} migration(s) pending.`);
if (dry) { pending.forEach((f) => console.log(" -", f)); process.exit(0); }
for (const f of pending) {
  const version = f.slice(0, 14), name = f.slice(15, -4);
  const sql = readFileSync(join(dir, f), "utf8");
  try {
    previewSql(`${sql}\n;\ninsert into supabase_migrations.schema_migrations(version, name) values ('${version}', '${name.replace(/'/g, "''")}') on conflict do nothing;`);
    console.log("applied", f);
  } catch (e) { console.error("FAILED", f, e instanceof Error ? e.message : e); process.exit(1); }
}
console.log("Preview is up to date.");
