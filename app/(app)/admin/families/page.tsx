"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { adminFamilies, adminFamilyDetail, cedis, type AdminFamilies, type AdminFamilyDetail } from "@/lib/api/family";
import { Kpi, Panel, RankedBars, SERIES, num } from "@/components/admin/DataViz";
import StaffFamilyVerifications from "@/components/admin/StaffFamilyVerifications";
import FamilyApplications from "@/components/admin/FamilyApplications";

// Staff: family workspaces at a glance, and one family in detail. Read-only: staff look without impersonating or changing anything, and parents' children are only shown by name and class.
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const STATUS_TONE: Record<string, string> = { fulfilled: "ok", paid: "ok", initiated: "warn", failed: "bad", refunded: "bad", mismatch: "bad", active: "ok", requested: "warn", revoked: "bad" };

export default function AdminFamiliesPage() {
  const [data, setData] = useState<AdminFamilies | null>(null), [error, setError] = useState(""), [search, setSearch] = useState("");
  const [open, setOpen] = useState(""), [detail, setDetail] = useState<AdminFamilyDetail | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => { adminFamilies().then(setData).catch((e: Error) => setError(/FORBIDDEN|staff/i.test(e.message) ? "Only staff can see families." : "Families could not be loaded. Please try again.")); }, []);
  useEffect(() => {
    if (!open) { setDetail(null); return; }
    let live = true; setLoading(true);
    adminFamilyDetail(open).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setDetail(null); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open]);

  const shown = useMemo(() => { const q = search.trim().toLowerCase(); return (data?.families ?? []).filter((f) => !q || `${f.owner} ${f.email}`.toLowerCase().includes(q)); }, [data, search]);
  const orderRows = Object.entries(data?.orders ?? {}).map(([k, v]) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), segments: [{ value: Number(v), color: k === "failed" || k === "refunded" || k === "mismatch" ? SERIES.b : SERIES.a, name: k }] }));
  const spendRows = [...(data?.families ?? [])].filter((f) => f.spent_minor > 0).sort((a, b) => b.spent_minor - a.spent_minor).slice(0, 8).map((f) => ({ key: f.workspace_id, label: f.owner, segments: [{ value: f.spent_minor / 100, color: SERIES.d, name: "Spent (GHS)" }] }));

  if (error) return <div className="dx-page"><div className="dx-alert error" role="alert">{error}</div></div>;
  if (!data) return <div className="dx-page"><p className="dx-muted" aria-busy="true">Loading families…</p></div>;
  return (
    <div className="dx-page">
      <div className="dx-head"><div><h1>Families</h1><p>Parent and guardian workspaces, the children linked to them, what they bought and the work they gave. Read-only, except the approvals below.</p></div></div>
      <StaffFamilyVerifications />
      <FamilyApplications />
      <div className="dx-kpis">
        <Kpi label="Family workspaces" value={num(data.workspaces)} />
        <Kpi label="Children linked" value={num(data.children_linked)} />
        <Kpi label="Waiting for a student" value={num(data.requests_waiting)} hint="link requests" tone={data.requests_waiting > 0 ? "warn" : "default"} />
        <Kpi label="Unused child links" value={num(data.invitations_waiting)} />
        <Kpi label="Family work given" value={num(data.family_assignments)} />
        <Kpi label="Paid by families" value={cedis(Number(data.paid_minor))} />
      </div>
      <div className="dx-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Panel title="Orders by state">{orderRows.length ? <RankedBars rows={orderRows} unit="orders" limit={6} /> : <p className="dx-muted dx-note">No orders yet.</p>}</Panel>
        <Panel title="Biggest spenders" subtitle="GHS paid, top 8">{spendRows.length ? <RankedBars rows={spendRows} unit="GHS" limit={8} /> : <p className="dx-muted dx-note">Nothing paid yet.</p>}</Panel>
      </div>
      <div className="dx-toolbar"><input className="dx-input" type="search" aria-label="Search families" placeholder="Search parent name or email" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="dx-table-wrap"><table className="dx-table"><thead><tr><th>Parent</th><th className="num">Children</th><th className="num">Orders</th><th className="num">Spent</th><th className="num">Work given</th><th>Opened</th><th aria-label="Open" /></tr></thead>
        <tbody>{!shown.length ? <tr><td colSpan={7} className="dx-muted">No families yet.</td></tr> : shown.map((f) => (
          <Fragment key={f.workspace_id}>
            <tr><td className="name">{f.owner}<div className="dx-muted" style={{ fontWeight: 400, fontSize: 12 }}>{f.email}</div></td><td className="num">{num(f.children)}</td><td className="num">{num(f.orders)}</td><td className="num">{cedis(Number(f.spent_minor))}</td><td className="num">{num(f.assignments)}</td><td className="dx-muted">{when(f.created_at)}</td>
              <td><button className="dx-btn sm" aria-expanded={open === f.workspace_id} onClick={() => setOpen(open === f.workspace_id ? "" : f.workspace_id)}>{open === f.workspace_id ? "Close" : "Inspect"}</button></td></tr>
            {open === f.workspace_id && <tr className="dx-detail"><td colSpan={7}>{loading || !detail ? <span className="dx-muted">Loading…</span> : (
              <div className="dx-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                <div><strong>Children</strong>{detail.children.map((c) => <div key={c.student_id} className="dx-note">{c.name} · {c.grade_code ?? "no class"} · {c.type.replace("_", " ")} <span className={`dx-pill ${STATUS_TONE[c.status] ?? ""}`}>{c.status}</span>{c.minor ? " · under 13" : ""}</div>)}</div>
                <div><strong>Orders</strong>{detail.orders.length ? detail.orders.map((o) => <div key={o.reference} className="dx-note">{when(o.created_at)} · {o.kind} · {cedis(Number(o.total_minor))} <span className={`dx-pill ${STATUS_TONE[o.status] ?? ""}`}>{o.status}</span></div>) : <div className="dx-muted dx-note">None</div>}</div>
                <div><strong>Recent actions by the parent</strong>{detail.activity.length ? detail.activity.slice(0, 8).map((a, i) => <div key={i} className="dx-note">{when(a.at)} · {a.action.replace("family.", "").replaceAll("_", " ")}</div>) : <div className="dx-muted dx-note">None</div>}</div>
              </div>)}</td></tr>}
          </Fragment>))}</tbody></table></div>
      <div className="dx-pager"><span>{num(shown.length)} of {num(data.families.length)} families (latest 100)</span></div>
    </div>
  );
}
