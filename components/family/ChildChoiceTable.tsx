"use client";

// "Who is it for, and what does each get?": a tick list of children where each ticked child has their own choice (a coin amount, or a subscription plan), with Select all and "Same for everyone".
// Different children can need different things, so nothing is shared unless the parent asks for it. Used by Coins and Subscriptions.
export type ChoiceRow = { id: string; name: string; detail?: string; note?: string; disabled?: boolean };
export type Choice = { value: string; label: string; cost?: string };
export type Picks = Record<string, string>;   // child id -> chosen value; a child who is not in here is not ticked

export default function ChildChoiceTable({ legend, rows, choices, picks, onChange, choiceLabel, bulkLabel = "Same for everyone" }: { legend: string; rows: ChoiceRow[]; choices: Choice[]; picks: Picks; onChange: (p: Picks) => void; choiceLabel: string; bulkLabel?: string }) {
  const usable = rows.filter((r) => !r.disabled);
  const ticked = usable.filter((r) => picks[r.id] !== undefined);
  const all = usable.length > 0 && ticked.length === usable.length;
  const first = choices[0]?.value ?? "";
  const toggle = (id: string) => { const next = { ...picks }; if (next[id] !== undefined) delete next[id]; else next[id] = Object.values(picks)[0] ?? first; onChange(next); };
  const setAll = (value: string) => { const next: Picks = {}; for (const r of usable) next[r.id] = value; onChange(next); };
  return (
    <fieldset style={{ border: "1px solid var(--line-control, #cbd5e1)", borderRadius: 12, padding: 12, margin: 0, display: "grid", gap: 10 }}>
      <legend style={{ padding: "0 6px", fontWeight: 600 }}>{legend}</legend>
      {usable.length > 1 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <label className="qb-check" style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
            <input type="checkbox" checked={all} onChange={() => (all ? onChange({}) : setAll(Object.values(picks)[0] ?? first))} /> Select all ({usable.length})
          </label>
          <label className="qb-muted qb-small" style={{ display: "flex", gap: 6, alignItems: "center" }}>{bulkLabel}
            <select aria-label={bulkLabel} value="" onChange={(e) => { if (e.target.value) setAll(e.target.value); }}><option value="">Choose…</option>{choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
          </label>
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", opacity: r.disabled ? 0.55 : 1 }}>
          <label className="qb-check" style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 180 }}>
            <input type="checkbox" checked={picks[r.id] !== undefined} disabled={r.disabled} onChange={() => toggle(r.id)} />
            <span><strong>{r.name}</strong>{r.detail ? <span className="qb-muted"> · {r.detail}</span> : null}{r.note ? <span className="qb-muted qb-small" style={{ display: "block" }}>{r.note}</span> : null}</span>
          </label>
          <select aria-label={`${choiceLabel} for ${r.name}`} disabled={r.disabled || picks[r.id] === undefined} value={picks[r.id] ?? ""} onChange={(e) => onChange({ ...picks, [r.id]: e.target.value })}>
            {picks[r.id] === undefined && <option value="">Not selected</option>}
            {choices.map((c) => <option key={c.value} value={c.value}>{c.label}{c.cost ? ` · ${c.cost}` : ""}</option>)}
          </select>
        </div>
      ))}
      <span className="qb-muted qb-small" role="status">{ticked.length ? `${ticked.length} child${ticked.length === 1 ? "" : "ren"} selected` : "Tick who you are buying for"}</span>
    </fieldset>
  );
}
