"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminVideos, deleteVideo, saveVideo, setVideoState, type AdminVideo } from "@/lib/api/help-videos";
import { adminGuides, type AdminGuide } from "@/lib/api/help";
import { HELP_AUDIENCES } from "@/lib/help/categories";
import { formatDuration, parseDuration, parseYouTubeId, thumbnailUrl, watchOnYouTubePath } from "@/lib/help/video";

// Admin, Help videos. The library of how-to videos kept on QuizBox's YouTube channel. Paste the YouTube link, choose who it is for and which Help guides it appears on, then publish.
// People watch it on the guide (the player loads only after they press play), and "Watch on YouTube" counts the click and sends them to the channel. Plays and clicks are shown here.
type Form = { id: string | null; title: string; summary: string; link: string; audiences: string[]; sort: number; duration: string; slugs: string[]; state: "draft" | "published" };
const blank: Form = { id: null, title: "", summary: "", link: "", audiences: ["everyone"], sort: 100, duration: "", slugs: [], state: "draft" };
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

function Editor({ form, guides, onChange, onSaved, onError, onNotice }: { form: Form; guides: AdminGuide[]; onChange: (f: Form) => void; onSaved: (id: string) => void; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [busy, setBusy] = useState(""), [find, setFind] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => onChange({ ...form, [k]: v });
  const youtubeId = parseYouTubeId(form.link), duration = parseDuration(form.duration);
  const ok = form.title.trim().length >= 3 && !!youtubeId && duration !== undefined;
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); onError(""); try { await fn(); } catch (e: any) { onError(e.message); } setBusy(""); };
  const persist = () => saveVideo({ id: form.id, title: form.title, summary: form.summary, youtubeId: youtubeId as string, audiences: form.audiences, sort: form.sort, duration: duration as number | null, slugs: form.slugs });
  const save = () => run("save", async () => { const v = await persist(); onNotice("Saved."); onSaved(v.id); });
  const toggle = () => run("state", async () => {
    const v = await persist(), next = form.state === "published" ? "draft" : "published";      // save the latest first
    await setVideoState(v.id, next); onNotice(next === "published" ? "Published. It now shows on its guides." : "Switched back to draft. It no longer shows on any guide."); onSaved(v.id);
  });
  const remove = () => run("delete", async () => { if (form.id && window.confirm("Delete this draft video for good?")) { await deleteVideo(form.id); onNotice("Deleted."); onSaved(""); } });
  const toggleAud = (a: string) => { const next = form.audiences.includes(a) ? form.audiences.filter((x) => x !== a) : [...form.audiences, a]; set("audiences", next.length ? next : ["everyone"]); };
  const toggleSlug = (s: string) => set("slugs", form.slugs.includes(s) ? form.slugs.filter((x) => x !== s) : [...form.slugs, s]);
  const shown = useMemo(() => guides.filter((g) => !find.trim() || `${g.title} ${g.slug}`.toLowerCase().includes(find.trim().toLowerCase())), [guides, find]);
  return (
    <div className="qb-card qb-form">
      <h2>{form.id ? "Edit video" : "New video"} <span className="qb-muted qb-small">{form.state === "published" ? "· published" : "· draft"}</span></h2>
      <div className="qb-grid cols-2">
        <label className="qb-field">Title (shown on the guide)<input value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} /></label>
        <label className="qb-field">YouTube link (or the 11-letter video id)<input value={form.link} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => set("link", e.target.value)} aria-invalid={form.link.trim() !== "" && !youtubeId} />
          {form.link.trim() !== "" && !youtubeId && <span className="qb-error qb-small">That is not a single YouTube video link.</span>}</label>
        <label className="qb-field">Length (m:ss, optional)<input value={form.duration} placeholder="2:05" onChange={(e) => set("duration", e.target.value)} aria-invalid={duration === undefined} />
          {duration === undefined && <span className="qb-error qb-small">Use minutes and seconds, like 2:05 (up to 2 hours).</span>}</label>
        <label className="qb-field">Order (smaller comes first)<input type="number" value={form.sort} onChange={(e) => set("sort", Number(e.target.value) || 100)} /></label>
      </div>
      <label className="qb-field">One line about the video (optional)<input value={form.summary} maxLength={240} onChange={(e) => set("summary", e.target.value)} /></label>
      {youtubeId && <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnailUrl(youtubeId)} alt="" width={160} height={90} style={{ borderRadius: 8, objectFit: "cover" }} />
        <span className="qb-muted qb-small">Video {youtubeId}{duration ? ` · ${formatDuration(duration)}` : ""}. Make sure it is public or unlisted on YouTube, with captions.</span>
      </div>}
      <fieldset className="qb-field"><legend>Who is it for?</legend>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{HELP_AUDIENCES.map((a) => <label key={a.id}><input type="checkbox" checked={form.audiences.includes(a.id)} onChange={() => toggleAud(a.id)} /> {a.label}</label>)}</div></fieldset>
      <fieldset className="qb-field"><legend>Show it on these guides ({form.slugs.length} chosen)</legend>
        <input type="search" aria-label="Find a guide" placeholder="Find a guide" value={find} onChange={(e) => setFind(e.target.value)} />
        <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 4, marginTop: 8 }}>
          {shown.length === 0 ? <span className="qb-muted qb-small">No guides match.</span> : shown.map((g) => <label key={g.slug}><input type="checkbox" checked={form.slugs.includes(g.slug)} onChange={() => toggleSlug(g.slug)} /> {g.title} <span className="qb-muted qb-small">{g.slug}{g.state === "draft" ? " · draft guide" : ""}</span></label>)}
        </div></fieldset>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn qb-btn-secondary" disabled={!!busy || !ok} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button className="qb-btn" disabled={!!busy || !ok} onClick={() => void toggle()}>{busy === "state" ? "Working…" : form.state === "published" ? "Switch back to draft" : "Save and publish"}</button>
        {form.id && form.state === "draft" && <button className="qb-btn ghost" disabled={!!busy} onClick={() => void remove()}>Delete draft</button>}
        {form.id && form.state === "published" && <a className="qb-btn qb-btn-secondary" href={watchOnYouTubePath(form.id)} target="_blank" rel="noopener nofollow">Open on YouTube</a>}
      </div>
    </div>
  );
}

export default function AdminHelpVideosPage() {
  const [rows, setRows] = useState<AdminVideo[] | null>(null), [guides, setGuides] = useState<AdminGuide[]>([]), [form, setForm] = useState<Form | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const load = useCallback(() => adminVideos().then(setRows).catch((e) => { setError(e.message); setRows([]); }), []);
  useEffect(() => { void load(); adminGuides().then(setGuides).catch(() => setGuides([])); }, [load]);
  const toForm = (v: AdminVideo): Form => ({ id: v.id, title: v.title, summary: v.summary, link: v.youtube_id, audiences: v.audiences, sort: v.sort_order, duration: v.duration_seconds ? formatDuration(v.duration_seconds) : "", slugs: v.slugs, state: v.state });
  const open = (v: AdminVideo) => { setError(""); setNotice(""); setForm(toForm(v)); };
  const titleOf = useMemo(() => new Map(guides.map((g) => [g.slug, g.title])), [guides]);
  const shown = (rows ?? []).filter((r) => filter === "all" || r.state === filter);
  const totals = (rows ?? []).reduce((t, r) => ({ plays: t.plays + r.plays, outbound: t.outbound + r.outbound }), { plays: 0, outbound: 0 });
  return (
    <>
      <div className="qb-page-head"><div><h1>Help videos</h1><p>How-to videos on QuizBox&apos;s YouTube channel, shown on the <Link className="qb-link" href="/admin/help">Help guides</Link> they explain. Anyone who presses play, or &quot;Watch on YouTube&quot;, is counted here.</p></div>
        <button className="qb-btn" onClick={() => { setForm({ ...blank }); setNotice(""); setError(""); }}>New video</button></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {notice && <div className="qb-card" role="status"><strong>{notice}</strong></div>}
      <nav aria-label="Filter" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(["all", "published", "draft"] as const).map((f) => <button key={f} className={`qb-btn${filter === f ? "" : " qb-btn-secondary"}`} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "published" ? "Published" : "Drafts"}</button>)}</nav>
      <div className="qb-card">
        {rows === null ? <p className="qb-muted">Loading…</p> : shown.length === 0 ? <p className="qb-muted">No videos here yet. Upload a video to YouTube, then press New video and paste its link.</p> : (
          <>
            <p className="qb-muted qb-small">All videos: {totals.plays} plays on QuizBox, {totals.outbound} clicks to YouTube.</p>
            <table className="qb-table"><thead><tr><th>Video</th><th>Shown on</th><th>For</th><th>Status</th><th>Plays</th><th>To YouTube</th><th /></tr></thead><tbody>
              {shown.map((r) => <tr key={r.id}><td>{r.title}<span className="qb-muted qb-small" style={{ display: "block" }}>{r.youtube_id}{r.duration_seconds ? ` · ${formatDuration(r.duration_seconds)}` : ""}</span></td>
                <td>{r.slugs.length === 0 ? <span className="qb-muted">no guide yet</span> : r.slugs.map((s) => titleOf.get(s) ?? s).join(", ")}</td><td>{r.audiences.join(", ")}</td><td>{r.state}</td><td>{r.plays}</td><td>{r.outbound} <span className="qb-muted qb-small">({pct(r.outbound, r.plays + r.outbound)})</span></td>
                <td><button className="qb-btn qb-btn-secondary" onClick={() => open(r)}>Edit</button></td></tr>)}
            </tbody></table>
          </>
        )}
      </div>
      {form && <Editor key={form.id ?? "new"} form={form} guides={guides} onChange={setForm} onError={setError} onNotice={setNotice} onSaved={(id) => { if (!id) { void load(); setForm(null); return; } void adminVideos().then((all) => { setRows(all); const v = all.find((x) => x.id === id); if (v) setForm(toForm(v)); }).catch((e) => setError(e.message)); }} />}
    </>
  );
}
