"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { ChannelIcon } from "@/components/AppSocialLinks";
import { Kpi, Panel } from "@/components/admin/DataViz";
import { adminDeleteChannel, adminListChannels, adminReorderChannels, adminSaveChannel, adminSetChannelsFlag, kindInfo, SOCIAL_KINDS, type AdminChannel, type SocialKind } from "@/lib/api/social";

type Draft = { id?: string; kind: SocialKind; label: string; handle: string; target: string; active: boolean };
const glyphColor = (k: SocialKind) => (k === "snapchat" ? "#000" : "#fff");
const blank: Draft = { kind: "whatsapp", label: "", handle: "", target: "", active: true };

// Social channels, for the super admin. Whatever is switched on appears in the "Follow QuizBox" corner of the app menu.
// A WhatsApp number becomes a wa.me link; other links must be on the platform's own site. The master switch decides whether the menu uses this list or the built-in six.
export default function SocialChannelsPage() {
  const [rows, setRows] = useState<AdminChannel[] | null>(null), [flag, setFlag] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(""), [confirm, setConfirm] = useState("");

  const load = useCallback(() => adminListChannels().then((r) => { setRows(r.rows); setFlag(r.flag); }).catch((e) => { setError(e.message); setRows([]); }), []);
  useEffect(() => { void load(); }, [load]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true); setError(""); setDone("");
    try { await action(); setDone(label); await load(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  const info = kindInfo(draft.kind);
  const move = (i: number, d: -1 | 1) => { if (!rows) return; const ids = rows.map((r) => r.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; void run("Order saved.", () => adminReorderChannels(ids)); };
  const edit = (c: AdminChannel) => { setDraft({ id: c.id, kind: c.kind, label: c.label, handle: c.handle ?? "", target: c.target, active: c.active }); setDone(""); setError(""); };
  const save = () => run(draft.id ? `${draft.label} saved.` : `${draft.label} added.`, async () => { await adminSaveChannel(draft); setDraft(blank); });
  const shown = (rows ?? []).filter((r) => r.active);

  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>Social channels</h1><p>Add the channels people can follow or message. The ones switched on appear in the Follow QuizBox corner at the bottom left of the app menu, in this order.</p></div>
        <div className="dx-actions">
          <button className={`dx-btn${flag ? "" : " primary"}`} disabled={busy} onClick={() => void run(flag ? "Switched off. The menu shows the built-in six channels." : "Switched on. The menu now shows this list.", () => adminSetChannelsFlag(!flag))}>{flag ? "Switch off" : "Switch on"}</button>
        </div>
      </div>

      <div className="dx-kpis">
        <Kpi label="Channels" value={rows?.length ?? "—"} hint="Up to 30" />
        <Kpi label="Showing in the menu" value={rows ? shown.length : "—"} />
        <Kpi label="Hidden" value={rows ? rows.length - shown.length : "—"} />
        <Kpi label="Menu uses this list" value={flag ? "On" : "Off"} tone={flag ? "default" : "warn"} hint={flag ? "Changes appear for users" : "Not live yet: the built-in six show"} />
      </div>

      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {done && <div className="dx-alert ok" role="status">{done}</div>}

      <div className="dx-grid" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <Panel title="Channels" subtitle="Use the arrows to change the order; untick Shown to hide one without deleting it.">
          <div className="dx-table-wrap" style={{ maxHeight: "none" }}>
            <table className="dx-table">
              <thead><tr><th aria-label="Order" /><th>Channel</th><th>Handle or number</th><th>Link</th><th>Shown</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {rows === null ? <tr><td colSpan={6} className="dx-muted">Loading…</td></tr> : !rows.length ? <tr><td colSpan={6} className="dx-muted">No channels yet. Add one on the right.</td></tr> : rows.map((c, i) => (
                  <tr key={c.id} style={c.active ? undefined : { opacity: .6 }}>
                    <td>
                      <div className="dx-actions" style={{ flexWrap: "nowrap", gap: 2 }}>
                        <button className="dx-btn sm" aria-label={`Move ${c.label} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} aria-hidden="true" /></button>
                        <button className="dx-btn sm" aria-label={`Move ${c.label} down`} disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} aria-hidden="true" /></button>
                      </div>
                    </td>
                    <td className="name"><span className="qb-social-chip" data-channel={c.kind} style={{ display: "inline-grid", width: 24, height: 24, verticalAlign: "middle", marginInlineEnd: 8, borderRadius: "50%", placeItems: "center", color: glyphColor(c.kind) }}><ChannelIcon kind={c.kind} size={14} /></span>{c.label}</td>
                    <td>{c.handle ?? <span className="dx-muted">—</span>}</td>
                    <td className="dx-muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}><a href={c.url} target="_blank" rel="noopener noreferrer" title={c.url}>{c.url.replace(/^https?:\/\//, "")}</a></td>
                    <td><input type="checkbox" aria-label={`Show ${c.label}`} checked={c.active} disabled={busy} onChange={(e) => void run(e.target.checked ? `${c.label} is shown.` : `${c.label} is hidden.`, () => adminSaveChannel({ id: c.id, kind: c.kind, label: c.label, handle: c.handle ?? "", target: c.target, active: e.target.checked }))} /></td>
                    <td>
                      <div className="dx-actions" style={{ flexWrap: "nowrap" }}>
                        <button className="dx-btn sm" disabled={busy} onClick={() => edit(c)}>Edit</button>
                        {confirm === c.id
                          ? <button className="dx-btn sm danger" disabled={busy} onClick={() => { setConfirm(""); void run(`${c.label} deleted.`, () => adminDeleteChannel(c.id)); }}>Confirm delete</button>
                          : <button className="dx-btn sm" disabled={busy} onClick={() => setConfirm(c.id)}>Delete</button>}
                      </div>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="dx-stack">
          <Panel title={draft.id ? "Edit channel" : "Add a channel"} subtitle={info ? `Platform: ${info.name}` : undefined}>
            <form className="dx-form" style={{ gridTemplateColumns: "1fr" }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label>Platform<select className="dx-select" value={draft.kind} onChange={(e) => { const k = e.target.value as SocialKind; setDraft({ ...draft, kind: k, label: draft.label || (kindInfo(k)?.name ?? "") }); }}>{SOCIAL_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.name}</option>)}</select></label>
              <label>Name shown on hover<input className="dx-input" value={draft.label} maxLength={60} placeholder={info?.name ?? "Name"} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required /></label>
              <label>{info?.targetLabel ?? "Link"}<input className="dx-input" value={draft.target} maxLength={300} placeholder={info?.placeholder} inputMode={draft.kind === "whatsapp" ? "tel" : "url"} onChange={(e) => setDraft({ ...draft, target: e.target.value })} required /></label>
              <label>Handle or number to display (optional)<input className="dx-input" value={draft.handle} maxLength={80} placeholder={draft.kind === "whatsapp" ? "+233 24 123 4567" : "@quizbox"} onChange={(e) => setDraft({ ...draft, handle: e.target.value })} /></label>
              <label className="dx-check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Show in the menu</label>
              <div className="dx-actions"><button className="dx-btn primary" disabled={busy || !draft.label.trim() || !draft.target.trim()}>{draft.id ? "Save changes" : "Add channel"}</button>{draft.id && <button type="button" className="dx-btn" onClick={() => setDraft(blank)}>Cancel</button>}</div>
            </form>
          </Panel>
          <Panel title="Preview" subtitle="How the menu corner will look">
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, maxWidth: 220 }}>
              <p className="qb-follow-title" style={{ margin: "0 0 8px" }}>Follow QuizBox</p>
              <ul className="qb-social" style={{ display: "grid", gridTemplateColumns: "repeat(3, 28px)", justifyContent: "space-between", justifyItems: "center", gap: "6px 4px", margin: 0, padding: 0, listStyle: "none" }}>
                {shown.map((c) => <li key={c.id}><span className="qb-social-chip" data-channel={c.kind} title={c.label} style={{ display: "inline-grid", width: 28, height: 28, borderRadius: "50%", placeItems: "center", color: glyphColor(c.kind) }}><ChannelIcon kind={c.kind} size={15} /></span></li>)}
              </ul>
              {rows && !shown.length && <p className="dx-muted dx-note">Nothing is switched on.</p>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
