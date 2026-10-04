// Platform figures. No safe public aggregate exists yet (PUBLIC_PLATFORM_STATS_CONTRACT_REQUIRED),
// so production shows a qualitative strip with no numbers. The approved illustrative figures can
// be shown for design review only with NEXT_PUBLIC_QB_SHOW_ILLUSTRATIVE_STATS=true, and are always
// labelled as illustrative.
const ILLUSTRATIVE = [
  { value: "17,100", label: "Live questions" },
  { value: "9", label: "Active banks" },
  { value: "JHS 1–3", label: "Curriculum levels" },
  { value: "4", label: "Ways to learn" },
];

const QUALITATIVE = [
  { title: "Curriculum aligned", text: "Linked to approved sources" },
  { title: "Educator reviewed", text: "SME and QA before use" },
  { title: "Country first", text: "Each market, its own curriculum" },
  { title: "Competition ready", text: "Practice that becomes a challenge" },
];

export default function PlatformStats() {
  const illustrative = process.env.NEXT_PUBLIC_QB_SHOW_ILLUSTRATIVE_STATS === "true";
  return (
    <section className="qbp-wrap" aria-label="Platform highlights" data-qb-section="stats" data-qb-source={illustrative ? "platform.stats" : "static"}>
      {illustrative ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="qbp-strip">
            {ILLUSTRATIVE.map((s) => <div key={s.label}><span className="qbp-stat">{s.value}</span><span className="qbp-meta">{s.label}</span></div>)}
          </div>
          <p className="qbp-meta">Illustrative figures. Live platform figures appear here once connected.</p>
        </div>
      ) : (
        <div className="qbp-strip">
          {QUALITATIVE.map((s) => <div key={s.title}><strong>{s.title}</strong><span className="qbp-meta">{s.text}</span></div>)}
        </div>
      )}
    </section>
  );
}
