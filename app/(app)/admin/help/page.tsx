"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminGuide, adminGuides, deleteGuide, saveGuide, setGuideState, type AdminGuide } from "@/lib/api/help";
import { categoryLabel, HELP_AUDIENCES, HELP_CATEGORIES } from "@/lib/help/categories";
import { RenderText } from "@/lib/policies/render";
import ExportLink from "@/components/admin/ExportLink";

// Admin, Help. Write, preview and publish the guides people see at Help (/help on the website, Help inside the app). Guides are for learners, teachers, schools and sponsors; administrator workflows
// do not belong here. Link to another guide with [words](help:web-name). A guide that is switched back to draft disappears from Help at once.
type Form = { id: string | null; slug: string; title: string; summary: string; body: string; category: string; audiences: string[]; sort: number; state: "draft" | "published" };
const blank: Form = { id: null, slug: "", title: "", summary: "", body: "# Title of the guide\n\nOne sentence about what this guide helps with.\n\n## Steps\n\n1. First step.\n2. Second step.\n", category: "getting-started", audiences: ["everyone"], sort: 100, state: "draft" };
const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function Editor({ form, onChange, onSaved, onError, onNotice }: { form: Form; onChange: (f: Form) => void; onSaved: (id: string) => void; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [busy, setBusy] = useState(""), [preview, setPreview] = useState(false), [slugEdited, setSlugEdited] = useState(Boolean(form.id));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => onChange({ ...form, [k]: v });
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); onError(""); try { await fn(); } catch (e: any) { onError(e.message); } setBusy(""); };
  const save = () => run("save", async () => { const g = await saveGuide({ id: form.id, slug: form.slug, title: form.title, summary: form.summary, body: form.body, category: form.category, audiences: form.audiences, sort: form.sort }); onNotice("Saved."); onSaved(g.id); });
  const toggle = () => run("state", async () => {
    const g = await saveGuide({ id: form.id, slug: form.slug, title: form.title, summary: form.summary, body: form.body, category: form.category, audiences: form.audiences, sort: form.sort }), id = g.id;   // save the latest text first
    const next = form.state === "published" ? "draft" : "published"; await setGuideState(id, next); onNotice(next === "published" ? "Published. It is now in Help." : "Switched back to draft. It is no longer in Help."); onSaved(id);
  });
  const remove = () => run("delete", async () => { if (form.id && window.confirm("Delete this draft for good?")) { await deleteGuide(form.id); onNotice("Deleted."); onSaved(""); } });
  const toggleAud = (a: string) => { const has = form.audiences.includes(a); const next = has ? form.audiences.filter((x) => x !== a) : [...form.audiences, a]; set("audiences", next.length ? next : ["everyone"]); };
  const ok = form.title.trim().length >= 3 && form.summary.trim().length >= 10 && form.body.trim().length >= 50 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.slug);
  return (
    <div className="qb-card qb-form">
      <h2>{form.id ? "Edit guide" : "New guide"} <span className="qb-muted qb-small">{form.state === "published" ? "· published" : "· draft"}</span></h2>
      <div className="qb-grid cols-2">
        <label className="qb-field">Title<input value={form.title} maxLength={120} onChange={(e) => onChange({ ...form, title: e.target.value, slug: slugEdited ? form.slug : slugOf(e.target.value) })} /></label>
        <label className="qb-field">Web name (letters, numbers, dashes)<input value={form.slug} maxLength={60} onChange={(e) => { setSlugEdited(true); set("slug", e.target.value.toLowerCase()); }} /></label>
        <label className="qb-field">Topic<select value={form.category} onChange={(e) => set("category", e.target.value)}>{HELP_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label className="qb-field">Order (smaller comes first)<input type="number" value={form.sort} onChange={(e) => set("sort", Number(e.target.value) || 100)} /></label>
      </div>
      <label className="qb-field">One-line summary (shown in search and lists)<input value={form.summary} maxLength={240} onChange={(e) => set("summary", e.target.value)} /></label>
      <fieldset className="qb-field"><legend>Who is it for? (people see their own guides first)</legend>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{HELP_AUDIENCES.map((a) => <label key={a.id}><input type="checkbox" checked={form.audiences.includes(a.id)} onChange={() => toggleAud(a.id)} /> {a.label}</label>)}</div></fieldset>
      <div><button type="button" className="qb-btn qb-btn-secondary" onClick={() => setPreview((p) => !p)}>{preview ? "Back to editing" : "Preview"}</button></div>
      {preview ? <div className="qbp-prose" style={{ border: "1px solid rgba(128,128,128,.3)", borderRadius: 8, padding: 16 }}><RenderText source={form.body.replace(/^#[ \t]+[^\n]*\n+/, "")} helpBase="/guides" linkClass="qb-link" /></div>
        : <label className="qb-field">Steps (# Heading, ## Subheading, - bullet, 1. step, **bold**, [words](help:another-guide) or [words](/contact))<textarea rows={18} value={form.body} onChange={(e) => set("body", e.target.value)} style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }} spellCheck /></label>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn qb-btn-secondary" disabled={!!busy || !ok} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button className="qb-btn" disabled={!!busy || !ok} onClick={() => void toggle()}>{busy === "state" ? "Working…" : form.state === "published" ? "Switch back to draft" : "Save and publish"}</button>
        {form.id && form.state === "draft" && <button className="qb-btn ghost" disabled={!!busy} onClick={() => void remove()}>Delete draft</button>}
        {form.id && form.state === "published" && <Link className="qb-btn qb-btn-secondary" href={`/guides/${form.slug}`} target="_blank">View in Help</Link>}
      </div>
    </div>
  );
}

export default function AdminHelpPage() {
  const [rows, setRows] = useState<AdminGuide[] | null>(null), [form, setForm] = useState<Form | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const load = useCallback(() => adminGuides().then(setRows).catch((e) => { setError(e.message); setRows([]); }), []);
  useEffect(() => { void load(); }, [load]);
  async function open(id: string) {
    setError(""); setNotice("");
    try { const g = await adminGuide(id); setForm({ id: g.id, slug: g.slug, title: g.title, summary: g.summary, body: g.body, category: g.category, audiences: g.audiences, sort: g.sort_order, state: g.state }); } catch (e: any) { setError(e.message); }
  }
  const shown = (rows ?? []).filter((r) => filter === "all" || r.state === filter);
  return (
    <>
      <div className="qb-page-head"><div><h1>Help guides</h1><p>The guides people read at <Link className="qb-link" href="/guides">Help</Link> and on the website. Write, preview, publish. Learners, teachers, schools and sponsors only: no administrator workflows.</p></div>
        <ExportLink dataset="help_articles" /><button className="qb-btn" onClick={() => { setForm({ ...blank }); setNotice(""); setError(""); }}>New guide</button></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {notice && <div className="qb-card" role="status"><strong>{notice}</strong></div>}
      <nav aria-label="Filter" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(["all", "published", "draft"] as const).map((f) => <button key={f} className={`qb-btn${filter === f ? "" : " qb-btn-secondary"}`} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "published" ? "Published" : "Drafts"}</button>)}</nav>
      <div className="qb-card">
        {rows === null ? <p className="qb-muted">Loading…</p> : shown.length === 0 ? <p className="qb-muted">No guides here yet.</p> : (
          <table className="qb-table"><thead><tr><th>Guide</th><th>Topic</th><th>For</th><th>Status</th><th>Read</th><th>Helpful</th><th /></tr></thead><tbody>
            {shown.map((r) => <tr key={r.id}><td>{r.title}<span className="qb-muted qb-small" style={{ display: "block" }}>{r.slug}</span></td><td>{categoryLabel(r.category)}</td><td>{r.audiences.join(", ")}</td><td>{r.state}</td><td>{r.views}</td><td>{r.helpful_yes}/{r.helpful_yes + r.helpful_no}</td><td><button className="qb-btn qb-btn-secondary" onClick={() => void open(r.id)}>Edit</button></td></tr>)}
          </tbody></table>
        )}
      </div>
      {form && <Editor key={form.id ?? "new"} form={form} onChange={setForm} onError={setError} onNotice={setNotice} onSaved={(id) => { void load(); if (id) void open(id); else setForm(null); }} />}
    </>
  );
}
