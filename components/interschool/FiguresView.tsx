"use client";

import { Row, Stat, Table } from "./ui";
import type { Figures } from "@/lib/interschool/types";

// Participation figures. Groups smaller than ten learners are not broken down.
export default function FiguresView({ f }: { f: Figures }) {
  return (
    <>
      <h3>Participation</h3>
      <Row>
        <Stat label="Schools registered" value={f.schools_registered} />
        <Stat label="Learners registered" value={`${f.registered_participants} of ${f.expected_participants}`} />
        <Stat label="Places funded" value={f.funded_participants} />
        <Stat label="Took part" value={f.took_part} />
        <Stat label="Page views" value={f.page_views} />
        <Stat label="Shares" value={f.shares} />
      </Row>
      {f.regions.length > 0 && <Table head={["Region", "Schools", "Learners"]}>{f.regions.map((r) => <tr key={r.region}><td>{r.region}</td><td>{r.schools}</td><td>{r.learners ?? "Fewer than 10"}</td></tr>)}</Table>}
      {f.rounds.length > 0 && <Table head={["Division", "Round", "Completed", "Completion", "Average score"]}>{f.rounds.map((r, i) => <tr key={i}><td>{r.division}</td><td>{r.round}</td><td>{r.completed} of {r.eligible}</td><td>{r.completion_percent ?? 0}%</td><td>{r.average_percent === null ? "Too few to show" : `${r.average_percent}%`}</td></tr>)}</Table>}
      {Object.keys(f.sources).length > 0 && <p className="qb-muted qb-small">Registrations by source: {Object.entries(f.sources).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ")}</p>}
    </>
  );
}
