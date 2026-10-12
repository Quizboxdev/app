import type { PublicPlatformStats } from "@/lib/public/platform-stats";

// Live platform figures from the user and question databases (public.qb_public_platform_stats, counts only). When the figures cannot
// be read the strip falls back to qualitative claims: a number is never invented, hard-coded or illustrative.
const QUALITATIVE = [
  { title: "Curriculum aligned", text: "Linked to approved sources" },
  { title: "Educator reviewed", text: "SME and QA before use" },
  { title: "Country first", text: "Each market, its own curriculum" },
  { title: "Competition ready", text: "Practice that becomes a challenge" },
];
const fmt = (n: number) => n.toLocaleString("en-GB");

export default function PlatformStats({ stats = null }: { stats?: PublicPlatformStats | null }) {
  if (!stats) {
    return (
      <section className="qbp-wrap" aria-label="Platform highlights" data-qb-section="stats" data-qb-source="static">
        <div className="qbp-strip">
          {QUALITATIVE.map((s) => <div key={s.title}><strong>{s.title}</strong><span className="qbp-meta">{s.text}</span></div>)}
        </div>
      </section>
    );
  }
  const groups: Array<{ heading: string; items: Array<{ value: number; label: string }> }> = [
    { heading: "Learners", items: [
      { value: stats.learners.primary, label: "Primary" }, { value: stats.learners.jhs, label: "JHS" },
      { value: stats.learners.shs, label: "SHS" } ] },
    { heading: "Community", items: [
      { value: stats.people.teachers, label: "Teachers" }, { value: stats.people.reviewers, label: "Verified reviewers" },
      { value: stats.people.schools, label: "Schools" }, { value: stats.people.sponsors, label: "Sponsors" } ] },
    { heading: "Content", items: [
      { value: stats.questions.total, label: "Approved questions" }, { value: stats.indicators.total, label: "Curriculum indicators mapped" } ] },
  ];
  return (
    <section className="qbp-wrap" aria-label="Platform figures" data-qb-section="stats" data-qb-source="platform.stats">
      <div style={{ display: "grid", gap: 14 }}>
        {groups.map((g) => <div key={g.heading}>
          <p className="qbp-meta" style={{ marginBottom: 6 }}>{g.heading}</p>
          <div className="qbp-strip">{g.items.map((s) => <div key={s.label}><span className="qbp-stat">{fmt(s.value)}</span><span className="qbp-meta">{s.label}</span></div>)}</div>
        </div>)}
        <p className="qbp-meta">Live figures from the QuizBox platform{stats.asOf ? `, updated ${new Date(stats.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.</p>
      </div>
    </section>
  );
}
