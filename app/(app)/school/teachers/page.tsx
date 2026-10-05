"use client";
import { useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { useSchool } from "@/components/SchoolProvider";
import { humanize } from "@/lib/format";
import { isTeachingStaff, teacherLoad } from "@/lib/school/insights";

// Staff list with class assignments. Workload is class and learner count only; there is no evaluation scoring.
export default function SchoolTeachersPage() {
  const { overview } = useSchool();
  const [query, setQuery] = useState("");
  const load = useMemo(() => teacherLoad(overview), [overview]);
  const rows = useMemo(() => load.filter((t) => !query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase())), [load, query]);
  const teaching = load.filter(isTeachingStaff).length;

  return <>
    <div className="qb-page-head"><div><h1>Teachers</h1><p>{teaching} teaching staff · {load.length} members with school access</p></div></div>
    <section className="qb-card" aria-label="Teacher list">
      <div className="qb-content-filters"><div className="qb-field"><label htmlFor="t-search">Search teachers</label><input id="t-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
      {rows.length ? <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Teacher</th><th>Role</th><th>Active classes</th><th>Classes</th><th>Enrolments</th></tr></thead><tbody>
        {rows.map((t) => <tr key={t.userId}><td><strong>{t.name}</strong></td><td>{humanize(t.role)}</td><td>{t.classes.length || <StatusBadge status="info" tone="neutral" label="None" />}</td>
          <td>{t.classes.map((c) => c.name).join(", ")}</td><td>{t.learners}</td></tr>)}
      </tbody></table></div> : <div className="qb-empty"><strong>No teachers found</strong>{load.length ? "Clear the search to see all staff." : "Teachers added to your school appear here."}</div>}
    </section>
  </>;
}
