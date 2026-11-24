"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { joinLink, linkInfo, type LinkInfo } from "@/lib/api/mock-exams";
import { gradeLabel } from "@/lib/mock-exams/grades";
import { purposeLabel } from "@/lib/mock-exams/purposes";

// Where a person lands from a sponsor's mock-exam link. They must be signed in (the app asks them to sign up or sign in first) with a learner account. Joining takes one of the places the sponsor paid for and
// puts the exam under My question sets, in "My mock exams". Nothing here shows a question or an answer.
function Join({ code }: { code: string }) {
  const [info, setInfo] = useState<LinkInfo | undefined>(undefined), [error, setError] = useState(""), [busy, setBusy] = useState(false), router = useRouter();
  useEffect(() => { linkInfo(code).then(setInfo).catch((e) => { setError((e as Error).message); setInfo(null); }); }, [code]);
  async function join() {
    setBusy(true); setError("");
    try { await joinLink(code); router.push("/marketplace/mine"); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  if (info === undefined) return <div className="qb-card qb-muted" role="status">Loading…</div>;
  if (!info) return <div className="qb-card"><h1>We could not find this exam</h1><p className="qb-muted">{error || "Check the link with the person who sent it."}</p><Link className="qb-btn secondary" href="/">Go home</Link></div>;
  const closed = !info.open && !info.joined, full = info.full && !info.joined;
  return (
    <>
      <div className="qb-page-head"><div><h1>{info.title}</h1><p>A mock exam shared by <strong>{info.from}</strong>.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <section className="qb-card" style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0 }}><span className="qb-pill teal">{gradeLabel(info.target_grade)}</span> <span className="qb-pill neutral">{purposeLabel(info.purpose)}</span></p>
        {info.description && <p style={{ margin: 0 }}>{info.description}</p>}
        <p className="qb-muted" style={{ margin: 0 }}>{info.question_count} questions · {info.total_marks} marks · {info.time_limit_minutes} minutes · {info.attempts_allowed} {info.attempts_allowed === 1 ? "attempt" : "attempts"}. It stays yours for {info.access_days} days after you join.</p>
        {info.mine ? <p className="qb-muted" style={{ margin: 0 }}>This is your own link. Share it with the people you want to take the exam.</p> :
          info.joined ? <><p className="qb-ok" style={{ margin: 0 }}>You have joined this exam.</p><Link className="qb-btn" href="/marketplace/mine">Open My mock exams</Link></> :
          closed ? <p className="qb-error" style={{ margin: 0 }}>This link is closed, so nobody new can join.</p> :
          full ? <p className="qb-error" style={{ margin: 0 }}>All the places on this link have been taken.</p> :
          <div><button className="qb-btn" disabled={busy} onClick={() => void join()}>{busy ? "Joining…" : "Join this exam"}</button>
            <p className="qb-small qb-muted" style={{ margin: "8px 0 0" }}>Joining is free for you. The person who shared it has paid for your place. You need a learner account; the exam appears under My question sets.</p></div>}
      </section>
    </>
  );
}
export default function JoinMockExamPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <Join code={code.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)} />;
}
