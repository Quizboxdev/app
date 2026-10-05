import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import MasteryBadge from "@/components/MasteryBadge";
import { masteryLevel } from "@/lib/learning/mastery";

const FILL = { Mastered: "var(--green)", Proficient: "var(--chart-1)", Developing: "var(--gold)", "Needs Work": "var(--red-error)" } as const;

// One subject or class: score bar + level + the next step. Colour is never the only signal (the level is spelled out).
// `badge` swaps the default mastery badge (e.g. a proficiency band for a class average); `children` adds role-specific detail below the bar.
export default function ProgressCard({ name, percentage, detail, evidence, badge, children, href, action = "Practise" }: { name: string; percentage: number; detail?: string; evidence?: number; badge?: ReactNode; children?: ReactNode; href: string; action?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(percentage)));
  return (
    <article className="qb-subject">
      <div className="qb-subject-head">
        <h3>{name}</h3>
        {badge ?? <MasteryBadge percentage={pct} evidence={evidence} />}
      </div>
      <div className="qb-subject-bar" role="img" aria-label={`${name} ${pct}%`}>
        <span style={{ width: `${Math.max(3, pct)}%`, background: FILL[masteryLevel(pct, evidence)] }} />
      </div>
      {children}
      <div className="qb-subject-foot">
        <span className="qb-muted qb-small">{pct}%{detail ? ` · ${detail}` : ""}</span>
        <Link className="qb-link" href={href}>{action}<ChevronRight size={14} aria-hidden="true" /></Link>
      </div>
    </article>
  );
}
