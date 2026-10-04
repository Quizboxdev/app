import Link from "next/link";
import Disclosure from "./Disclosure";
import { PUBLIC_LINKS } from "./links";

export const SME_COMPENSATION =
  "Where compensation applies, eligible completed reviews may become payable under the applicable QuizBox compensation policy after required quality checks.";

export default function SmeSection() {
  return (
    <section id="smes" className="qbp-sec qbp-alt" aria-labelledby="qbp-smes-title" data-qb-section="sme" data-qb-source="static">
      <div className="qbp-wrap" style={{ display: "grid", gap: 20 }}>
        <div className="qbp-head-row" style={{ marginBottom: 0 }}>
          <div className="qbp-head">
            <p className="qbp-eyebrow" style={{ color: "var(--purple)" }}>For subject matter experts · Review · Verify · Improve</p>
            <h2 id="qbp-smes-title" className="qbp-h2">The human in the loop behind QuizBox content</h2>
            <p className="qbp-lead">Technology helps QuizBox scale content workflows. Qualified educators provide professional educational judgment, reviewing content for curriculum alignment, accuracy, difficulty, cognitive demand, clarity and answer quality before approved questions enter learning workflows.</p>
          </div>
          <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.sme}>Apply to become a QuizBox SME</Link></div>
        </div>
        <div className="qbp-grid-3">
          <div className="qbp-card">
            <h3 className="qbp-h3">Who may apply</h3>
            <p className="qbp-meta">Teachers · retired teachers · examiners · curriculum specialists · lecturers · subject experts · qualified education professionals</p>
            <p className="qbp-meta">Applicants are evaluated against QuizBox subject, market, curriculum and quality requirements.</p>
          </div>
          <div className="qbp-card">
            <h3 className="qbp-h3">What SMEs may do</h3>
            <p className="qbp-meta">Check source alignment, verify answers, review distractors, assess difficulty and cognitive level, clarify ambiguity, improve explanations, approve or request revision, and escalate where needed.</p>
          </div>
          <div className="qbp-card">
            <h3 className="qbp-h3">Paid review opportunities</h3>
            <p className="qbp-meta">{SME_COMPENSATION} Being assigned an item does not by itself make it payable.</p>
          </div>
        </div>
        <Disclosure title="How SMEs take part">
          <ol className="qbp-list">
            <li>Apply</li>
            <li>Qualification and subject review</li>
            <li>Approval for eligible subject and market areas</li>
            <li>Receive review assignments based on policy and capacity</li>
            <li>Complete reviews within QuizBox quality requirements</li>
            <li>Eligible completed work proceeds through the applicable QA and compensation process</li>
          </ol>
        </Disclosure>
      </div>
    </section>
  );
}
