"use client";

import { useEffect, useMemo, useState } from "react";
import { AREAS, buildSwitchList, checkChange, needsExtraCare, type SwitchState } from "@/lib/admin/feature-switches";
import { listSwitchRows, setSwitch } from "@/lib/api/feature-switches";
import { formatDate } from "@/lib/format";
import { Kpi } from "@/components/admin/DataViz";

type Filter = "all" | "on" | "off" | "missing";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["on", "On"], ["off", "Off"], ["missing", "Not installed"]];

// Super admin screen: switch built features off and on again. A switch never deletes data, so a feature turned off can be turned back on later
// exactly as it was. Changes are saved with the existing staff-only save (audit logged) and reach people the next time they open or refresh a page.
export default function FeatureSwitchesPage() {
  const [list, setList] = useState<SwitchState[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all"), [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null), [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [last, setLast] = useState<{ key: string; name: string; on: boolean } | null>(null);

  const load = () => listSwitchRows().then((rows) => setList(buildSwitchList(rows))).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function change(s: SwitchState, on: boolean, undo = false) {
    setBusy(true); setError("");
    try {
      await setSwitch(s.key, on);
      setLast(undo ? null : { key: s.key, name: s.name, on });
      setOpen(null); setSure(false); await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  const shown = useMemo(() => (list ?? []).filter((s) => {
    if (filter === "on" && s.value !== true) return false;
    if (filter === "off" && !(s.installed && s.value !== true)) return false;
    if (filter === "missing" && s.installed) return false;
    const q = query.trim().toLowerCase();
    return !q || `${s.name} ${s.key} ${s.on}`.toLowerCase().includes(q);
  }), [list, filter, query]);

  const count = (fn: (s: SwitchState) => boolean) => (list ?? []).filter(fn).length;

  return (
    <div className="dx-page">
      <div className="dx-head"><div><h1>Feature switches</h1><p>Turn built features off to hide them from people, and back on later. Turning a feature off never deletes its data.</p></div></div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {last && <div className="qb-card" role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span>&ldquo;{last.name}&rdquo; is now <strong>{last.on ? "on" : "off"}</strong>. People see the change when they next open or refresh a page.</span>
        <button className="dx-btn sm" disabled={busy} onClick={() => { const s = list?.find((x) => x.key === last.key); if (s) void change(s, !last.on, true); }}>Undo</button>
      </div>}
      {!list ? <div className="qb-card qb-skeleton" style={{ minHeight: 120 }} aria-busy="true" /> : <>
        <div className="dx-kpis">
          <Kpi label="On" value={count((s) => s.value === true)} />
          <Kpi label="Off" value={count((s) => s.installed && s.value !== true)} />
          <Kpi label="Not installed here" value={count((s) => !s.installed)} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "16px 0" }}>
          <div className="dx-seg-control" role="group" aria-label="Show switches">
            {FILTERS.map(([f, label]) => <button key={f} className={`dx-seg-btn${filter === f ? " is-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>)}
          </div>
          <input className="qb-input" type="search" placeholder="Search switches" aria-label="Search switches" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 260 }} />
        </div>
        {shown.length === 0 && <div className="qb-card">No switches match.</div>}
        {AREAS.map((area) => {
          const items = shown.filter((s) => s.area === area);
          if (!items.length) return null;
          return <section key={area} className="qb-card" style={{ marginTop: 16 }}>
            <h2>{area}</h2>
            <div style={{ display: "grid", gap: 0 }}>
              {items.map((s) => {
                const turnOn = s.value !== true;
                const { blocked, affects } = checkChange(s, turnOn, list);
                const isOpen = open === s.key;
                return <div key={s.key} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "start", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <strong>{s.name}</strong>
                        <span className={`dx-pill ${!s.installed ? "warn" : s.value ? "ok" : ""}`}>{!s.installed ? (s.screenOnly ? "Off (not saved yet)" : "Not installed here") : s.value ? "On" : "Off"}</span>
                        {s.kind === "payments" && <span className="dx-pill public">Money</span>}
                        {s.kind === "safety" && <span className="dx-pill public">Safety</span>}
                      </div>
                      <p className="qb-muted qb-small" style={{ margin: "4px 0 0" }}><strong>On:</strong> {s.on}</p>
                      <p className="qb-muted qb-small" style={{ margin: "2px 0 0" }}><strong>Off:</strong> {s.off}</p>
                      <p className="qb-muted qb-small" style={{ margin: "2px 0 0" }}>
                        <code>{s.key}</code>{s.requires?.length ? ` · needs ${s.requires.map((k) => list.find((x) => x.key === k)?.name ?? k).join(", ")}` : ""}{s.updatedAt ? ` · last changed ${formatDate(s.updatedAt)}` : ""}
                      </p>
                    </div>
                    <button className={`dx-btn${turnOn ? " primary" : ""}`} disabled={busy || !s.canChange} aria-expanded={isOpen}
                      onClick={() => { setOpen(isOpen ? null : s.key); setSure(false); }}>{turnOn ? "Turn on" : "Turn off"}</button>
                  </div>
                  {!s.canChange && <p className="qb-small" style={{ margin: "6px 0 0" }}>This feature is not installed on this database yet. It can be switched once its migrations are applied.</p>}
                  {isOpen && <div className="qb-card" style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    <p style={{ margin: 0 }}>{turnOn ? s.on : s.off}</p>
                    {blocked.map((b) => <div key={b} className="dx-alert error" role="alert">{b}</div>)}
                    {affects.length > 0 && <div className="dx-alert" role="note">These depend on it and will stop working until it is back on: {affects.join(", ")}.</div>}
                    {needsExtraCare(s) && blocked.length === 0 && <label><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand this changes {s.kind === "payments" ? "payments" : "a safety rule"} for everyone.</label>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className={`dx-btn ${turnOn ? "primary" : "danger"}`} disabled={busy || blocked.length > 0 || (needsExtraCare(s) && !sure)} onClick={() => void change(s, turnOn)}>{turnOn ? `Yes, turn on ${s.name}` : `Yes, turn off ${s.name}`}</button>
                      <button className="dx-btn" disabled={busy} onClick={() => setOpen(null)}>Cancel</button>
                    </div>
                  </div>}
                </div>;
              })}
            </div>
          </section>;
        })}
        <p className="qb-muted qb-small" style={{ marginTop: 16 }}>Each change is recorded in the audit log. A switch only hides what its feature checks; older core features (Challenges, Competitions, Classroom) have no switch yet.</p>
      </>}
    </div>
  );
}
