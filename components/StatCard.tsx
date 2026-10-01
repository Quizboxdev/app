export default function StatCard({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="qb-card">
      <div className="qb-stat-value">{value}</div>
      <div className="qb-stat-label">{label}</div>
    </div>
  );
}
