"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { deleteSchedule, listSchedules, setScheduleActive, WEEKDAYS, type Schedule } from "@/lib/api/schedules";
import { describeErrorMessage } from "@/lib/errors";
import { useWorkspaceFlags } from "@/components/WorkspaceProvider";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" }) : "—");
const STATUS: Record<string, string> = { PUBLISHED: "Sent", SKIPPED: "Skipped", MISSED: "Not sent in time" };

// The assignments a teacher has set to repeat every week. Each repeat is an ordinary assignment, so results, the gradebook and reminders work as usual.
export default function RepeatingAssignmentsPage() {
  const on = useWorkspaceFlags().repeat_assignments;
  const [rows, setRows] = useState<Schedule[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = useCallback(() => { listSchedules().then(setRows).catch((e: Error) => { setError(describeErrorMessage(e.message)); setRows([]); }); }, []);
  useEffect(load, [load]);

  async function act(id: string, what: "pause" | "resume" | "delete") {
    if (what === "delete" && !window.confirm("Stop repeating this assignment? Copies already sent stay with the class.")) return;
    setBusy(id); setError("");
    try {
      if (what === "delete") await deleteSchedule(id); else await setScheduleActive(id, what === "resume");
      load();
    } catch (e) { setError(describeErrorMessage((e as Error).message)); } finally { setBusy(""); }
  }

  return <>
    <div className="qb-page-head"><div><h1>Repeating assignments</h1>
      <p>Assignments that go out to a class every week, with fresh questions each time. Set one up when you publish on <Link href="/teacher/assignments/by-topic">Assign by subject and topic</Link>.</p></div></div>
    {error && <div className="qb-card qb-error" role="alert">{error}</div>}
    {!on && <div className="qb-card qb-muted" role="status">Repeating assignments are not switched on yet.</div>}
    {rows === null ? <p className="qb-muted">Loading…</p> : rows.length === 0 ? <div className="qb-card"><p className="qb-muted">You have no repeating assignments.</p></div>
      : <div className="qb-table-wrap"><table className="qb-table"><caption className="qb-sr-only">Your repeating assignments</caption>
        <thead><tr><th>Assignment</th><th>Class</th><th>Goes out</th><th>Next</th><th>Last</th><th></th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td><strong>{r.title}</strong><br/><span className="qb-muted qb-small">{r.subjects.join(", ")} · {r.total} questions · {r.mode === "PRACTICE" ? "Practice" : "Assessment"}</span></td>
          <td>{r.class_name}</td>
          <td>Every {WEEKDAYS[r.publish_dow - 1]} at {r.publish_time}<br/><span className="qb-muted qb-small">{r.due_after_days} day{r.due_after_days === 1 ? "" : "s"} to finish</span></td>
          <td>{r.active ? when(r.next_run_at) : <span className="qb-muted">Paused</span>}</td>
          <td>{r.last_status ? STATUS[r.last_status] : "Not sent yet"}{r.last_run_at ? <><br/><span className="qb-muted qb-small">{when(r.last_run_at)}</span></> : null}
            {r.last_status === "SKIPPED" && r.last_error && <><br/><span className="qb-error qb-small">{describeErrorMessage(r.last_error)}</span></>}</td>
          <td><button className="qb-btn ghost qb-small" disabled={busy === r.id || (!on && !r.active)} onClick={() => void act(r.id, r.active ? "pause" : "resume")}>{r.active ? "Pause" : "Resume"}</button>{" "}
            <button className="qb-btn ghost qb-small" disabled={busy === r.id} onClick={() => void act(r.id, "delete")}>Stop</button></td>
        </tr>)}</tbody></table></div>}
  </>;
}
