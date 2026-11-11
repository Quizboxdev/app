import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { findLoadBatchByHash, listApprovedSources, loadCurriculumIndex, runQuestionLoad } from "../../lib/api/question-loading";
import { buildLoadPayload } from "../../lib/question-loading/payload";
import { buildPlan } from "../../lib/question-loading/plan";
import { jobView, summarise, type JobView } from "../../lib/question-loading/queue";
import { readQuestionFile } from "../../lib/question-loading/read";
import { CALLS_PER_MINUTE, CALL_ROWS, canContinue, createPacer } from "../../lib/question-loading/resume";
import { sourcesForSubjects } from "../../lib/question-loading/sources";

// Loads question files into a database from the command line, through exactly the same checks, planning, source matching, pacing and resume rules as the admin screen
// (Admin > Load questions). Every question goes to SME review; nothing is published. Approving the batches is a separate step in Admin > Question batches.
//
// Usage: npx tsx scripts/question-bank/load-questions.ts --target production|preview --dir <folder of .csv files> [--curriculum <id>] [--load]
//        [--env-file .env.local]   where the project's public URL and key are read from (default .env.local); the URL must belong to --target
//        [--anon-key <key>]        the project's public (anon) key; asked for when the env file does not hold the key of --target
// Without --load it only checks: it signs in as you, reads the curriculum, plans every file and prints what would happen. Nothing is written.
// With --load it asks you to type a confirmation phrase, then loads the files one after another. Stopped part-way? Run it again: finished files are skipped and an interrupted
// file continues from where the database says it stopped (the same file is recognised by its content hash, also by the admin screen).
const REFS = { production: "fmgccmqxfjppqydkhaiu", preview: "fngdtxayfoiffbcbmcum" } as const;
type Target = keyof typeof REFS;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const n = (v: number) => v.toLocaleString("en-GB");

function usage(): never {
  console.error("Usage: npx tsx scripts/question-bank/load-questions.ts --target production|preview --dir <folder of .csv files> [--curriculum <id>] [--load] [--env-file .env.local] [--anon-key <key>]");
  process.exit(2);
}

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((done) => {
    if (!hidden) { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(question, (a) => { rl.close(); done(a.trim()); }); return; }
    process.stdout.write(question);
    const stdin = process.stdin; let typed = "";
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") { stdin.setRawMode?.(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); done(typed); return; }
        if (c === "\u0003") process.exit(130);
        typed = c === "\u007f" || c === "\b" ? typed.slice(0, -1) : typed + c;
      }
    };
    stdin.on("data", onData);
  });
}

// Leaves cleanly: exiting while the keyboard handle is still closing crashes Node on Windows.
const quit = (code: number): Promise<never> => { process.stdin.pause(); setTimeout(() => process.exit(code), 150); return new Promise<never>(() => {}); };

async function main() {
  if (flag("--help") || flag("-h")) usage();
  const target = option("--target") as Target | undefined, dir = option("--dir");
  if (!target || !(target in REFS) || !dir) usage();
  const ref = REFS[target], doLoad = flag("--load");

  // The project: its address is fixed by --target, so a wrong environment file can never point the load at the other database.
  const env = readEnvFile(resolve(option("--env-file") ?? ".env.local"));
  const envUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const url = `https://${ref}.supabase.co`;
  const envMatches = envUrl.includes(`${ref}.`);
  let anonKey = option("--anon-key") ?? (envMatches ? (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) : undefined);
  if (!anonKey) {
    // The key is public (every page of the site carries it): Supabase dashboard > Project Settings > API Keys, the "anon" / publishable key of the ${target} project.
    console.log(`The env file does not point at the ${target.toUpperCase()} project (${ref}); it has ${envUrl || "no URL"}.`);
    anonKey = await ask(`Public (anon) key of the ${target.toUpperCase()} project: `, true);
  }
  anonKey = (anonKey ?? "").replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (!anonKey) { console.error("No key given."); return quit(2); }
  const keyKind = anonKey.startsWith("sb_publishable_") ? "publishable key" : anonKey.startsWith("eyJ") ? "legacy anon JWT" : anonKey.startsWith("sb_secret_") ? "SECRET key (wrong one!)" : "unknown format";
  console.log(`Key received: ${anonKey.length} characters, ${keyKind}.`);
  if (/^sb_secret_/.test(anonKey)) { console.error("That is a secret key. Use the public one (publishable / anon) instead."); return quit(2); }

  const files = (await readdir(dir)).filter((f) => /\.(csv|txt|xlsx)$/i.test(f)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!files.length) { console.error(`No .csv, .txt or .xlsx files in ${dir}`); return quit(2); }

  console.log("Loader version: waits for the hourly import allowance by itself (2026-11-11 d: also retries a slow-database request)");
  console.log(`Target: ${target.toUpperCase()} (${ref})   files: ${files.length} in ${resolve(dir)}   mode: ${doLoad ? "LOAD (after you confirm)" : "CHECK ONLY (nothing is written)"}`);
  const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: true } });
  const email = await ask("Admin e-mail: "), password = await ask("Password (hidden): ", true);
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) { console.error(`Could not sign in: ${signedIn.error.message}${/api key/i.test(signedIn.error.message) ? `
Supabase rejected the key. Copy the publishable (sb_publishable_...) or anon (eyJ...) key of project ${ref} from Project Settings > API Keys; a key from another project, or a disabled legacy key, is refused.` : ""}`); return quit(1); }
  const aal = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data && aal.data.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
    const factor = (await db.auth.mfa.listFactors()).data?.totp?.[0];
    if (!factor) { console.error("This account requires a second step but has no authenticator app set up."); return quit(1); }
    const code = await ask("Authenticator code: ");
    const verified = await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (verified.error) { console.error(`The code was refused: ${verified.error.message}`); return quit(1); }
  }

  const curricula = await db.rpc("qb_market_setup", { p_action: "curricula", p_data: {} });
  if (curricula.error) { console.error(`Could not read the curricula (is this account a content admin?): ${curricula.error.message}`); return quit(1); }
  const list = (curricula.data ?? []) as Array<{ curriculum_id: string; code: string; name: string; version: string; market_id: string | null; nodes: number | null; approved_sources: number | null }>;
  const chosen = option("--curriculum");
  const curriculum = list.find((c) => c.curriculum_id === chosen);
  if (!curriculum) {
    console.log(chosen ? `\nNo curriculum with id ${chosen}.` : "\nChoose a curriculum with --curriculum <id>:");
    for (const c of list) console.log(`  ${c.curriculum_id}  ${c.code} · ${c.name} (${c.version})   ${n(Number(c.nodes ?? 0))} nodes, ${n(Number(c.approved_sources ?? 0))} approved sources${c.market_id ? "" : "   NO MARKET"}`);
    return quit(chosen ? 1 : 0);
  }
  if (!curriculum.market_id) { console.error("This curriculum is not attached to a market, so questions cannot be loaded for it."); return quit(1); }
  console.log(`Curriculum: ${curriculum.code} · ${curriculum.name} (${curriculum.version})`);

  const index = await loadCurriculumIndex(curriculum.curriculum_id, db);
  const sources = await listApprovedSources(curriculum.curriculum_id, db);
  console.log(`${n(index.all.length)} learning indicators, ${sources.length} approved source${sources.length === 1 ? "" : "s"}.\n`);
  if (!index.all.length) { console.error("This curriculum has no learning indicators loaded."); return quit(1); }

  // One job per distinct file, planned and judged exactly as the admin screen does.
  type Job = { name: string; hash: string; rows: Awaited<ReturnType<typeof readQuestionFile>>["rows"]; plan: ReturnType<typeof buildPlan> | null; sourceIds: string[]; view: JobView; readError?: string };
  const jobs: Job[] = [], seen = new Set<string>();
  for (const name of files) {
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await readFile(join(dir, name))); } catch (e) { jobs.push({ name, hash: "", rows: [], plan: null, sourceIds: [], readError: (e as Error).message, view: jobView({ readError: (e as Error).message, checked: true, plan: null, rowsCount: 0, earlier: null, sourceIds: [], running: false, outcome: null }) }); continue; }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    try {
      const parsed = await readQuestionFile(name, bytes);
      const plan = buildPlan({ rows: parsed.rows, fileRows: parsed.fileRows, fileSha256: hash, scope: "CURRICULUM", index });
      const earlier = plan.canLoad ? await findLoadBatchByHash(hash, db) : null;
      const sourceIds = sourcesForSubjects(sources, [...new Set(parsed.rows.map((r) => r.subject).filter(Boolean))]);
      jobs.push({ name, hash, rows: parsed.rows, plan, sourceIds, view: jobView({ readError: null, checked: true, plan, rowsCount: parsed.rows.length, earlier, sourceIds, running: false, outcome: null }) });
    } catch (e) {
      jobs.push({ name, hash, rows: [], plan: null, sourceIds: [], readError: (e as Error).message, view: jobView({ readError: (e as Error).message, checked: true, plan: null, rowsCount: 0, earlier: null, sourceIds: [], running: false, outcome: null }) });
    }
  }

  for (const j of jobs) console.log(`${j.view.runnable ? "READY   " : "SKIP/FIX"}  ${j.name.padEnd(58)} ${String(j.rows.length).padStart(5)} q  ${String(j.plan?.topics.length ?? 0).padStart(3)} topics  ${j.view.label}${j.view.detail ? ` - ${j.view.detail}` : ""}`);
  const summary = summarise(jobs.map((j) => ({ view: j.view, rowsCount: j.rows.length })));
  console.log(`\n${summary.line}`);
  if (!doLoad) { console.log("\nCHECK ONLY: nothing was written. Add --load to load the READY files into SME review."); return; }
  if (summary.files === 0) { console.log("\nNothing to load."); return; }

  const minutes = Math.max(1, Math.ceil((Math.ceil(summary.questions / CALL_ROWS) + summary.files) / CALLS_PER_MINUTE));
  const phrase = `LOAD TO ${target.toUpperCase()}`;
  if ((await ask(`\nLoad ${summary.files} file(s), ${n(summary.questions)} questions, into ${target.toUpperCase()} (about ${minutes} minutes; they wait in SME review, nothing is published). Type  ${phrase}  to go ahead: `)) !== phrase) {
    console.log("Confirmation not given. Nothing was written."); return;
  }

  const pacer = createPacer();   // one pacer for the whole queue: the database limit is per person, not per file
  let loaded = 0, failed = false, lastPrint = 0;

  // The database also allows only 30 import requests per person per clock hour (qb_factory_import). That is a pause, not a failure: the refused request saved nothing, so wait for the
  // next hour to begin and send the same request again. The file's own saved-row count (not this program) decides where to continue.
  const hourLimit = (e: unknown) => /QB_RATE_LIMITED|QB_CONTENT_RATE_LIMIT|Too many requests/i.test((e as Error)?.message ?? "");
  async function waitForNextHour() {
    const now = Date.now(), next = (Math.floor(now / 3_600_000) + 1) * 3_600_000 + 20_000;
    console.log(`  The hour's allowance of 30 import requests is used up. Waiting until ${new Date(next).toISOString().slice(11, 16)} UTC (about ${Math.ceil((next - now) / 60_000)} minutes), then continuing by itself. Keep this window open and the computer awake.`);
    let lastNote = Date.now();
    for (let left = next - Date.now(); left > 0; left = next - Date.now()) {
      await new Promise((r) => setTimeout(r, Math.min(30_000, left)));
      if (Date.now() - lastNote >= 600_000 && next - Date.now() > 0) { lastNote = Date.now(); console.log(`  still waiting, about ${Math.ceil((next - Date.now()) / 60_000)} minutes left`); }
    }
  }

  async function loadOne(j: Job): Promise<boolean> {
    const held = await findLoadBatchByHash(j.hash, db), total = j.rows.length;
    const resume = held && canContinue(held, total) ? { batchId: held.id, fromRow: held.rows_total } : undefined;
    const r = await runQuestionLoad({ payload: buildLoadPayload(j.plan!, j.rows), fileName: j.name.slice(0, 280), fileSha256: j.hash, marketId: curriculum!.market_id!, curriculumId: curriculum!.curriculum_id,
      sourceIds: j.sourceIds, resume, pacer, db,
      onProgress: (d, t) => console.log(`  ${n(d)} of ${n(t)}`),
      onWait: (s) => { if (Date.now() - lastPrint > 25_000) { lastPrint = Date.now(); console.log(`  pausing (${s}s): the database accepts a limited number of requests a minute`); } } });
    const ok = r.status === "LOADED" || r.status === "PARTIAL";
    const notes = [r.rows_rejected ? `${n(r.rows_rejected)} rejected` : "", ...r.row_errors.slice(0, 5).map((e) => `row ${e.row}: ${e.code}`)].filter(Boolean).join("; ");
    console.log(`  ${ok ? "OK" : "NOTHING USABLE LOADED"}: ${r.status}, ${n(r.rows_loaded)} of ${n(r.rows_total)} in review${notes ? `  (${notes})` : ""}`);
    return ok;
  }

  for (const j of jobs.filter((x) => x.view.runnable)) {
    process.stdout.write(`\n${j.name}\n`);
    for (let waits = 0, slow = 0; ; waits++) {
      try {
        if (await loadOne(j)) loaded++; else failed = true;
        break;
      } catch (e) {
        // A request the database cancelled for taking over its time limit (57014) saved nothing; give it a minute and send the same request again, a few times at most.
        if (/57014|statement timeout/i.test((e as Error)?.message ?? "") && slow++ < 4) { console.log(`  The database was too slow for one request (nothing from it was saved). Waiting 60 seconds, then trying again (${slow} of 4).`); await new Promise((r) => setTimeout(r, 60_000)); continue; }
        if (hourLimit(e) && waits < 6) { console.log(`  Paused: ${(e as Error).message.split(" (Technical")[0]}`); await waitForNextHour(); console.log(`  Continuing ${j.name}`); continue; }
        console.error(`  STOPPED: ${(e as Error).message}`); failed = true; break;
      }
    }
    if (failed) break;
  }
  console.log(`\n${loaded} of ${summary.files} file(s) loaded into SME review.${failed ? " Stopped at the first problem: fix it (or send the message above), then run the same command again; finished files are skipped." : " Next: review and approve them in Admin > Question batches."}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); void quit(1); });
