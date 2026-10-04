import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Action = { label: string; href: string };

export default function DashboardHero({ eyebrow, title, description, primary, secondary }: {
  eyebrow: string;
  title: string;
  description: string;
  primary: Action;
  secondary?: Action;
}) {
  return (
    <section className="qb-dashboard-hero" aria-label={title}>
      <div className="qb-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="qb-actions">
        <Link className="qb-btn success" href={primary.href}>{primary.label}<ArrowRight size={16} aria-hidden="true" /></Link>
        {secondary && <Link className="qb-btn ghost" href={secondary.href}>{secondary.label}</Link>}
      </div>
    </section>
  );
}
