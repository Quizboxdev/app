"use client";

import { useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Building blocks for data-centric admin pages: compact key figures, ranked bars, a split bar, a trend curve, and small controls.
// Rules followed (dataviz method): thin marks, a 2px gap between touching segments, 4px rounded data ends, one baseline, direct value labels, a legend whenever there are two or more series,
// text in text colours (never the series colour), hover titles on every mark, and a table view as the fallback. Colours come from the app's chart tokens and were checked with the palette validator.
// Four categorical colours in a fixed order (blue, amber, purple, green); checked together with the palette validator (all checks pass). "none" is the neutral grey for "not set" / "not yet".
export const SERIES = { a: "var(--chart-1)", b: "var(--amber)", c: "var(--purple)", d: "var(--green)", none: "var(--ink-faint)" } as const;
const nf = new Intl.NumberFormat("en-GB");
export const num = (n: number) => nf.format(n);

export function Kpi({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint?: string; tone?: "default" | "warn" }) {
  return (
    <div className={`dx-kpi${tone === "warn" ? " is-warn" : ""}`}>
      <div className="dx-kpi-label">{label}</div>
      <div className="dx-kpi-value">{typeof value === "number" ? num(value) : value}</div>
      {hint && <div className="dx-kpi-hint">{hint}</div>}
    </div>
  );
}

export function Panel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`dx-panel ${className}`.trim()} aria-label={title}>
      <header className="dx-panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <ul className="dx-legend" aria-label="Legend">{items.map((i) => <li key={i.label}><span className="dx-swatch" style={{ background: i.color }} aria-hidden="true" />{i.label}</li>)}</ul>;
}

export type BarRow = { key: string; label: string; segments: { value: number; color: string; name: string }[] };

// Ranked horizontal bars (segments stack, 2px apart). Click a row to filter by it. Shows the first rows and a "Show all" switch.
export function RankedBars({ rows, active, onPick, limit = 8, unit = "schools" }: { rows: BarRow[]; active?: string; onPick?: (key: string) => void; limit?: number; unit?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)));
  return (
    <div className="dx-bars">
      {shown.map((r) => {
        const total = r.segments.reduce((s, x) => s + x.value, 0);
        const detail = `${r.label}: ${num(total)} ${unit}${r.segments.length > 1 ? " (" + r.segments.filter((s) => s.value > 0).map((s) => `${s.name} ${num(s.value)}`).join(", ") + ")" : ""}`;
        const Row = onPick ? "button" : "div";
        return (
          <Row key={r.key} className={`dx-bar-row${active === r.key ? " is-active" : ""}`} title={detail} aria-label={detail} {...(onPick ? { type: "button" as const, onClick: () => onPick(r.key), "aria-pressed": active === r.key } : {})}>
            <span className="dx-bar-label">{r.label}</span>
            <span className="dx-bar-track" aria-hidden="true">
              <span className="dx-bar-fill" style={{ width: `${(total / max) * 100}%` }}>
                {r.segments.filter((s) => s.value > 0).map((s) => <span key={s.name} className="dx-seg" style={{ flexGrow: s.value, background: s.color }} />)}
              </span>
            </span>
            <span className="dx-bar-value">{num(total)}</span>
          </Row>
        );
      })}
      {rows.length > limit && <button type="button" className="dx-link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
    </div>
  );
}

// One 100% bar with direct labels underneath (for example Private / Public / Not set).
export function SplitBar({ parts }: { parts: { name: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="dx-split" role="img" aria-label={parts.map((p) => `${p.name} ${num(p.value)}`).join(", ")}>
        {total === 0 ? <span className="dx-seg" style={{ flexGrow: 1, background: "var(--line)" }} /> : parts.filter((p) => p.value > 0).map((p) => <span key={p.name} className="dx-seg" title={`${p.name}: ${num(p.value)} (${Math.round((p.value / total) * 100)}%)`} style={{ flexGrow: p.value, background: p.color }} />)}
      </div>
      <ul className="dx-split-legend">
        {parts.map((p) => <li key={p.name}><span className="dx-swatch" style={{ background: p.color }} aria-hidden="true" /><b>{num(p.value)}</b> {p.name}{total > 0 && <span className="dx-muted"> · {Math.round((p.value / total) * 100)}%</span>}</li>)}
      </ul>
    </div>
  );
}

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Two curves over time (weeks). A crosshair tooltip on hover; the legend names both series.
export function TrendCurve({ data, series, height = 170 }: { data: { week: string; [k: string]: number | string }[]; series: { key: string; name: string; color: string }[]; height?: number }) {
  const empty = data.every((d) => series.every((s) => Number(d[s.key]) === 0));
  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
      <div style={{ width: "100%", height }} role="img" aria-label={`${series.map((s) => s.name).join(" and ")}, last ${data.length} weeks`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="week" tickFormatter={day} axisLine={false} tickLine={false} tick={{ fill: "var(--ink-muted)", fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "var(--ink-muted)", fontSize: 11 }} width={44} />
            <Tooltip labelFormatter={(l) => `Week of ${day(String(l))}`} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--line)", boxShadow: "0 4px 12px rgba(15,23,42,.08)" }} cursor={{ stroke: "var(--line-strong)" }} />
            {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--qb-surface, #fff)", strokeWidth: 2 }} strokeLinecap="round" strokeLinejoin="round" />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {empty && <p className="dx-muted dx-note">No activity in these weeks yet. Schools added by users and staff decisions will appear here.</p>}
    </div>
  );
}

// A compact segmented control (replaces large pill buttons).
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="dx-seg-control" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} className={value === o.value ? "dx-seg-btn is-on" : "dx-seg-btn"} onClick={() => onChange(o.value)}>{o.label}{o.count !== undefined && <span className="dx-count">{num(o.count)}</span>}</button>)}
    </div>
  );
}
