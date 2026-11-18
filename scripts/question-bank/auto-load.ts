import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { findLoadBatchByHash, listApprovedSources, loadCurriculumIndex, runQuestionLoad } from "../../lib/api/question-loading";
import { reviewFile, reviewSample } from "../../lib/question-loading/auto-review";
import { parsePlan, type PlanEntry } from "../../lib/question-loading/auto-plan";
import { buildLoadPayload } from "../../lib/question-loading/payload";
import { buildPlan } from "../../lib/question-loading/plan";
import { jobView } from "../../lib/question-loading/queue";
import { readQuestionFile } from "../../lib/question-loading/read";
import { canContinue, createPacer } from "../../lib/question-loading/resume";
import { isMissingFunction, runSteps } from "../../lib/question-loading/steps";
import { sourcesForSubjects } from "../../lib/question-loading/sources";
import type { BatchPreview } from "../../lib/api/owner";

// PREVIEW ONLY. A scheduled loop that loads the staged question files into the Preview database, one hourly session after another, and approves each batch when a rule check of its random
// sample of 20 passes. It signs in as a Preview super admin with QB_ADMIN_EMAIL / QB_ADMIN_PASSWORD (a test account) and needs no one at the keyboard.
//
// What it does NOT do: read the questions. The approval it makes is recorded as SCRIPT_CHECKED (migration 20261118100000): the questions carry human_reviewed = false and a note saying no person read the
// sample, so nothing in the system claims a human or a subject expert looked at them. Any approval can be revoked in Admin > Question batches (one click, the whole batch).
// A batch whose sample fails a rule is left in review for a person, and the loop carries on with the next file.
//
// Usage: npx tsx scripts/question-bank/auto-load.ts --plan <LOAD_PLAN_Preview.csv> [--root <folder the plan's file paths are relative to>] [--curriculum <id> | --curriculum-code GH-SBC-2019]
//        [--session <n>] [--max-files <n>] [--once] [--no-approve] [--dry-run] [--stop-file <path>] [--env-file <path>]
//   --once        stop at the first wait for the next clock hour (instead of waiting for it), for a scheduler that starts the script every hour
//   --no-approve  load into review only
//   --dry-run     sign in, read the files and say what would happen; nothing is written
//   Stop it at any time by creating the stop file (default: auto-load.STOP next to the plan) or pressing Ctrl+C: a started file continues from where the database says it stopped.
// Environment: QB_ADMIN_EMAIL, QB_ADMIN_PASSWORD, and the Preview project's public (anon) key as QB_PREVIEW_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY in --env-file when its URL is the Preview project).
const PREVIEW_REF = "fngdtxayfoiffbcbmcum";
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const n = (v: number) => v.toLocaleString("en-GB");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

type FileState = { file: string; batch_id?: string; loaded_at?: string; rows_loaded?: number; approval?: "approved" | "review_failed" | "not_attempted" | "needs_person"; basis?: string; approved_at?: string; note?: string };
const hourLimit = (e: unknown) => /QB_RATE_LIMITED|QB_CONTENT_RATE_LIMIT|Too many requests/i.test((e as Error)?.message ?? "");
const slow = (e: unknown) => /57014|statement timeout/i.test((e as Error)?.message ?? "");

async function main() {
  const planPath = option("--plan");
  if (!planPath) { console.error("Usage: npx tsx scripts/question-bank/auto-load.ts --plan <LOAD_PLAN_Preview.csv> [options]  (see the header of this file)"); process.exit(2); }
  const plan = resolve(planPath), root = resolve(option("--root") ?? dirname(plan));
  const stopFile = resolve(option("--stop-file") ?? join(dirname(plan), "auto-load.STOP"));
  const logFile = join(dirname(plan), "auto-load.log"), stateFile = join(dirname(plan), "auto-load.state.json"), csvFile = join(dirname(plan), "auto-load-progress.csv"), lockFile = join(dirname(plan), "auto-load.lock"), flaggedFile = join(dirname(plan), "auto-load-flagged-rows.csv");
  const once = flag("--once"), approveOn = !flag("--no-approve"), dry = flag("--dry-run");
  const log = (m: string) => { const line = `${new Date().toISOString().slice(0, 19).replace("T", " ")}Z  ${m}`; console.log(line); try { appendFileSync(logFile, line + "\n"); } catch { /* the console still has it */ } };

  // One loop at a time: a second start (for example the hourly scheduler while the first is waiting) leaves at once.
  const heartbeat = () => writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
  if (existsSync(lockFile)) {
    try { const l = JSON.parse(readFileSync(lockFile, "utf8")); if (Date.now() - l.at < 10 * 60_000) { console.log(`Another loop is running (process ${l.pid}, heartbeat ${Math.round((Date.now() - l.at) / 1000)} s ago). Leaving.`); return; } } catch { /* a broken lock is stale */ }
  }
  if (!dry) heartbeat();
  const release = () => { try { if (!dry && existsSync(lockFile)) unlinkSync(lockFile); } catch { /* nothing to do */ } };
  process.on("SIGINT", () => { log("Stopped by Ctrl+C. A file that was loading continues from where the database says it stopped on the next run."); release(); process.exit(130); });

  const email = process.env.QB_ADMIN_EMAIL, password = process.env.QB_ADMIN_PASSWORD;
  if (!email || !password) { console.error("Set QB_ADMIN_EMAIL and QB_ADMIN_PASSWORD (a Preview super admin test account)."); release(); process.exit(2); }
  const env = readEnvFile(resolve(option("--env-file") ?? ".env.local"));
  const envMatches = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(`${PREVIEW_REF}.`);
  const anonKey = (process.env.QB_PREVIEW_ANON_KEY ?? (envMatches ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined) ?? "").replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (!anonKey || anonKey.startsWith("sb_secret_")) { console.error("Set QB_PREVIEW_ANON_KEY to the Preview project's PUBLIC (anon or publishable) key."); release(); process.exit(2); }

  const entries = parsePlan(readFileSync(plan, "utf8"));
  const wrong = entries.filter((e) => e.environment && e.environment.toLowerCase() !== "preview");
  if (wrong.length) { console.error(`This loop is for Preview only, but the plan has ${wrong.length} line(s) for another environment (${wrong[0].environment}). Use the Preview plan.`); release(); process.exit(2); }
  const only = option("--session") ? Number(option("--session")) : null;
  const queue: PlanEntry[] = entries.filter((e) => only === null || e.session === only);
  const maxFiles = option("--max-files") ? Number(option("--max-files")) : Infinity;
  if (!queue.length) { console.error("The plan has no files for that selection."); release(); process.exit(2); }

  const state: Record<string, FileState> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
  const saveState = () => {
    if (dry) return;
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    writeFileSync(csvFile, ["seq,session,file,rows_planned,batch_id,rows_loaded,loaded_at,approval,basis,approved_at,note",
      ...entries.map((e) => { const s = state[e.file] ?? { file: e.file }; return [e.seq, e.session, q(e.file), e.rows, s.batch_id ?? "", s.rows_loaded ?? "", s.loaded_at ?? "", s.approval ?? "", s.basis ?? "", s.approved_at ?? "", q(s.note)].join(","); })].join("\n"));
  };

  const db = createClient(`https://${PREVIEW_REF}.supabase.co`, anonKey, { auth: { persistSession: false, autoRefreshToken: true } });
  let signedAt = 0;
  async function ensureSignedIn() {
    if (Date.now() - signedAt < 40 * 60_000) return;
    const r = await db.auth.signInWithPassword({ email: email!, password: password! });
    if (r.error) throw new Error(`Could not sign in to Preview as ${email}: ${r.error.message}`);
    signedAt = Date.now();
  }
  async function wait(ms: number, why: string) {
    const end = Date.now() + ms; let lastNote = 0;
    log(`${why} Waiting about ${Math.ceil(ms / 60_000)} minutes.`);
    while (Date.now() < end) {
      if (existsSync(stopFile)) return;
      if (!dry) heartbeat();
      await sleep(Math.min(30_000, end - Date.now()));
      if (Date.now() - lastNote >= 600_000 && end - Date.now() > 0) { lastNote = Date.now(); log(`  still waiting, about ${Math.ceil((end - Date.now()) / 60_000)} minutes left`); }
    }
  }
  const nextHour = () => (Math.floor(Date.now() / 3_600_000) + 1) * 3_600_000 + 20_000;

  try {
    await ensureSignedIn();
    log(`Signed in to PREVIEW (${PREVIEW_REF}) as ${email}. Plan: ${plan} (${queue.length} file(s)${only !== null ? `, session ${only}` : ""}). Mode: ${dry ? "DRY RUN" : "LOAD"}${approveOn ? " + script-checked approval" : ", no approval"}.`);
    const curricula = await db.rpc("qb_market_setup", { p_action: "curricula", p_data: {} });
    if (curricula.error) throw new Error(`Could not read the curricula (is this a content admin?): ${curricula.error.message}`);
    const list = (curricula.data ?? []) as Array<{ curriculum_id: string; code: string; name: string; market_id: string | null }>;
    const curriculum = option("--curriculum") ? list.find((c) => c.curriculum_id === option("--curriculum")) : list.find((c) => c.code === (option("--curriculum-code") ?? "GH-SBC-2019"));
    if (!curriculum || !curriculum.market_id) throw new Error(`No usable curriculum found (${list.map((c) => c.code).join(", ") || "none"}). Pass --curriculum <id>.`);
    const index = await loadCurriculumIndex(curriculum.curriculum_id, db);
    const sources = await listApprovedSources(curriculum.curriculum_id, db);
    log(`Curriculum ${curriculum.code}: ${n(index.all.length)} indicators, ${sources.length} approved sources.`);
    if (!index.all.length) throw new Error("This curriculum has no learning indicators loaded.");

    const pacer = createPacer();
    let loaded = 0, approved = 0, failedReview = 0, skipped = 0, processed = 0, hadError = false;

    async function approvalOf(batchId: string) {
      const { data } = await db.from("question_batch_approvals").select("id,status,in_progress,basis").eq("batch_id", batchId).eq("status", "ACTIVE").maybeSingle();
      return data as { id: string; in_progress: boolean; basis: string } | null;
    }
    const callApprove = async (batchId: string, note: string, sample: number) => {
      const { data, error } = await db.rpc("qb_owner_approve_batch_step", { p_batch: batchId, p_note: note, p_sample_reviewed: sample, p_publish: true, p_limit: 100, p_basis: "SCRIPT_CHECKED" });
      if (error) throw Object.assign(new Error(error.message), { code: error.code, rawMessage: error.message });
      return data as { done: boolean; approved: number; skipped?: number; basis?: string };
    };

    // Reviews and approves one loaded batch. Returns false when a person must take over (the sample failed a rule).
    async function approveBatch(s: FileState, rows: Parameters<typeof reviewFile>[0], fileRows: number[]) {
      const batchId = s.batch_id!;
      const held = await approvalOf(batchId);
      if (held && !held.in_progress) { s.approval = "approved"; s.basis = held.basis; return; }
      if (held && held.in_progress) {
        if (dry) { log("  (dry run) an approval is unfinished; would finish it"); return; }
        const r = await runSteps(() => callApprove(batchId, "", 0));      // an interrupted approval: the database continues it with its own basis
        s.approval = "approved"; s.basis = r.basis ?? held.basis; s.approved_at = new Date().toISOString(); log(`  finished an unfinished approval: ${n(r.approved)} questions live`); return;
      }
      const { data, error } = await db.rpc("qb_owner_batch_preview", { p_batch: batchId });
      if (error) throw new Error(`Could not draw the sample: ${error.message}`);
      const v = reviewSample(data as BatchPreview);
      if (!v.pass) { s.approval = "review_failed"; s.note = v.note; failedReview++; log(`  NOT approved, left in review for a person: ${v.flags.slice(0, 4).join("; ")}${v.flags.length > 4 ? ` (+${v.flags.length - 4} more)` : ""}`); return; }
      // The whole file, not only the sample: a sample of 20 misses a file that is 1 to 2% bad.
      const fv = reviewFile(rows, fileRows);
      log(`  Full-file check: ${fv.summary}.`);
      if (fv.flagged.length) {
        const header = existsSync(flaggedFile) ? "" : "file,file_row,reason,approved_anyway\n";
        try { appendFileSync(flaggedFile, header + fv.flagged.map((f) => `"${s.file.split("/").pop()}",${f.fileRow},"${f.flags.join("; ").replace(/"/g, "'")}",${fv.hold || dry ? "no" : "yes"}`).join("\n") + "\n"); } catch { /* the log still has the summary */ }
      }
      if (fv.hold) { s.approval = "review_failed"; s.note = `Held for a person by the full-file check: ${fv.summary}. Rows are listed in auto-load-flagged-rows.csv.`.slice(0, 1000); failedReview++; log(`  NOT approved, left in review for a person: more than 1% of the rows break a rule.`); return; }
      if (dry) { log(`  (dry run) sample of ${v.checked} passed; would approve`); return; }
      const note = fv.flagged.length ? `${v.note} Full-file check: ${fv.summary}; those rows are listed for retirement or repair.`.slice(0, 1000) : `${v.note} Full-file check: ${fv.summary}.`.slice(0, 1000);
      const r = await runSteps(() => callApprove(batchId, note, v.checked), { onStep: (x) => { if (!x.done) log(`  approving: ${n(x.approved)} so far`); } });
      s.approval = "approved"; s.basis = r.basis ?? "SCRIPT_CHECKED"; s.approved_at = new Date().toISOString(); s.note = note; approved++;
      log(`  APPROVED ${n(r.approved)} questions (${n(r.skipped ?? 0)} left in review), basis ${s.basis}. They are live on Preview.`);
    }

    for (const entry of queue) {
      if (processed >= maxFiles) { log(`Reached --max-files ${maxFiles}.`); break; }
      if (existsSync(stopFile)) { log(`Stop file found (${stopFile}). Stopping before ${entry.file}.`); break; }
      const s: FileState = state[entry.file] ?? (state[entry.file] = { file: entry.file });
      if (s.approval === "approved" || s.approval === "review_failed" || s.approval === "needs_person") { skipped++; continue; }   // finished earlier; remove its line from auto-load.state.json to retry
      processed++;
      log(`\n[${entry.seq}] session ${entry.session}  ${entry.grade} ${entry.subject}  ${entry.kind}  ${n(entry.rows)} rows  ${entry.file}`);
      let bytes: Uint8Array;
      try { bytes = new Uint8Array(await readFile(join(root, entry.file))); } catch (e) { log(`  CANNOT READ the file: ${(e as Error).message}`); s.note = "file missing"; hadError = true; continue; }
      const hash = createHash("sha256").update(bytes).digest("hex");

      for (let waits = 0, retries = 0; ; ) {
        try {
          await ensureSignedIn();
          const parsed = await readQuestionFile(entry.file.split("/").pop()!, bytes);
          const jobPlan = buildPlan({ rows: parsed.rows, fileRows: parsed.fileRows, fileSha256: hash, scope: "CURRICULUM", index });
          const earlier = jobPlan.canLoad ? await findLoadBatchByHash(hash, db) : null;
          const sourceIds = sourcesForSubjects(sources, [...new Set(parsed.rows.map((r) => r.subject).filter(Boolean))]);
          const view = jobView({ readError: null, checked: true, plan: jobPlan, rowsCount: parsed.rows.length, earlier, sourceIds, running: false, outcome: null });
          if (view.runnable) {
            if (dry) { log(`  (dry run) would load: ${view.label}`); break; }
            const resume = earlier && canContinue(earlier, parsed.rows.length) ? { batchId: earlier.id, fromRow: earlier.rows_total } : undefined;
            const r = await runQuestionLoad({ payload: buildLoadPayload(jobPlan, parsed.rows), fileName: entry.file.split("/").pop()!.slice(0, 280), fileSha256: hash, marketId: curriculum.market_id!, curriculumId: curriculum.curriculum_id,
              sourceIds, resume, pacer, db, onProgress: (d, t) => { heartbeat(); if (d % 1000 < 250 || d === t) log(`  loading ${n(d)} of ${n(t)}`); }, onWait: () => heartbeat() });
            if (!(r.status === "LOADED" || r.status === "PARTIAL")) { log(`  NOTHING USABLE LOADED (${r.status})${r.row_errors[0] ? `: row ${r.row_errors[0].row} ${r.row_errors[0].code}` : ""}`); s.note = `load failed: ${r.status}`; hadError = true; break; }
            s.rows_loaded = r.rows_loaded; loaded++;
            log(`  LOADED ${n(r.rows_loaded)} of ${n(r.rows_total)} into review${r.rows_rejected ? ` (${r.rows_rejected} rejected)` : ""}`);
          } else if (view.phase === "loaded-before") {
            log(`  already loaded earlier (${view.label}).`);
          } else { log(`  SKIPPED: ${view.label}${view.detail ? ` - ${view.detail}` : ""}`); s.note = `${view.label}${view.detail ? ` - ${view.detail}` : ""}`; hadError = true; break; }

          const batch = await findLoadBatchByHash(hash, db);
          if (!batch) { log("  The batch was not found after loading; leaving it."); hadError = true; break; }
          s.batch_id = batch.id; s.loaded_at = s.loaded_at ?? new Date().toISOString();
          if (approveOn) await approveBatch(s, parsed.rows, parsed.fileRows); else s.approval = "not_attempted";
          break;
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          if (isMissingFunction(e) && /approve_batch_step/i.test(msg)) { log("STOPPED: the database does not have migration 20261118100000 (script-checked approval) yet. Apply it to Preview first. Nothing was approved the old way."); throw e; }
          if (slow(e) && retries++ < 4) { log(`  The database was too slow for one request (nothing from it was saved). Waiting 60 seconds, then trying again (${retries} of 4).`); await sleep(60_000); continue; }
          if (hourLimit(e) && waits++ < 12) {
            if (once) { log(`The hour's import allowance is used up. --once given, so stopping here; the scheduler starts the loop again next hour. (${msg.split(" (Technical")[0]})`); saveState(); release(); return; }
            await wait(nextHour() - Date.now(), "The hour's allowance of 30 import requests is used up."); if (existsSync(stopFile)) break; log(`Continuing ${entry.file}`); continue;
          }
          log(`  STOPPED on this file: ${msg}`); s.note = msg.slice(0, 300); hadError = true; break;
        }
      }
      saveState();
    }

    const done = entries.filter((e) => state[e.file]?.approval === "approved").length;
    log(`\nThis run: ${loaded} file(s) loaded, ${approved} approved, ${failedReview} left in review for a person, ${skipped} already finished before. Plan so far: ${done} of ${entries.length} files approved.${hadError ? " Some files had problems: see the lines above." : ""}`);
    if (failedReview || hadError) process.exitCode = 3;
  } finally {
    saveState(); release();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
