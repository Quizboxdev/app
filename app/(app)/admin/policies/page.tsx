"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { adminPolicies, adminVersion, companyDetails, discardDraft, extractDocument, publishVersion, saveCompanyDetail, saveDraft, type CompanyDetail, type PolicyDoc, type VersionFull } from "@/lib/api/policies";
import { RenderText } from "@/lib/policies/render";

// Admin, Policies. Company details are typed once and fill {{name}} in every policy. Each policy has versions: write or upload a draft, preview it, publish it. A published version never changes;
// a new draft starts the next version. "People must accept again" is for real changes; leave it off for a typo.
const fill = (text: string, details: CompanyDetail[]) => details.reduce((t, d) => (d.value.trim() ? t.split(`{{${d.key}}}`).join(d.value.trim()) : t), text);
const missingIn = (text: string, details: CompanyDetail[]) => [...new Set([...text.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]))].filter((k) => !details.some((d) => d.key === k && d.value.trim()));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

function Company({ details, onSaved, onError }: { details: CompanyDetail[]; onSaved: () => void; onError: (m: string) => void }) {
  const [vals, setVals] = useState<Record<string, string>>({}), [busy, setBusy] = useState("");
  useEffect(() => setVals(Object.fromEntries(details.map((d) => [d.key, d.value]))), [details]);
  const empty = details.filter((d) => !d.value.trim()).length;
  async function save(key: string) { setBusy(key); onError(""); try { await saveCompanyDetail(key, vals[key] ?? ""); onSaved(); } catch (e: any) { onError(e.message); } setBusy(""); }
  return (
    <details className="qb-card" open={empty > 0}>
      <summary><strong>Company details</strong> <span className="qb-muted qb-small">· {empty === 0 ? "all filled in" : `${empty} still empty. A policy that uses an empty one cannot be published`}</span></summary>
      <div className="qb-grid cols-2" style={{ marginTop: 12 }}>
        {details.map((d) => (
          <div key={d.key} className="qb-field"><label htmlFor={`cd-${d.key}`}>{d.label} <span className="qb-muted qb-small">{`{{${d.key}}}`}</span></label>
            <div style={{ display: "flex", gap: 8 }}><input id={`cd-${d.key}`} value={vals[d.key] ?? ""} maxLength={500} onChange={(e) => setVals((v) => ({ ...v, [d.key]: e.target.value }))} />
              <button className="qb-btn qb-btn-secondary" disabled={busy === d.key || (vals[d.key] ?? "") === d.value} onClick={() => void save(d.key)}>{busy === d.key ? "…" : "Save"}</button></div></div>
        ))}
      </div>
    </details>
  );
}

function Editor({ doc, details, onChanged, onError, onNotice }: { doc: PolicyDoc; details: CompanyDetail[]; onChanged: () => void; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const draftRow = doc.versions.find((v) => v.state === "draft") ?? null, liveRow = doc.versions.find((v) => v.state === "published") ?? null;
  const [body, setBody] = useState(""), [summary, setSummary] = useState(""), [effective, setEffective] = useState(""), [reack, setReack] = useState(false), [preview, setPreview] = useState(false), [busy, setBusy] = useState(""), [loaded, setLoaded] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true; setPreview(false); setLoaded("");
    if (draftRow) adminVersion(draftRow.id).then((v: VersionFull) => { if (!alive) return; setBody(v.body); setSummary(v.summary); setEffective(toLocal(v.effective_at)); setReack(v.requires_reack); setLoaded(draftRow.id); }).catch((e) => onError(e.message));
    else { setBody(""); setSummary(""); setEffective(""); setReack(false); setLoaded("none"); }
    return () => { alive = false; };
  }, [draftRow?.id, doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = useMemo(() => missingIn(body, details), [body, details]);
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); onError(""); try { await fn(); } catch (e: any) { onError(e.message); } setBusy(""); };
  const save = () => run("save", async () => { await saveDraft(doc.id, body, summary, effective ? new Date(effective).toISOString() : null, reack); onNotice("Draft saved."); onChanged(); });
  const publish = () => run("publish", async () => {
    if (!draftRow) { const d = await saveDraft(doc.id, body, summary, effective ? new Date(effective).toISOString() : null, reack); await publishVersion(d.id); }
    else { await saveDraft(doc.id, body, summary, effective ? new Date(effective).toISOString() : null, reack); await publishVersion(draftRow.id); }
    onNotice(`${doc.title} is live.`); onChanged();
  });
  const startFromLive = () => run("copy", async () => { if (!liveRow) return; const v = await adminVersion(liveRow.id); await saveDraft(doc.id, v.body, "", null, false); onChanged(); });
  const discard = () => run("discard", async () => { if (draftRow && window.confirm("Discard this draft? The live version is not affected.")) { await discardDraft(draftRow.id); onNotice("Draft discarded."); onChanged(); } });
  const upload = (file: File | undefined) => run("upload", async () => { if (!file) return; if (body.trim() && !window.confirm("Replace the text in the editor with this file?")) return; setBody(await extractDocument(file)); setPreview(false); onNotice("File converted to text. Read it through, fix the headings if needed, then save."); });
  const insert = (key: string) => setBody((b) => `${b}{{${key}}}`);
  const ready = body.trim().length >= 200 && summary.trim().length >= 5 && missing.length === 0;

  return (
    <div className="qb-card qb-form">
      <h2>{doc.title} <span className="qb-muted qb-small">· /{doc.slug} · {doc.required ? "people must accept it" : "no acceptance needed"}</span></h2>
      <p className="qb-muted qb-small">{liveRow ? <>Live: version {liveRow.version_no}{liveRow.published_at ? `, published ${when(liveRow.published_at)}` : ""}. <Link className="qb-link" href={`/${doc.slug}`} target="_blank">View the page</Link>.</> : "Nothing is published yet, so the page shows a notice."}{" "}
        {doc.versions.filter((v) => v.state === "superseded").length > 0 && `Earlier versions kept: ${doc.versions.filter((v) => v.state === "superseded").map((v) => v.version_no).sort().join(", ")}.`}</p>
      {!draftRow && liveRow && loaded === "none" && !body && <p><button className="qb-btn qb-btn-secondary" disabled={!!busy} onClick={() => void startFromLive()}>Start a new version from the live text</button></p>}
      {loaded !== "" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="qb-btn qb-btn-secondary" onClick={() => setPreview((p) => !p)}>{preview ? "Back to editing" : "Preview"}</button>
            <button className="qb-btn qb-btn-secondary" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === "upload" ? "Reading…" : "Upload Word, PDF or text"}</button>
            <input ref={fileRef} type="file" accept=".docx,.pdf,.txt,.md" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            <span className="qb-muted qb-small">Insert a company detail: {details.map((d) => <button key={d.key} type="button" className="qb-btn ghost" style={{ padding: "0 6px", minHeight: 0 }} onClick={() => insert(d.key)}>{`{{${d.key}}}`}</button>)}</span>
          </div>
          {preview ? <div className="qbp-prose" style={{ border: "1px solid rgba(128,128,128,.3)", borderRadius: 8, padding: 16 }}><RenderText source={fill(body, details)} /></div>
            : <label className="qb-field">Text (# Heading, ## Subheading, - bullet, 1. step, **bold**, [words](https://link))<textarea rows={22} value={body} onChange={(e) => setBody(e.target.value)} style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }} spellCheck /></label>}
          {missing.length > 0 && <p className="qb-error" role="status">This text uses details that are still empty: <strong>{missing.join(", ")}</strong>. Fill them in under Company details before publishing.</p>}
          <div className="qb-grid cols-3">
            <label className="qb-field">What changed (shown to people)<input value={summary} maxLength={500} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Initial version, or Clarified how refunds work" /></label>
            <label className="qb-field">Effective from (optional)<input type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} /></label>
            <label className="qb-field"><span><input type="checkbox" checked={reack} onChange={(e) => setReack(e.target.checked)} /> People must accept again (a real change, not a typo)</span></label>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="qb-btn qb-btn-secondary" disabled={!!busy || !body.trim()} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save draft"}</button>
            <button className="qb-btn" disabled={!!busy || !ready} onClick={() => { if (window.confirm(`Publish this as the live ${doc.title}?${reack || !liveRow ? " People will be asked to accept it." : ""} A published version can never be edited.`)) void publish(); }}>{busy === "publish" ? "Publishing…" : "Publish"}</button>
            {draftRow && <button className="qb-btn ghost" disabled={!!busy} onClick={() => void discard()}>Discard draft</button>}
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminPoliciesPage() {
  const [docs, setDocs] = useState<PolicyDoc[] | null>(null), [details, setDetails] = useState<CompanyDetail[]>([]), [sel, setSel] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(() => { adminPolicies().then((d) => { setDocs(d); setSel((s) => s || d[0]?.id || ""); }).catch((e) => setError(e.message)); companyDetails().then(setDetails).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const doc = docs?.find((d) => d.id === sel) ?? null;
  return (
    <>
      <div className="qb-page-head"><div><h1>Policies</h1><p>Terms, privacy, refunds and cookies as managed text. Write or upload, preview, publish. People accept the required ones after sign-up and after a real change.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {notice && <div className="qb-card" role="status"><strong>{notice}</strong></div>}
      <Company details={details} onSaved={() => { setNotice("Saved."); load(); }} onError={setError} />
      {docs === null && !error && <p className="qb-muted">Loading…</p>}
      {docs && (
        <nav aria-label="Policy documents" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {docs.map((d) => { const live = d.versions.find((v) => v.state === "published"), draft = d.versions.find((v) => v.state === "draft"); return <button key={d.id} className={`qb-btn${d.id === sel ? "" : " qb-btn-secondary"}`} onClick={() => { setSel(d.id); setNotice(""); setError(""); }}>{d.title}{live ? ` · v${live.version_no}` : " · not published"}{draft ? " · draft" : ""}</button>; })}
        </nav>
      )}
      {doc && <Editor key={doc.id} doc={doc} details={details} onError={setError} onNotice={setNotice} onChanged={load} />}
    </>
  );
}
