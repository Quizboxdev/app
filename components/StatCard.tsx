import { BarChart3, type LucideIcon } from "lucide-react";

// Compact metric tile: label, value, optional hint. Missing values show a quiet "No data yet"
// instead of oversized placeholder text.
export function isEmptyMetric(value: unknown) {
  return value === null || value === undefined || value === "" || (typeof value === "string" && /not enough data|unavailable|^n\/a$/i.test(value));
}

export default function StatCard({
  value,
  label,
  hint,
  icon: Icon = BarChart3,
}: {
  value: string | number | null | undefined;
  label: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  const empty = isEmptyMetric(value);
  return (
    <div className="qb-card qb-stat">
      <div className="qb-stat-body">
        <div className="qb-stat-label">{label}</div>
        <div className={empty ? "qb-stat-value qb-stat-empty" : "qb-stat-value"}>{empty ? "No data yet" : value}</div>
        {hint && <div className="qb-stat-hint">{hint}</div>}
      </div>
      <span className="qb-iconbox" aria-hidden="true"><Icon size={18} /></span>
    </div>
  );
}
