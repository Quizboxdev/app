"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dumbbell } from "lucide-react";
import { findLearnerGradeRoot, listCurricula } from "@/lib/api/curriculum";
import { bootstrapUser } from "@/lib/auth";
import { gradeVariants, studentGrade } from "@/lib/learning/student-scope";
import { practiseHref } from "@/lib/learning/labels";
import CurriculumBrowser, { nodeLevelName, type CurriculumBrowserNode } from "@/components/CurriculumBrowser";

// Learn: Education level → Grade → Subject → Strand → Sub-strand → Content standard → Learning indicator, read from the existing
// curriculum_nodes tree by the shared CurriculumBrowser. Lesson content is not published through any API yet, so an indicator shows its
// curriculum record, how many approved questions exist for it, and the Practise hand-off (see the gap note on the page).
export default function LearnPage() {
  const [curricula, setCurricula] = useState<any[]>([]);
  const [curriculumId, setCurriculumId] = useState("");
  const [path, setPath] = useState<CurriculumBrowserNode[]>([]);
  const [error, setError] = useState("");
  // A learner sees only their own grade: the browser starts inside the grade node of their profile and cannot climb out of it.
  const [learnerRoot, setLearnerRoot] = useState<CurriculumBrowserNode | null>(null), [scoped, setScoped] = useState<"loading" | "learner" | "none" | "open">("loading");

  useEffect(() => {
    (async () => {
      const ctx = await bootstrapUser().catch(() => null);
      const profile = ctx?.studentProfile as Record<string, unknown> | null | undefined;
      if (ctx?.role === "STUDENT" && profile) {
        const root = await findLearnerGradeRoot(gradeVariants(studentGrade(profile)));
        if (root) { setLearnerRoot(root as CurriculumBrowserNode); setCurriculumId((root as any).curriculum_id); setScoped("learner"); } else setScoped("none");
        return;
      }
      const rows = await listCurricula();
      setCurricula(rows); setCurriculumId(rows[0]?.id ?? ""); setScoped("open");
    })().catch((e) => { setError(e.message); setScoped("open"); });
  }, []);

  const subject = path.find((n) => n.node_type === "subject");

  return (
    <>
      <div className="qb-page-head">
        <div><h1>Learn</h1><p>Follow the curriculum from subject to learning indicator, then practise what you learned.</p></div>
        {scoped === "open" && curricula.length > 1 && <label className="qb-field"><span className="qb-sr-only">Curriculum</span>
          <select value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)}>{curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>

      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      <section className="qb-card">
        {scoped === "none" ? <div className="qb-empty"><strong>Your grade is not published yet</strong>Questions for your class are being added. Check back soon.</div>
        : curriculumId ? <CurriculumBrowser curriculumId={curriculumId} root={learnerRoot} onPathChange={setPath} renderLeaf={(leaf, { available }) => (
          <div className="qb-launch-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div className="qb-launch">
              <p className="qb-overline">{nodeLevelName(leaf)}{leaf.code ? ` · ${leaf.code}` : ""}</p>
              <h2>{leaf.title}</h2>
              <p className="qb-muted">{available ? `${available} approved question${available === 1 ? "" : "s"} for this ${nodeLevelName(leaf).toLowerCase()}.` : "No approved questions for this item yet."}</p>
              <div className="qb-gap-note" role="note">Lesson notes and mini-checks for this item are not published yet. Practise uses approved questions from your published practice sets.</div>
              <Link className="qb-btn" href={practiseHref(subject?.subject_code ?? leaf.subject_code)}><Dumbbell size={16} aria-hidden="true" />Practise this subject</Link>
            </div>
          </div>
        )} /> : <div className="qb-empty"><strong>No curriculum available</strong>Your curriculum has not been published for your market yet.</div>}
      </section>
    </>
  );
}
