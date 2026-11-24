"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import AccessGate from "@/components/mock/AccessGate";
import ExamForm from "@/components/mock/ExamForm";
import ResultsPanel from "@/components/mock/ResultsPanel";
import ReviewPanel from "@/components/mock/ReviewPanel";
import RoundBuilder from "@/components/mock/RoundBuilder";
import SharePanel from "@/components/mock/SharePanel";
import TallyBar from "@/components/mock/TallyBar";
import { deleteExam, getExam, type Exam } from "@/lib/api/mock-exams";
import { gradeLabel } from "@/lib/mock-exams/grades";
import { purposeLabel } from "@/lib/mock-exams/purposes";
import { useRouter } from "next/navigation";

const TABS = [["build", "1. Build"], ["review", "2. Review and publish"], ["share", "3. Share"], ["results", "4. Results"]] as const;
type Tab = (typeof TABS)[number][0];

// One exam: build its rounds, review and publish a version, give it to a class or sell it, read the results.
function Hub({ id }: { id: string }) {
  const [exam, setExam] = useState<Exam | null | undefined>(undefined), [error, setError] = useState(""), [tab, setTab] = useState<Tab>("build"), [details, setDetails] = useState(false);
  const router = useRouter();
  useEffect(() => { if (new URLSearchParams(window.location.search).get("topup")) setTab("share"); }, []);   // back from buying Coins for a shared link
  useEffect(() => { getExam(id).then(setExam).catch((e) => { setError(e.message); setExam(null); }); }, [id]);
  if (exam === undefined) return <div className="qb-card qb-muted" role="status">Loading…</div>;
  if (!exam) return <div className="qb-card"><h2>We could not open this exam</h2><p className="qb-muted">{error || "It may belong to someone else."}</p><Link className="qb-btn" href="/mock-exams">Back to mock exams</Link></div>;

  async function remove() {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    try { await deleteExam(id); router.push("/mock-exams"); } catch (e) { setError((e as Error).message); }
  }
  return (
    <>
      <div className="qb-page-head"><div><p className="qb-small"><Link className="qb-link" href="/mock-exams">← Mock exams</Link></p><h1>{exam.title}</h1>
        <p><span className="qb-pill teal">{gradeLabel(exam.target_grade)}</span> <span className="qb-pill neutral">{purposeLabel(exam.purpose)}</span> <span className={`qb-pill ${exam.status === "published" ? "success" : exam.status === "archived" ? "neutral" : "warning"}`}>{exam.status === "draft" ? "Draft" : exam.status === "published" ? `Published v${exam.current_version_no}` : "Archived"}</span>
          {exam.status === "published" && exam.dirty && <span className="qb-small qb-muted"> · unpublished changes</span>}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn secondary" onClick={() => setDetails(!details)} aria-expanded={details}>{details ? "Hide details" : "Exam details"}</button>
          {exam.version_count === 0 && <button className="qb-link-btn" onClick={() => void remove()}>Delete draft</button>}</div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {details && <div style={{ marginBottom: 16 }}><ExamForm exam={exam} onSaved={setExam} /></div>}
      <div role="tablist" aria-label="Exam steps" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 16px" }}>
        {TABS.map(([t, label]) => <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className={tab === t ? "qb-btn" : "qb-btn secondary"} onClick={() => setTab(t)}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ display: "grid", gap: 16 }}>
        {tab === "build" && <><TallyBar exam={exam} /><RoundBuilder exam={exam} onChange={setExam} /></>}
        {tab === "review" && <><TallyBar exam={exam} /><ReviewPanel exam={exam} onChange={setExam} /></>}
        {tab === "share" && <SharePanel exam={exam} />}
        {tab === "results" && <ResultsPanel examId={exam.id} hasVersion={exam.version_count > 0} />}
      </div>
    </>
  );
}
export default function MockExamPage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <AccessGate>{() => <Hub id={id} />}</AccessGate>; }
