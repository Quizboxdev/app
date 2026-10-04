import { humanize, statusTone, type StatusTone } from "@/lib/format";

// One badge for every workflow status, so colours mean the same thing on every screen.
export default function StatusBadge({ status, tone, label }: { status: unknown; tone?: StatusTone; label?: string }) {
  const resolved = tone ?? statusTone(status);
  return <span className={`qb-pill ${resolved === "info" ? "" : resolved}`.trim()}>{label ?? humanize(status)}</span>;
}
