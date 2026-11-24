"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { PUBLIC_LINKS } from "./links";

// The five groups in the learning loop, one at a time. Plain tabs: arrow keys move between them, Home and End jump to the first and last.
export const AUDIENCES = [
  { id: "students", label: "Students", color: "var(--blue)", title: "Practise your syllabus, one short session at a time",
    text: "Answer curriculum-aligned questions for your class and subject, get instant feedback on every answer, and join challenges and competitions with your class and school.", cta: "Start practising, free", href: PUBLIC_LINKS.registerStudent },
  { id: "parents", label: "Parents", color: "#a2246b", title: "A study habit you can follow from home",
    text: "Bring your children's learning into one family space. Follow what they complete, give them practice and challenges, and turn an evening of study into a routine you can celebrate.", cta: "See how it works for parents", href: "/parents" },
  { id: "teachers", label: "Teachers", color: "#0f7a30", title: "Assign in minutes, mark automatically",
    text: "Give your class curriculum-aligned questions, let automatic marking do the scoring, and use class mastery to see who needs help before the next lesson.", cta: "Create a teacher account", href: PUBLIC_LINKS.registerTeacher },
  { id: "schools", label: "Schools", color: "#00758c", title: "Classes, teachers and participation in one place",
    text: "See how classes take part across the school, keep assessment consistent, and prepare teams for challenges and competitions.", cta: "Register your school", href: PUBLIC_LINKS.school },
  { id: "sponsors", label: "Sponsors & alumni", color: "#9a5b00", title: "Support learners and see what happens",
    text: "Sponsor a curriculum-aligned challenge for your old school or a community. You choose who takes part and the recognition, QuizBox approves it before it goes live, and you follow participation and results.", cta: "Explore sponsoring", href: PUBLIC_LINKS.sponsor },
] as const;

export default function StakeholderTabs() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => { const next = (to + AUDIENCES.length) % AUDIENCES.length; setActive(next); refs.current[next]?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); move(active + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(active - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(AUDIENCES.length - 1); }
  };
  const current = AUDIENCES[active];
  return (
    <section id="loop" className="qbp-sec" aria-labelledby="qbp-loop-title" data-qb-section="stakeholder-tabs">
      <div className="qbp-wrap" style={{ display: "grid", gap: 20 }}>
        <div className="qbp-head" style={{ marginBottom: 0 }}>
          <p className="qbp-eyebrow">One platform, five groups</p>
          <h2 id="qbp-loop-title" className="qbp-h2">Learning works better when everyone around the learner is connected</h2>
        </div>
        <div role="tablist" aria-label="Who QuizBox is for" className="qbp-tabs" onKeyDown={onKey}>
          {AUDIENCES.map((a, i) => (
            <button key={a.id} type="button" role="tab" id={`loop-tab-${a.id}`} aria-selected={i === active} aria-controls={`loop-panel-${a.id}`} tabIndex={i === active ? 0 : -1}
              ref={(el) => { refs.current[i] = el; }} className="qbp-tab" style={i === active ? { borderBottomColor: a.color, color: a.color } : undefined} onClick={() => setActive(i)}>{a.label}</button>
          ))}
        </div>
        {AUDIENCES.map((a, i) => (
          <div key={a.id} role="tabpanel" id={`loop-panel-${a.id}`} aria-labelledby={`loop-tab-${a.id}`} hidden={i !== active} className="qbp-card qbp-tabpanel" style={{ borderTop: `3px solid ${a.color}` }}>
            <h3 className="qbp-h3" style={{ fontSize: 20 }}>{a.title}</h3>
            <p className="qbp-body" style={{ color: "#33415c" }}>{a.text}</p>
            <div className="qbp-actions"><Link className="qbp-btn" href={a.href}>{a.cta}</Link></div>
          </div>
        ))}
        <p className="qbp-meta" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{current.label} selected</p>
      </div>
    </section>
  );
}
