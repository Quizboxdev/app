import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Action = { label: string; href: string };

export default function DashboardHero({ eyebrow, title, description, primary, secondary, stats }: {
  eyebrow: string;
  title: string;
  description: string;
  primary: Action;
  secondary?: Action;
  stats?: Array<{ label: string; value: string | number }>;
}) {
  return (
    <section className="qb-dashboard-hero" aria-label={title}>
      <div className="qb-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {stats?.length ? <dl className="qb-hero-stats">{stats.map((s) => <div key={s.label}><dd>{s.value}</dd><dt>{s.label}</dt></div>)}</dl> : null}
      <div className="qb-actions">
        <Link className="qb-btn success" href={primary.href}>{primary.label}<ArrowRight size={16} aria-hidden="true" /></Link>
        {secondary && <Link className="qb-btn ghost" href={secondary.href}>{secondary.label}</Link>}
      </div>
    </section>
  );
}
