"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { SUBJECT_VISUALS } from "@/lib/brand/subject-visuals";

type Visual = { subject_slug: string; asset_status: string; rights_status: string; rights_note: string; discovery_bytes: number; mobile_bytes: number; updated_at: string };

export default function SubjectImagesPage() {
  const [items, setItems] = useState<Visual[]>([]), [subject, setSubject] = useState(SUBJECT_VISUALS[0]?.slug ?? ""), [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState(""), [focalX, setFocalX] = useState(50), [focalY, setFocalY] = useState(50), [assetStatus, setAssetStatus] = useState("pending"), [rightsStatus, setRightsStatus] = useState("pending"), [rightsNote, setRightsNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const request = useCallback(async (method = "GET", body?: FormData | Record<string, string>) => {
    const token = (await getSupabaseBrowserClient().auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const response = await fetch("/api/admin/subject-visuals", { method, headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) }, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error === "QB_PERMISSION_DENIED" ? "Administrator access is required." : "Subject image service is unavailable. Apply its migration and try again.");
    return result;
  }, []);
  const load = useCallback(async () => { try { setItems((await request()).items ?? []); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load subject images."); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  async function upload(e: React.FormEvent) {
    e.preventDefault(); if (!file) { setError("Choose an image first."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData(); form.set("subject_slug", subject); form.set("file", file); form.set("alt_text", alt); form.set("focal_x", String(focalX)); form.set("focal_y", String(focalY)); form.set("asset_status", assetStatus); form.set("rights_status", rightsStatus); form.set("rights_note", rightsNote);
      await request("POST", form); setFile(null); setMessage("Image variants saved."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    setBusy(false);
  }
  async function update(item: Visual, nextAsset: string, nextRights: string) {
    const note = window.prompt("Required review note (records the status decision):", item.rights_note || "");
    if (note === null) return;
    setBusy(true); setError("");
    try { await request("PATCH", { subject_slug: item.subject_slug, asset_status: nextAsset, rights_status: nextRights, rights_note: note }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Update failed."); }
    setBusy(false);
  }
  return <main className="qb-page">
    <header className="qb-page-head"><div><h1>Subject images</h1><p>Upload a source image, choose its canonical subject, and review its status before it can appear to learners.</p></div></header>
    {error && <p className="qb-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="qb-card qb-form" onSubmit={(e) => void upload(e)}>
      <h2>Upload image</h2><p className="qb-muted">Source: PNG, JPEG or WebP, up to 4 MB and 4096 × 4096. QuizBox strips metadata and creates 960 × 600 and 640 × 640 WebP versions under 150 KB and 110 KB.</p>
      <label className="qb-field">Subject<select value={subject} onChange={(e) => setSubject(e.target.value)}>{SUBJECT_VISUALS.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}</select></label>
      <label className="qb-field">Source image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label className="qb-field">Alternative text<input maxLength={300} value={alt} onChange={(e) => setAlt(e.target.value)} /></label>
      <div className="qb-grid cols-2">
        <label className="qb-field">Focal point horizontal (0–100)<input type="number" min={0} max={100} value={focalX} onChange={(e) => setFocalX(Number(e.target.value))} /></label>
        <label className="qb-field">Focal point vertical (0–100)<input type="number" min={0} max={100} value={focalY} onChange={(e) => setFocalY(Number(e.target.value))} /></label>
        <label className="qb-field">Asset status<select value={assetStatus} onChange={(e) => setAssetStatus(e.target.value)}>{["pending", "concept", "approved", "rejected"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="qb-field">Rights status<select value={rightsStatus} onChange={(e) => setRightsStatus(e.target.value)}>{["pending", "cleared", "refused"].map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      <label className="qb-field">Review / rights note<textarea maxLength={500} value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} /></label>
      <button className="qb-btn" disabled={busy || !file}>{busy ? "Saving…" : "Upload and save"}</button>
    </form>
    <section className="qb-card"><h2>Saved images</h2>{items.length ? <ul className="qb-list">{items.map((item) => <li key={item.subject_slug}><strong>{SUBJECT_VISUALS.find((s) => s.slug === item.subject_slug)?.label ?? item.subject_slug}</strong> · {item.asset_status} · rights {item.rights_status} · {Math.ceil(item.discovery_bytes / 1024)} KB + {Math.ceil(item.mobile_bytes / 1024)} KB{(item.asset_status !== "approved" || item.rights_status !== "cleared") && <button type="button" className="qb-link-btn" disabled={busy} onClick={() => void update(item, "approved", "cleared")}>Approve and clear rights…</button>}</li>)}</ul> : <p className="qb-muted">No saved images yet.</p>}</section>
  </main>;
}
