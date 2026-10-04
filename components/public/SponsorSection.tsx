import Link from "next/link";
import Disclosure from "./Disclosure";
import { PUBLIC_LINKS } from "./links";

export const SPONSOR_GROUPS = [
  { title: "Individuals & Alumni", text: "Individuals, parents, philanthropists, old students, alumni associations, diaspora supporters" },
  { title: "Companies & CSR", text: "Companies, CSR / ESG programmes, banks, telecoms, technology companies" },
  { title: "Foundations & NGOs", text: "Foundations and non-governmental organizations" },
  { title: "Education & Professional Bodies", text: "Schools, universities and professional associations" },
  { title: "Public Institutions", text: "Public institutions and district / local authorities, where appropriate" },
  { title: "Community Organizations", text: "Families, community groups and faith organizations" },
  { title: "Development Partners", text: "Development organizations and other approved education-supporting organizations" },
];

const MOTIVATIONS = [
  "An old student wants to support their former school.",
  "An alumni association wants to run an inter-house or inter-school challenge.",
  "An individual wants to reward students who perform well in Mathematics.",
  "A foundation wants to stimulate interest in STEM.",
  "A company wants to support learning through its CSR programme.",
  "A professional body wants to encourage students into its discipline.",
  "An NGO wants to improve participation in a target region.",
  "A university wants to run an academic challenge.",
  "A community group wants to reward learners in its area.",
];

const PHASES = [
  { title: "1 · Define", text: "Objective, market, curriculum and level, audience, format" },
  { title: "2 · Build & review", text: "Supporting material, content generation or curation, SME review" },
  { title: "3 · Approve & publish", text: "Governance and approval, then publication" },
  { title: "4 · Run & recognize", text: "Participants, tracking, recognition, analytics" },
];

const STEPS = [
  "Define the education objective", "Select the country / market", "Select curriculum, level, grade and subject", "Define the intended learner audience",
  "Set the competition format", "Provide approved supporting material where relevant", "Generate or curate competition content", "Submit content into the SME review workflow",
  "Complete governance / approval requirements", "Publish the competition", "Invite or register participants", "Track participation and results",
  "Recognize winners and participants", "Review competition analytics",
];

export default function SponsorSection() {
  return (
    <section id="sponsors" className="qbp-sec" aria-labelledby="qbp-sponsors-title" data-qb-section="sponsor" data-qb-source="static">
      <div className="qbp-wrap" style={{ display: "grid", gap: 24 }}>
        <div className="qbp-head-row" style={{ marginBottom: 0 }}>
          <div className="qbp-head">
            <p className="qbp-eyebrow" style={{ color: "#9a5b00" }}>For sponsors · Support · Challenge · Recognize</p>
            <h2 id="qbp-sponsors-title" className="qbp-h2">Turn education support into participation, motivation and measurable impact</h2>
            <p className="qbp-lead">Create or support curriculum-aligned challenges, define the learners you want to reach, recognize performance and participation, and follow activity through competition and engagement data.</p>
          </div>
          <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.sponsor}>Register sponsor interest</Link></div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <h3 className="qbp-h3">Who can sponsor</h3>
          <p className="qbp-body">Individuals, alumni groups, foundations, NGOs, companies and other approved education partners. You don&apos;t need to be a large institution.</p>
          <div className="qbp-grid">
            {SPONSOR_GROUPS.map((g) => <div key={g.title} className="qbp-card"><h4 className="qbp-h3" style={{ fontSize: 16 }}>{g.title}</h4><p className="qbp-meta">{g.text}</p></div>)}
          </div>
          <p className="qbp-meta">Sponsor onboarding and competition approval are subject to QuizBox governance. Belonging to a group does not mean automatic acceptance.</p>
        </div>

        <div className="qbp-split">
          <div className="qbp-card" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
            <span className="qbp-badge">Example · Old students&apos; association</span>
            <p className="qbp-body" style={{ fontSize: 14, color: "#33415c" }}>Sponsors a Mathematics Challenge for its former school or a group of schools, defines eligible learners and approved prizes, and uses QuizBox for the curriculum-based competition, rankings and participation reporting.</p>
          </div>
          <div className="qbp-card" style={{ background: "var(--color-primary-soft)", borderColor: "#bfd4ff" }}>
            <span className="qbp-badge" style={{ background: "#fff", color: "var(--blue2)" }}>Example · Individual or diaspora supporter</span>
            <p className="qbp-body" style={{ fontSize: 14, color: "#33415c" }}>Sponsors an approved learning challenge for a school, community or learner group without building a competition platform themselves.</p>
          </div>
        </div>

        <Disclosure title="Why people sponsor, and all sponsor types">
          <div style={{ display: "grid", gap: 14 }}>
            <ul className="qbp-list">{MOTIVATIONS.map((m) => <li key={m}>{m}</li>)}</ul>
            <p className="qbp-meta">All potential sponsor types: individuals; parents and philanthropists; old students / alumni; old students&apos; and alumni associations; families and community groups; foundations; NGOs; companies; corporate CSR / ESG programmes; banks; telecommunications companies; technology companies; universities; professional associations; religious and community organizations; development organizations; public institutions; district / local authorities where appropriate; other approved education-supporting organizations. All subject to approval.</p>
          </div>
        </Disclosure>

        <div style={{ display: "grid", gap: 12 }}>
          <h3 className="qbp-h3">How a sponsored competition comes together</h3>
          <div className="qbp-grid">
            {PHASES.map((p) => <div key={p.title} className="qbp-card"><span className="qbp-step" style={{ color: "var(--blue)" }}>{p.title}</span><p className="qbp-meta">{p.text}</p></div>)}
          </div>
          <Disclosure title="See all 14 steps">
            <ol className="qbp-list">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
            <p className="qbp-meta" style={{ marginTop: 8 }}>Available options depend on the market, competition type and QuizBox approval.</p>
          </Disclosure>
        </div>

        <div className="qbp-split">
          <div className="qbp-card">
            <h3 className="qbp-h3">Prizes and recognition</h3>
            <p className="qbp-meta" style={{ fontSize: 14 }}>Sponsors may define approved prizes, recognition or incentives appropriate to the competition.</p>
            <p className="qbp-meta"><strong>Examples only:</strong> certificates, trophies, learning materials, devices, educational support, scholarships, connectivity / data support, other sponsor-approved rewards.</p>
            <p className="qbp-meta">Prize availability, eligibility and fulfilment depend on the specific competition and sponsor. Prizes are provided by the sponsor, not guaranteed by QuizBox.</p>
          </div>
          <div className="qbp-card">
            <h3 className="qbp-h3">What sponsors can follow</h3>
            <p className="qbp-meta" style={{ fontSize: 14 }}>Measure participation, performance and engagement across your competition.</p>
            <ul className="qbp-list">
              <li>Registrations and participation funnel</li>
              <li>Completion and score distribution</li>
              <li>Aggregated, privacy-preserving demographics</li>
              <li>Question performance and results</li>
              <li>Leaderboards, where applicable</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
