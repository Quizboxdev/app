"use client";

// A tick list of children with "Select all". Used wherever a parent chooses who something is for (work now; coins and subscriptions next), so every screen behaves the same way.
// The parent can tick one child, several, or everyone; nothing is ticked by default, so nobody is picked by accident.
export type PickableChild = { id: string; name: string; detail?: string; disabled?: boolean; note?: string };

export default function ChildPicker({ legend, options, value, onChange }: { legend: string; options: PickableChild[]; value: string[]; onChange: (ids: string[]) => void }) {
  const usable = options.filter((c) => !c.disabled);
  const all = usable.length > 0 && usable.every((c) => value.includes(c.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset style={{ border: "1px solid var(--line-control, #cbd5e1)", borderRadius: 12, padding: 12, margin: 0, display: "grid", gap: 8 }}>
      <legend style={{ padding: "0 6px", fontWeight: 600 }}>{legend}</legend>
      {usable.length > 1 && (
        <label className="qb-check" style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
          <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : usable.map((c) => c.id))} /> Select all ({usable.length})
        </label>
      )}
      {options.map((c) => (
        <label key={c.id} className="qb-check" style={{ display: "flex", gap: 8, alignItems: "center", opacity: c.disabled ? 0.55 : 1 }}>
          <input type="checkbox" checked={value.includes(c.id)} disabled={c.disabled} onChange={() => toggle(c.id)} />
          <span><strong>{c.name}</strong>{c.detail ? <span className="qb-muted"> · {c.detail}</span> : null}{c.note ? <span className="qb-muted qb-small" style={{ display: "block" }}>{c.note}</span> : null}</span>
        </label>
      ))}
      <span className="qb-muted qb-small" role="status">{value.length ? `${value.length} selected` : "Tick who this is for"}</span>
    </fieldset>
  );
}
