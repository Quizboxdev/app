"use client";

import type { Exam } from "@/lib/api/mock-exams";
import { nextStep, stepText, tallyLines } from "@/lib/mock-exams/tally";

// The running tally while the exam is built: desired, allocated to rounds, chosen, and what is still to do. Announced politely so a screen reader hears it change.
export default function TallyBar({ exam }: { exam: Exam }) {
  const t = exam.totals, step = nextStep(t, exam.rounds), pct = t.desired ? Math.min(100, Math.round((100 * t.selected) / t.desired)) : 0;
  return (
    <section className="qb-card" aria-label="Exam tally">
      <dl className="qb-stat-list">{tallyLines(t).map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{l.value}</dd></div>)}</dl>
      <div className="qb-progress-track" role="progressbar" aria-label="Questions chosen" aria-valuemin={0} aria-valuemax={t.desired} aria-valuenow={t.selected} style={{ margin: "12px 0 8px" }}><div style={{ width: `${pct}%`, height: "100%", background: "var(--qb-primary)" }} /></div>
      <p role="status" aria-live="polite" style={{ margin: 0 }}><strong>Next:</strong> {stepText(step)}</p>
    </section>
  );
}
