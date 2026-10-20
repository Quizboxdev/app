"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getMaterial, joinChallenge, readSection } from "@/lib/api/challenges";
import { isAllowanceExhausted, SUBSCRIBE_PATH } from "@/lib/api/access";
import { useRouter } from "next/navigation";
import { contentType } from "@/lib/challenges/content-types";
import { FORMATS, formatOf, type Material, type SectionRead } from "@/lib/challenges/types";
import { timeLeft } from "@/lib/drafts/format";

// The reader: the chapters the organiser chose, in the app, for people who joined. It is closed while a timed round is running and closes when the competition ends (or opens, if the
// organiser chose that). Text arrives a chapter at a time, is marked with the reader's name, and cannot be selected or printed here (this discourages copying; it cannot stop a screenshot).
const SIZES = [15, 17, 19, 22];
const WHY: Record<string, { title: string; text: string }> = {
  NOT_ENABLED: { title: "No reading material", text: "The organiser has not made any reading material available for this one." },
  NOT_IN_AUDIENCE: { title: "Not for your account", text: "This is open only to the class or school it was made for." },
  CLOSED_ROUND: { title: "Finish your round first", text: "Reading is closed while a timed round is running. Submit your answers, then come back." },
  CLOSED_ENDED: { title: "Reading has closed", text: "Reading closes when the competition ends." },
  CLOSED_STARTED: { title: "Reading has closed", text: "The organiser closed reading when the competition opened." },
};

export default function ReadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params), router = useRouter();
  const [m, setM] = useState<Material | null | undefined>(undefined), [sec, setSec] = useState<SectionRead | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [size, setSize] = useState(1), [now, setNow] = useState(() => Date.now());
  useEffect(() => { try { const s = Number(window.localStorage.getItem("qb-reader-size")); if (s >= 0 && s < SIZES.length) setSize(s); } catch { /* default size */ } }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const load = useCallback(() => getMaterial(slug).then(setM).catch((e) => { setError(e.message); setM(null); }), [slug]);
  useEffect(() => { void load(); }, [load]);
  const open = useCallback(async (id: string) => { setError(""); try { setSec(await readSection(slug, id)); window.scrollTo({ top: 0 }); } catch (e: any) { setError(e.message); void load(); } }, [slug, load]);
  useEffect(() => { if (m?.state === "OPEN" && !sec && m.documents?.[0]?.sections[0]) void open(m.documents[0].sections[0].id); }, [m, sec, open]);
  const resize = (d: number) => { const n = Math.min(SIZES.length - 1, Math.max(0, size + d)); setSize(n); try { window.localStorage.setItem("qb-reader-size", String(n)); } catch { /* ignore */ } };

  async function join() {
    setBusy(true); setError("");
    try { await joinChallenge(slug); await load(); } catch (e: any) { if (isAllowanceExhausted(e)) { router.push(SUBSCRIBE_PATH); return; } setError(e.message); }
    setBusy(false);
  }
  if (m === undefined) return <div className="qb-card" role="status">Loading…</div>;
  if (m === null) return <div className="qb-card qb-error" role="alert">{error || "We could not open the reading material."}</div>;
  const f = FORMATS[formatOf(m.format)], back = <Link className="qb-link" href={`/play/${slug}`}>Back to the {f.noun}</Link>;

  if (m.state === "NOT_JOINED") return (
    <>
      <div className="qb-page-head"><div><h1>{m.title}</h1><p>Join to read the material before you play.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div className="qb-card"><p>You need to join first. Joining is free with your account; your first join uses one of your free sessions.</p><button className="qb-btn" disabled={busy} onClick={() => void join()}>{busy ? "Joining…" : `Join this ${f.noun} and read`}</button> {back}</div>
    </>);
  if (m.state !== "OPEN") { const w = WHY[m.state] ?? WHY.NOT_ENABLED; return <><div className="qb-page-head"><div><h1>{w.title}</h1><p>{m.title}</p></div></div><div className="qb-card"><p>{w.text}</p>{back}</div></>; }

  const docs = m.documents ?? [];
  const closing = m.closes === "END" && m.ends_at ? `Reading closes in ${timeLeft(m.ends_at, now)}.` : m.closes === "START" ? "Reading closes when the competition opens." : "";
  const mark = sec?.reader ?? "";
  return (
    <>
      <div className="qb-page-head"><div><h1>{m.title}</h1><p>Reading material{closing ? ` · ${closing}` : ""}</p></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="qb-btn qb-btn-secondary" onClick={() => resize(-1)} aria-label="Smaller text" disabled={size === 0}>A−</button>
          <button className="qb-btn qb-btn-secondary" onClick={() => resize(1)} aria-label="Larger text" disabled={size === SIZES.length - 1}>A+</button>
          {back}
        </div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <style>{`@media print { .qb-reader { display: none !important; } }`}</style>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)", alignItems: "start" }} className="qb-reader-layout">
        <nav className="qb-card" aria-label="Chapters">
          {docs.map((d) => (
            <div key={d.asset_id}>
              <p className="qb-overline" style={{ margin: "0 0 4px" }}>{contentType(d.content_type).label}: {d.title}</p>
              <ol className="qb-list" style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                {d.sections.map((s) => <li key={s.id}><button className="qb-link-btn" aria-current={sec?.section_id === s.id ? "true" : undefined} style={sec?.section_id === s.id ? { fontWeight: 700 } : undefined} onClick={() => void open(s.id)}>{s.title}</button></li>)}
              </ol>
            </div>))}
        </nav>
        <article className="qb-card qb-reader" onContextMenu={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()}
          style={{ position: "relative", userSelect: "none", WebkitUserSelect: "none", fontSize: SIZES[size], lineHeight: 1.7, overflow: "hidden" }}>
          {!sec ? <p className="qb-muted">Choose a chapter.</p> : <>
            <h2 style={{ marginTop: 0 }}>{sec.title}</h2>
            <p className="qb-muted qb-small">{sec.document} · about {Math.max(1, Math.round(sec.words / 200))} min to read</p>
            {sec.passages.map((p) => <div key={p.position}>{p.heading && p.heading !== sec.title ? <h3>{p.heading}</h3> : null}<p>{p.body}</p></div>)}
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gridAutoRows: 110, opacity: 0.06, overflow: "hidden" }}>
              {Array.from({ length: 60 }).map((_, i) => <span key={i} style={{ transform: "rotate(-20deg)", fontWeight: 700, alignSelf: "center", justifySelf: "center", whiteSpace: "nowrap" }}>{mark}</span>)}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16, position: "relative" }}>
              <button className="qb-btn qb-btn-secondary" disabled={!sec.prev} onClick={() => sec.prev && void open(sec.prev)}>‹ Previous chapter</button>
              {sec.next ? <button className="qb-btn" onClick={() => void open(sec.next!)}>Next chapter ›</button> : <Link className="qb-btn" href={`/play/${slug}`}>Ready? Back to the {f.noun}</Link>}
            </div>
          </>}
        </article>
      </div>
      <style>{`@media (max-width: 720px) { .qb-reader-layout { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </>
  );
}
