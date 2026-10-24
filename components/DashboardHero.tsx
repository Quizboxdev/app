import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Action = { label: string; href: string };

// `as="h1"` makes the title the page heading; other pages keep their own h1 next to the hero, so the default stays h2.
export default function DashboardHero({ eyebrow, title, description, primary, secondary, stats, as: Heading = "h2" }: {
  as?: "h1" | "h2";
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
      <Heading>{title}</Heading>
      <p>{description}</p>
      {stats?.length ? <dl className="qb-hero-stats">{stats.map((s) => <div key={s.label}><dd>{s.value}</dd><dt>{s.label}</dt></div>)}</dl> : null}
      <div className="qb-actions">
        <Link className="qb-btn success" href={primary.href}>{primary.label}<ArrowRight size={16} aria-hidden="true" /></Link>
        {secondary && <Link className="qb-btn ghost" href={secondary.href}>{secondary.label}</Link>}
      </div>
    </section>
  );
}
