"use client";

import { Table } from "./ui";
import { resultsCsv } from "@/lib/interschool/report";
import type { Results } from "@/lib/interschool/types";

// One finalised round: school standings, fixtures and the learners the viewer is allowed to see.
export default function ResultsView({ r, actions }: { r: Results; actions?: (candidate: NonNullable<Results["learners"]>[number]) => React.ReactNode }) {
  if (!r.finalised) return <div className="qb-card"><p>Results are published when the round is finalised.</p></div>;
  return (
    <>
      <p><button type="button" className="qb-link-btn" onClick={() => { const url = URL.createObjectURL(new Blob(["\ufeff" + resultsCsv(r)], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `results-${(r.division ?? "")}-${(r.round ?? "")}.csv`.replace(/[^A-Za-z0-9.-]+/g, "-"); a.click(); URL.revokeObjectURL(url); }}>Download these results (CSV)</button></p>
      {(r.fixtures?.length ?? 0) > 0 && <section className="qb-card"><h2>Fixtures</h2><Table head={["Home", "Score", "Away", "Winner"]}>{r.fixtures!.map((f, i) => <tr key={i}><td>{f.home}</td><td>{f.status === "CANCELLED" ? "Cancelled" : f.away ? `${f.home_score ?? 0} - ${f.away_score ?? 0}` : "Bye"}</td><td>{f.away ?? ""}</td><td>{f.winner ?? "Draw"}{f.note && f.note !== "bye" ? <div className="qb-muted qb-small">{f.note}</div> : null}</td></tr>)}</Table></section>}
      <section className="qb-card"><h2>Schools</h2><Table head={["Rank", "School", "Score", "Total", "Took part", "Through"]}>{(r.schools ?? []).map((s) => <tr key={s.institution_id}><td>{s.rank ?? "-"}</td><td>{s.school}{!s.eligible && <div className="qb-muted qb-small">Below the minimum number of learners</div>}</td><td>{s.score}</td><td>{s.total_score}</td><td>{s.present}/{s.entered}</td><td>{s.qualified ? "Yes" : "No"}</td></tr>)}</Table></section>
      <section className="qb-card"><h2>Learners</h2>{(r.learners?.length ?? 0) === 0 ? <p className="qb-muted">No learner results to show.</p> : (
        <Table head={["Rank", "Learner", "School", "Score", "Time", "Through", ...(actions ? [""] : [])]}>{r.learners!.map((l) => <tr key={l.candidate_id}><td>{l.rank ?? "-"}</td><td>{l.name}</td><td>{l.school ?? ""}</td><td>{l.absent ? "Absent" : `${l.score}/${l.max_score} (${l.percent}%)`}</td><td>{l.absent ? "" : `${Math.floor(l.seconds / 60)}m ${l.seconds % 60}s`}</td><td>{l.qualified ? "Yes" : "No"}</td>{actions && <td>{actions(l)}</td>}</tr>)}</Table>)}</section>
    </>
  );
}
