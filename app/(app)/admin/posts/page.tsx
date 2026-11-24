"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminPost, adminPosts, deletePost, savePost, setPostState, uploadFlyer, type AdminPost } from "@/lib/api/posts";
import { flyerUrl, postUrl, shareText, slugFromTitle, POST_SLUG, type PostPublic } from "@/lib/posts/presentation";
import PublicPost from "@/components/posts/PublicPost";
import { SITE_URL } from "@/lib/site";

// Admin, Posts. Write a post, attach a flyer, publish it inside QuizBox and copy the link to paste into social media, email and WhatsApp. Anyone who opens the link reads the post on quizbox.io and is led to sign up.
// The published list is the record of what has gone out. A post switched back to draft stops opening at once (within a minute).
type Form = { id: string | null; slug: string; title: string; summary: string; body: string; flyer_path: string | null; flyer_alt: string; state: "draft" | "published"; published_at: string | null };
const blank: Form = { id: null, slug: "", title: "", summary: "", body: "Write the opening paragraph here: what is new and why it matters to a learner, a parent or a teacher.\n\nWrite the second paragraph here. A Subscribe link is added for you inside the article, and a Subscribe now panel closes the page.\n\n## A heading if you need one\n\n- A point\n- Another point\n\nTo place a Subscribe link yourself, write [words people click](subscribe) anywhere in the text.", flyer_path: null, flyer_alt: "", state: "draft", published_at: null };
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try { const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); document.body.removeChild(t); return ok; } catch { return false; }
}

function Editor({ form, onChange, onSaved, onError, onNotice }: { form: Form; onChange: (f: Form) => void; onSaved: (id: string) => void; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [busy, setBusy] = useState(""), [preview, setPreview] = useState(false), [slugEdited, setSlugEdited] = useState(Boolean(form.id));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => onChange({ ...form, [k]: v });
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); onError(""); try { await fn(); } catch (e: any) { onError(e.message); } setBusy(""); };
  const input = () => ({ id: form.id, slug: form.slug, title: form.title, summary: form.summary, body: form.body, flyer_path: form.flyer_path, flyer_alt: form.flyer_alt });
  const save = () => run("save", async () => { const p = await savePost(input()); onNotice("Saved."); onSaved(p.id); });
  const toggle = () => run("state", async () => {
    const p = await savePost(input());   // save the latest text first
    const next = form.state === "published" ? "draft" : "published"; await setPostState(p.id, next);
    onNotice(next === "published" ? "Published. Copy the link below and paste it into your channels." : "Switched back to draft. The link no longer opens."); onSaved(p.id);
  });
  const remove = () => run("delete", async () => { if (form.id && window.confirm("Delete this draft for good?")) { await deletePost(form.id); onNotice("Deleted."); onSaved(""); } });
  const upload = (file: File | undefined) => file && run("flyer", async () => { const path = await uploadFlyer(file); onChange({ ...form, flyer_path: path }); });
  const ok = form.title.trim().length >= 3 && form.summary.trim().length >= 10 && form.body.trim().length >= 50 && POST_SLUG.test(form.slug);
  const url = postUrl(SITE_URL, form.slug || "web-name");
  const asPost: PostPublic = { slug: form.slug || "preview", title: form.title || "Post title", summary: form.summary || "One-line summary", body: form.body, flyer_path: form.flyer_path, flyer_alt: form.flyer_alt, published_at: form.published_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
  const flyer = flyerUrl(form.flyer_path);
  return (
    <div className="qb-card qb-form">
      <h2>{form.id ? "Edit post" : "New post"} <span className="qb-muted qb-small">{form.state === "published" ? "· published" : "· draft"}</span></h2>
      <div className="qb-grid cols-2">
        <label className="qb-field">Title<input value={form.title} maxLength={120} onChange={(e) => onChange({ ...form, title: e.target.value, slug: slugEdited ? form.slug : slugFromTitle(e.target.value) })} /></label>
        <label className="qb-field">Web name (letters, numbers, dashes). It becomes the end of the link.<input value={form.slug} maxLength={80} onChange={(e) => { setSlugEdited(true); set("slug", e.target.value.toLowerCase()); }} /></label>
      </div>
      <p className="qb-muted qb-small" style={{ margin: 0 }}>Link: {url}{form.state === "published" ? " (changing the web name changes the link, so links already shared stop working)" : ""}</p>
      <label className="qb-field">Summary ({form.summary.trim().length}/300). Shown under the title and in the preview when the link is shared.<textarea rows={2} value={form.summary} maxLength={300} onChange={(e) => set("summary", e.target.value)} /></label>
      <div className="qb-field">
        <span>Flyer (PNG, JPEG or WebP, up to 5 MB). It opens the post and is the picture in link previews. A landscape picture about twice as wide as tall previews best.</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy === "flyer"} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        {busy === "flyer" && <span className="qb-muted qb-small">Uploading…</span>}
        {flyer && <div style={{ display: "grid", gap: 8, maxWidth: 420 }}><img src={flyer} alt={form.flyer_alt || "Flyer"} style={{ width: "100%", height: "auto", borderRadius: 8, border: "1px solid rgba(128,128,128,.3)" }} />
          <label className="qb-field">Describe the flyer for people who cannot see it<input value={form.flyer_alt} maxLength={200} onChange={(e) => set("flyer_alt", e.target.value)} /></label>
          <div><button type="button" className="qb-btn qb-btn-secondary" onClick={() => onChange({ ...form, flyer_path: null, flyer_alt: "" })}>Remove flyer</button></div></div>}
      </div>
      <div><button type="button" className="qb-btn qb-btn-secondary" onClick={() => setPreview((p) => !p)}>{preview ? "Back to editing" : "Preview the page"}</button></div>
      {preview ? <div style={{ border: "1px solid rgba(128,128,128,.3)", borderRadius: 8, padding: 8 }}><PublicPost post={asPost} /></div>
        : <label className="qb-field">Text (# Heading, ## Subheading, - bullet, 1. step, **bold**, [words](https://…) or [words](/pricing)). [words](subscribe) makes a Subscribe link.<textarea rows={16} value={form.body} onChange={(e) => set("body", e.target.value)} /></label>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn qb-btn-secondary" disabled={!!busy || !ok} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button className="qb-btn" disabled={!!busy || !ok} onClick={() => void toggle()}>{busy === "state" ? "Working…" : form.state === "published" ? "Switch back to draft" : "Save and publish"}</button>
        {form.id && form.state === "draft" && <button className="qb-btn ghost" disabled={!!busy} onClick={() => void remove()}>Delete draft</button>}
      </div>
      {form.state === "published" && form.id && <ShareBox title={form.title} summary={form.summary} slug={form.slug} />}
    </div>
  );
}

// The link to paste into channels, with one-press copy. The shared text is the title, summary and link.
function ShareBox({ title, summary, slug }: { title: string; summary: string; slug: string }) {
  const [msg, setMsg] = useState("");
  const url = postUrl(SITE_URL, slug);
  const go = async (text: string, what: string) => { setMsg((await copy(text)) ? `${what} copied.` : "Copy did not work. Select the link and copy it by hand."); };
  return (
    <div className="qb-card" role="group" aria-label="Share this post">
      <strong>Share this post</strong>
      <input readOnly value={url} aria-label="Post link" onFocus={(e) => e.currentTarget.select()} style={{ width: "100%" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn" onClick={() => void go(url, "Link")}>Copy link</button>
        <button className="qb-btn qb-btn-secondary" onClick={() => void go(shareText(title, summary, url), "Text and link")}>Copy text and link</button>
        <Link className="qb-btn qb-btn-secondary" href={`/p/${slug}`} target="_blank">Open the page</Link>
      </div>
      <span className="qb-muted qb-small" role="status">{msg || "Paste it into Facebook, WhatsApp, TikTok, email or anywhere else. The flyer and summary show in the preview."}</span>
    </div>
  );
}

export default function AdminPostsPage() {
  const [rows, setRows] = useState<AdminPost[] | null>(null), [form, setForm] = useState<Form | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [filter, setFilter] = useState<"all" | "published" | "draft">("all"), [copied, setCopied] = useState("");
  const load = useCallback(() => adminPosts().then(setRows).catch((e) => { setError(e.message); setRows([]); }), []);
  useEffect(() => { void load(); }, [load]);
  async function open(id: string) {
    setError(""); setNotice("");
    try { const p = await adminPost(id); setForm({ id: p.id, slug: p.slug, title: p.title, summary: p.summary, body: p.body, flyer_path: p.flyer_path, flyer_alt: p.flyer_alt ?? "", state: p.state, published_at: p.published_at }); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }
    catch (e: any) { setError(e.message); }
  }
  const shown = (rows ?? []).filter((r) => filter === "all" || r.state === filter);
  return (
    <>
      <div className="qb-page-head"><div><h1>Posts</h1><p>Publish a post inside QuizBox and share its link on social media, email and WhatsApp. Readers land on quizbox.io, read it, and are led to sign up. The list below is the record of what has gone out.</p></div>
        <button className="qb-btn" onClick={() => { setForm({ ...blank }); setNotice(""); setError(""); }}>New post</button></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {notice && <div className="qb-card" role="status"><strong>{notice}</strong></div>}
      <nav aria-label="Filter" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(["all", "published", "draft"] as const).map((f) => <button key={f} className={`qb-btn${filter === f ? "" : " qb-btn-secondary"}`} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "published" ? "Published" : "Drafts"}</button>)}</nav>
      <div className="qb-card">
        {rows === null ? <p className="qb-muted">Loading…</p> : shown.length === 0 ? <p className="qb-muted">No posts here yet.</p> : (
          <table className="qb-table"><thead><tr><th>Post</th><th>Status</th><th>Published</th><th>Updated</th><th /></tr></thead><tbody>
            {shown.map((r) => <tr key={r.id}><td>{r.title}<span className="qb-muted qb-small" style={{ display: "block" }}>/p/{r.slug}</span></td><td>{r.state}</td><td>{dateOf(r.published_at) || "·"}</td><td>{dateOf(r.updated_at)}</td>
              <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="qb-btn qb-btn-secondary" onClick={() => void open(r.id)}>Edit</button>
                {r.state === "published" && <button className="qb-btn qb-btn-secondary" onClick={async () => { setCopied((await copy(postUrl(SITE_URL, r.slug))) ? r.id : ""); }}>{copied === r.id ? "Copied" : "Copy link"}</button>}
              </td></tr>)}
          </tbody></table>
        )}
      </div>
      {form && <Editor key={form.id ?? "new"} form={form} onChange={setForm} onError={setError} onNotice={setNotice} onSaved={(id) => { void load(); if (id) void open(id); else setForm(null); }} />}
    </>
  );
}
