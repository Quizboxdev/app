"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Eye, EyeOff, Printer } from "lucide-react";
import { RichContent } from "@/components/QuestionRenderer";
import { getStaffPracticePreview, type StaffPreview } from "@/lib/api/practice";

// A teacher's or admin's own practice set: every question with a reveal button for the answer and explanation. Read-only; it records nothing.
export default function PracticePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<StaffPreview | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => { getStaffPracticePreview(String(id)).then(setData).catch((e) => setError(e.message)); }, [id]);
  const isShown = (n: number) => all || shown.includes(n);

  if (error) return <div className="qb-card qb-error" role="alert">{error} <Link href="/practise">Back to Practise</Link></div>;
  if (!data) return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" />;
  return (
    <>
      <div className="qb-page-head"><div><h1>{data.subject} · {data.grade}</h1><p>{data.questions.length} questions. Reveal each answer when you are ready, or show them all.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn secondary" onClick={() => setAll(!all)}>{all ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} {all ? "Hide all answers" : "Show all answers"}</button>
          <button className="qb-btn secondary" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> Print</button>
          <Link className="qb-btn" href="/practise">Build another</Link>
        </div></div>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {data.questions.map((q) => {
          const opts = (["a", "b", "c", "d"] as const).filter((k) => q[k]);
          return <li key={q.n} className="qb-card">
            <div className="qb-small qb-muted">Question {q.n}</div>
            <div className="qb-question-text"><RichContent content={q.content} fallback={q.question} /></div>
            <ol type="A" style={{ margin: "8px 0 0", paddingInlineStart: 22 }}>
              {opts.map((k) => <li key={k} style={isShown(q.n) && q.correct === k.toUpperCase() ? { fontWeight: 700, color: "var(--green, #15803d)" } : undefined}>
                {q[k]}{isShown(q.n) && q.correct === k.toUpperCase() ? "  ✓" : ""}</li>)}
            </ol>
            {isShown(q.n) && q.explanation && <p className="qb-small" style={{ marginTop: 8 }}><strong>Why:</strong> {q.explanation}</p>}
            {!all && <button type="button" className="qb-btn secondary" style={{ marginTop: 8 }} aria-expanded={isShown(q.n)}
              onClick={() => setShown(isShown(q.n) ? shown.filter((x) => x !== q.n) : [...shown, q.n])}>{isShown(q.n) ? "Hide answer" : "Show answer"}</button>}
          </li>;
        })}
      </ol>
    </>
  );
}
