import { SOURCE_LABEL, sourceOf } from "@/lib/learning/work-source";

// A small label on a piece of work saying who gave it: School (a teacher) or Family (a parent or guardian).
export default function SourceChip({ row }: { row: Parameters<typeof sourceOf>[0] }) {
  const s = sourceOf(row);
  return <span className="qb-chip" style={{ minHeight: 22, padding: "0 8px", fontSize: 11.5, marginInlineStart: 6, background: s === "family" ? "var(--blue-tint, #eaf2ff)" : undefined, borderColor: s === "family" ? "var(--blue, #2563eb)" : undefined }}>{SOURCE_LABEL[s]}</span>;
}
