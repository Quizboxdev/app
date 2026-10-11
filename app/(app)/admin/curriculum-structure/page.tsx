"use client";
import { useEffect, useMemo, useState } from "react";
import { importStructureChunk, listAllCurricula, type CurriculumChoice } from "@/lib/api/curriculum-structure";
import { buildStructure, chunkNodes } from "@/lib/curriculum/structure";
import { parseVerifiedCsv } from "@/lib/curriculum/verified";
import { describeErrorMessage } from "@/lib/errors";

// Super Admin: load the verified curriculum structure (strands, sub-strands, content standards and indicators) into a curriculum.
// The curriculum is created first under Market Setup > Register a curriculum (it starts inactive). Nothing here activates it or
// creates questions. The import is idempotent: running it again changes nothing that already exists.
export default function CurriculumStructurePage() {
  const [curricula, setCurricula] = useState<CurriculumChoice[]>([]), [curriculum, setCurriculum] = useState("");
  const [fileName, setFileName] = useState(""), [text, setText] = useState(""), [version, setVersion] = useState("");
  const [subject, setSubject] = useState(""), [grade, setGrade] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [progress, setProgress] = useState("");

  useEffect(() => { listAllCurricula().then(setCurricula).catch((cause) => setError(describeErrorMessage((cause as Error).message))); }, []);

  const parsed = useMemo(() => {
    if (!text) return null;
    try { return { rows: parseVerifiedCsv(text), error: "" }; } catch (cause) { return { rows: [], error: describeErrorMessage((cause as Error).message) }; }
  }, [text]);
  const subjects = useMemo(() => [...new Set((parsed?.rows ?? []).map((r) => r.subject))].sort(), [parsed]);
  const grades = useMemo(() => [...new Set((parsed?.rows ?? []).map((r) => r.grade))].sort(), [parsed]);
  const chosen = useMemo(() => (parsed?.rows ?? []).filter((r) => (!subject || r.subject === subject) && (!grade || r.grade === grade)), [parsed, subject, grade]);
  const plan = useMemo(() => (chosen.length ? buildStructure(chosen, { sourceFile: fileName }) : null), [chosen, fileName]);

  async function run() {
    if (!plan || !curriculum) return;
    if (!window.confirm(`Load ${plan.counts.learning_indicator} indicators (${plan.nodes.length} nodes) into this curriculum? Existing nodes are left unchanged.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      let inserted = 0, existing = 0; const chunks = chunkNodes(plan.nodes, 400);
      for (let i = 0; i < chunks.length; i++) {
        setProgress(`Loading part ${i + 1} of ${chunks.length}…`);
        const r = await importStructureChunk(curriculum, chunks[i], fileName, version);
        inserted += r.inserted; existing += r.existing;
      }
      setNotice(`Done: ${inserted} nodes created, ${existing} already existed.`);
    } catch (cause) { setError(describeErrorMessage((cause as Error).message)); }
    finally { setBusy(false); setProgress(""); }
  }

  return <>
    <div className="qb-page-head"><div><h1>Curriculum structure</h1>
      <p>Load the verified strands, sub-strands, content standards and learning indicators into a curriculum. Create the curriculum first under Market Setup, then load its structure here. Nothing is activated and no questions are created.</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="qb-card"><h2>1. Choose the curriculum</h2>
      <label>Curriculum<select value={curriculum} onChange={(e) => setCurriculum(e.target.value)}><option value="">Select a curriculum</option>
        {curricula.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.version}){c.active ? "" : " · inactive"} · {c.nodes} nodes</option>)}</select></label>
      <label title="Edition printed on the document, for example 2020 or 2025.">Source version<input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2020"/></label>
    </section>
    <section className="qb-card"><h2>2. Choose the verified file</h2>
      <p className="qb-muted">The JHS or SHS file from the verified curriculum extract (JHS_indicators_verified.csv or SHS_indicators_verified.csv).</p>
      <label>File<input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setText(await f.text()); setSubject(""); setGrade(""); } }}/></label>
      {parsed?.error && <p className="qb-error" role="alert">{parsed.error}</p>}
      {parsed && !parsed.error && <div className="qb-content-filters">
        <label>Subject (optional)<select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All {subjects.length} subjects</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Grade (optional)<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">All grades</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
      </div>}
    </section>
    {plan && <section className="qb-card"><h2>3. Check and load</h2>
      <dl className="qb-stat-list">{Object.entries(plan.counts).map(([k, v]) => <div key={k}><dt>{k.replaceAll("_", " ")}</dt><dd>{v}</dd></div>)}</dl>
      {plan.collisions.length > 0 && <p className="qb-muted">{plan.collisions.length} codes repeat in the source and were made unique by position, so no indicator is lost.</p>}
      {plan.problems.length > 0 && <p className="qb-error" role="alert">{plan.problems.length} rows cannot be placed (missing fields or unknown level): {plan.problems.slice(0, 3).join("; ")}</p>}
      <button className="qb-btn" disabled={busy || !curriculum || plan.problems.length > 0} onClick={() => void run()}>{busy ? progress || "Loading…" : "Load structure"}</button>
      {!curriculum && <p className="qb-muted">Choose a curriculum first.</p>}
    </section>}
  </>;
}
