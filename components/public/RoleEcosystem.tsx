const ROLES = [
  { href: "#students", title: "Students", tag: "Learn · Practise · Compete", text: "Curriculum practice, feedback and challenges.", color: "var(--blue)" },
  { href: "#teachers", title: "Teachers", tag: "Teach · Assign · Monitor", text: "Assignments, class mastery and intervention.", color: "var(--green)" },
  { href: "#schools", title: "Schools", tag: "Organize · Support · Measure", text: "Classes, teachers and participation in one place.", color: "#00758c" },
  { href: "#sponsors", title: "Sponsors", tag: "Support · Challenge · Recognize", text: "Support curriculum-aligned challenges for learners.", color: "#9a5b00" },
  { href: "#smes", title: "Subject experts", tag: "Review · Verify · Improve", text: "Human review of content before it reaches learners.", color: "var(--purple)" },
];

export default function RoleEcosystem() {
  return (
    <section id="who" className="qbp-sec" aria-labelledby="qbp-who-title" data-qb-section="personas" data-qb-source="static">
      <div className="qbp-wrap">
        <div className="qbp-head">
          <p className="qbp-eyebrow">Who QuizBox is for</p>
          <h2 id="qbp-who-title" className="qbp-h2">Everyone in the learning loop has a clear role</h2>
        </div>
        <ul className="qbp-personas" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {ROLES.map((role) => (
            <li key={role.title} style={{ display: "grid" }}>
              <a href={role.href} className="qbp-card qbp-persona" style={{ borderTopColor: role.color }}>
                <span className="qbp-h3">{role.title}</span>
                <span className="qbp-persona-tag" style={{ color: role.color }}>{role.tag}</span>
                <span className="qbp-meta" style={{ fontSize: 14 }}>{role.text}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
