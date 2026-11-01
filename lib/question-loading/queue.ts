import { describeErrorMessage } from "@/lib/errors";
import type { LoadPlan } from "./plan";
import { alreadyLoaded, canContinue, type BatchState } from "./resume";

// The load queue: every chosen file is its own job (its own check, source, batch and result), so one bad file never takes the others down. This module decides, in plain
// words, what state each job is in and what the admin can do about it. The screen only shows what is decided here.
export type JobPhase = "checking" | "ready" | "continue" | "loaded-before" | "needs-source" | "blocked" | "running" | "done" | "stopped";
export type Tone = "ok" | "info" | "warn" | "bad" | "muted";
export type JobInput = {
  readError?: string | null;
  checked: boolean;                                                                          // the file has been checked against the curriculum
  plan: Pick<LoadPlan, "canLoad" | "blockers" | "unresolved" | "report"> | null;
  rowsCount: number;
  earlier: BatchState | null | undefined;                                                   // undefined = the database has not been asked yet
  sourceIds: string[];
  running: boolean;
  outcome: { ok: boolean; rowsLoaded?: number; rowsTotal?: number; message?: string } | null;
};
export type JobView = { phase: JobPhase; label: string; tone: Tone; runnable: boolean; detail?: string };

const n = (v: number) => v.toLocaleString("en-GB");

// One short sentence for a file that cannot be loaded yet: the first thing to fix, in plain words.
export function shortReason(plan: JobInput["plan"], readError?: string | null): string {
  if (readError) return describeErrorMessage(readError);
  if (!plan) return "The file could not be checked.";
  const errors = plan.report.issues.filter((i) => i.severity === "error");
  if (errors.length) {
    const first = errors[0];
    return `${n(plan.report.errorRows)} question${plan.report.errorRows === 1 ? " has" : "s have"} errors. First: row ${first.row}, ${describeErrorMessage(first.code)}${first.field ? ` (${first.field})` : ""}`;
  }
  const flag = plan.report.batchFlags.find((f) => f.severity === "error");
  if (flag) return `${describeErrorMessage(flag.code)} ${flag.detail}`.trim();
  if (plan.unresolved.length) return `${n(plan.unresolved.length)} question${plan.unresolved.length === 1 ? " is" : "s are"} not on the curriculum. First: row ${plan.unresolved[0].fileRow}, ${plan.unresolved[0].status.toLowerCase().replaceAll("_", " ")}.`;
  const b = plan.blockers.find((x) => !x.startsWith("QL_CHECK_FAILED")) ?? plan.blockers[0];
  return b ? describeErrorMessage(b.split(":")[0]) : "The file did not pass the checks.";
}

export function jobView(j: JobInput): JobView {
  if (j.outcome?.ok) return { phase: "done", label: `Loaded ${n(j.outcome.rowsLoaded ?? j.rowsCount)} into review`, tone: "ok", runnable: false };
  if (j.running) return { phase: "running", label: "Loading…", tone: "info", runnable: false };
  if (j.outcome && !j.outcome.ok) return { phase: "stopped", label: "Stopped", tone: "bad", runnable: true, detail: j.outcome.message };
  if (j.readError) return { phase: "blocked", label: "Cannot read this file", tone: "bad", runnable: false, detail: shortReason(null, j.readError) };
  if (!j.checked) return { phase: "checking", label: "Checking…", tone: "muted", runnable: false };
  if (!j.plan || !j.plan.canLoad) return { phase: "blocked", label: "Needs attention", tone: "bad", runnable: false, detail: shortReason(j.plan) };
  if (j.earlier === undefined) return { phase: "checking", label: "Checking…", tone: "muted", runnable: false };
  if (alreadyLoaded(j.earlier, j.rowsCount)) return { phase: "loaded-before", label: "Already loaded", tone: "muted", runnable: false, detail: `This exact file is already in the system (${(j.earlier!.status || "").toLowerCase()}, ${n(j.earlier!.rows_total)} questions).` };
  if (j.sourceIds.length === 0) return { phase: "needs-source", label: "Choose a source", tone: "warn", runnable: false, detail: "No approved source matches this file's subject. Tick the source the questions were written from." };
  if (canContinue(j.earlier, j.rowsCount)) return { phase: "continue", label: `Continue from question ${n(j.earlier!.rows_total + 1)}`, tone: "info", runnable: true, detail: `${n(j.earlier!.rows_total)} of ${n(j.rowsCount)} are already saved and will not be sent again.` };
  return { phase: "ready", label: "Ready to load", tone: "ok", runnable: true };
}

// The line above the queue: what will happen when the admin presses the button.
export function summarise(items: Array<{ view: JobView; rowsCount: number; savedRows?: number }>): { files: number; questions: number; ready: number; attention: number; line: string } {
  const run = items.filter((i) => i.view.runnable);
  const files = run.length, questions = run.reduce((a, i) => a + Math.max(0, i.rowsCount - (i.savedRows ?? 0)), 0);
  const attention = items.filter((i) => ["blocked", "needs-source"].includes(i.view.phase)).length;
  const already = items.filter((i) => i.view.phase === "loaded-before").length, done = items.filter((i) => i.view.phase === "done").length;
  const parts = [`${files} file${files === 1 ? "" : "s"} ready (${n(questions)} questions)`];
  if (attention) parts.push(`${attention} need${attention === 1 ? "s" : ""} attention`);
  if (already) parts.push(`${already} already loaded`);
  if (done) parts.push(`${done} loaded now`);
  return { files, questions, ready: files, attention, line: parts.join(" · ") };
}

// What each loaded batch is, and the one thing to do next. Every state has a way forward; none ends in a dead label.
export type BatchRow = { status: string; rows_total: number; rows_loaded: number; rows_rejected: number; report?: Record<string, unknown> | null };
export type BatchAction = "review" | "continue" | "discard" | "revoke" | "none";
export function batchView(b: BatchRow, approved: boolean): { label: string; tone: Tone; progress: string; action: BatchAction; hint: string } {
  const expected = Math.max(Number((b.report as { expected_rows?: unknown } | null | undefined)?.expected_rows) || 0, b.rows_total);
  const progress = `${n(b.rows_loaded)} of ${n(expected)}`;
  if (approved) return { label: "Live for learners", tone: "ok", progress, action: "revoke", hint: "Approved. Revoke to take it back to review." };
  switch (b.status) {
    case "LOADED": return { label: "Ready to review", tone: "info", progress, action: "review", hint: "Read a sample, then approve." };
    case "PARTIAL": return { label: "Ready to review (some rejected)", tone: "warn", progress, action: "review", hint: `${n(b.rows_rejected)} questions were rejected while loading. Review the rest.` };
    case "LOADING": return { label: "Stopped partway", tone: "warn", progress, action: "continue", hint: "Choose the same file again in Load questions and press Continue, or discard this batch." };
    case "DISCARDED": return { label: "Discarded", tone: "muted", progress, action: "none", hint: "Its questions were withdrawn. The file can be loaded again." };
    case "FAILED": return { label: "Failed", tone: "bad", progress, action: "discard", hint: "Nothing usable was loaded. Discard it, then load the file again." };
    default: return { label: "Not started", tone: "muted", progress, action: "discard", hint: "This batch never started loading." };
  }
}
