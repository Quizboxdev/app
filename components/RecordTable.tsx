import StatusBadge from "@/components/StatusBadge";
import { formatDateTime, humanize, isUuid, shortId } from "@/lib/format";

// Renders an arbitrary list of records as a readable table: human column names, short IDs,
// formatted timestamps and status badges. Used where an API returns generic rows.
const STATUS_KEYS = /(^|_)(status|state|decision)$/;
const DATE_KEYS = /(_at|_on|_date|^date|_time)$/;

function cell(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return <span className="qb-muted">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (STATUS_KEYS.test(key) && typeof value === "string") return <StatusBadge status={value} />;
  if (DATE_KEYS.test(key)) return formatDateTime(value);
  if (isUuid(value)) return <span className="qb-mono" title={String(value)}>{shortId(value)}</span>;
  if (Array.isArray(value)) return value.length ? `${value.length} item${value.length === 1 ? "" : "s"}` : <span className="qb-muted">—</span>;
  if (typeof value === "object") return <span className="qb-muted">{Object.keys(value as object).length} fields</span>;
  return String(value);
}

export default function RecordTable({ rows, maxColumns = 8, empty = "No records." }: { rows: unknown[]; maxColumns?: number; empty?: string }) {
  const records = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  if (!records.length) return <div className="qb-empty">{empty}</div>;
  const keys = Array.from(new Set(records.flatMap((row) => Object.keys(row))))
    .sort((a, b) => Number(a === "id") - Number(b === "id"))
    .slice(0, maxColumns);
  return (
    <div className="qb-table-wrap">
      <table className="qb-table">
        <thead><tr>{keys.map((key) => <th key={key}>{humanize(key)}</th>)}</tr></thead>
        <tbody>{records.map((row, index) => <tr key={String(row.id ?? index)}>{keys.map((key) => <td key={key}>{cell(key, row[key])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
