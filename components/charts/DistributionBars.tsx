// Compact labelled horizontal bars for a categorical breakdown (roles, markets, statuses).
// Reads better than a pie for a handful of categories and stays legible on phones.
export default function DistributionBars({
  rows,
  empty,
  format = (value: number) => value.toLocaleString(),
}: {
  rows: { name: string; value: number }[];
  empty: string;
  format?: (value: number) => string;
}) {
  const data = rows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
  if (!data.length) return <div className="qb-empty"><strong>No data yet</strong>{empty}</div>;
  const max = Math.max(...data.map((row) => row.value));
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <ul className="qb-dist" aria-label={`Breakdown, ${total.toLocaleString()} total`}>
      {data.map((row) => (
        <li key={row.name}>
          <span className="qb-dist-name">{humanize(row.name)}</span>
          <span className="qb-dist-track" aria-hidden="true"><span className="qb-dist-fill" style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} /></span>
          <span className="qb-dist-value">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function humanize(name: string) {
  return /^[A-Z_]+$/.test(name) ? name.charAt(0) + name.slice(1).toLowerCase().replaceAll("_", " ") : name;
}
