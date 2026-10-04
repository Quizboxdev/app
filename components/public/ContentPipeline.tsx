const STEPS: Array<{ label: string; human?: boolean }> = [
  { label: "Official curriculum / approved source" },
  { label: "Question authoring or assisted generation" },
  { label: "SME review", human: true },
  { label: "QA / senior review where required", human: true },
  { label: "Approved question bank" },
  { label: "Assessments, assignments, competitions" },
  { label: "Learner performance" },
  { label: "Analytics and quality feedback" },
];

export default function ContentPipeline() {
  return (
    <section id="pipeline" className="qbp-sec qbp-alt" aria-labelledby="qbp-pipeline-title" data-qb-section="content-pipeline" data-qb-source="static">
      <div className="qbp-wrap">
        <div className="qbp-head">
          <p className="qbp-eyebrow">Trusted content</p>
          <h2 id="qbp-pipeline-title" className="qbp-h2">How content moves through QuizBox</h2>
          <p className="qbp-lead">Questions are written by educators or drafted with technology support. Either way, qualified people approve them.</p>
        </div>
        <ol className="qbp-steps">
          {STEPS.map((step, index) => (
            <li key={step.label} className={`qbp-card${step.human ? " qbp-step-human" : ""}`} style={{ padding: 14 }}>
              <span className="qbp-step">{index + 1}{step.human ? " · Human review" : ""}</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{step.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
