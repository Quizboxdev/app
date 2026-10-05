import ProgressCard from "@/components/ProgressCard";
import StatusBadge from "@/components/StatusBadge";
import type { ScoreRow } from "@/lib/school/insights";

// Grade/class results as ProgressCards. `evidence` (assessed learners) stops a thin sample reading as mastery;
// a row with nobody assessed is shown as "No results yet" instead of a 0% bar.
export default function SchoolScoreCards({ rows, href, action }: { rows: ScoreRow[]; href: string; action: string }) {
  return <div className="qb-subject-list">{rows.map((r) => {
    const coverage = `${r.assessed} of ${r.learners} learner${r.learners === 1 ? "" : "s"} assessed`;
    const detail = [r.teacher !== undefined ? (r.teacher ?? "No teacher") : null, coverage].filter(Boolean).join(" · ");
    if (r.average == null) return <article key={r.key} className="qb-subject">
      <div className="qb-subject-head"><h3>{r.name}</h3><StatusBadge status="neutral" tone="neutral" label="No results yet" /></div>
      <div className="qb-subject-foot"><span className="qb-muted qb-small">{detail}</span></div>
    </article>;
    return <ProgressCard key={r.key} name={r.name} percentage={r.average} evidence={r.assessed} detail={detail} href={href} action={action} />;
  })}</div>;
}
