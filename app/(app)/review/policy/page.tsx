import { displayValue, reviewerPolicy, type ReviewerPolicy } from "@/lib/sme/reviewer-policy";

// Reviewer policy: rendered from config/reviewer-policy.json. Revise the file, raise its version, deploy; this page needs no change.
export default function ReviewerPolicyPage() {
  let policy: ReviewerPolicy;
  try { policy = reviewerPolicy(); } catch (e) { return <div className="qb-card qb-error" role="alert">{(e as Error).message}</div>; }
  const tag = (s?: string) => s === "owner_set" ? "Owner to set" : s === "proposed" ? "Proposed" : s === "default" ? "Current setting" : null;
  return <>
    <div className="qb-page-head"><div><h1>Reviewer policy</h1>
      <p>How reviewers are chosen, paced, paid and quality-checked. Version {policy.version} · {policy.status === "APPROVED" ? "Approved" : "Proposed, awaiting owner approval"} · updated {policy.updated}.</p></div></div>
    {policy.sections.map((s) => <section key={s.id} className="qb-card" aria-labelledby={`pol-${s.id}`} style={{ marginBottom: 16 }}>
      <h2 id={`pol-${s.id}`}>{s.title}</h2><p className="qb-muted">{s.summary}</p>
      <ul className="qb-task-list">{s.rules.map((r) => <li key={r.id}>
        <div className="qb-row-main"><span>{r.text}</span>{displayValue(r) && <strong>{displayValue(r)}</strong>}</div>
        {tag(r.status) && <span className="qb-small qb-muted">{tag(r.status)}</span>}
      </li>)}</ul>
    </section>)}
    <p className="qb-gap-note">{policy.how_to_revise}</p>
  </>;
}
