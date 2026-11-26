"use client";

import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { joinOptions, register, schoolHome } from "@/lib/api/interschool";
import { Head, Loading, Notice, useAction, useLoad } from "@/components/interschool/ui";
import { REGISTRATION, canRegister, sourceParam } from "@/lib/interschool/text";

// Where a campaign link ends after sign-in: a learner registers; school staff go to their roster. The database checks level, school and every limit.
function Join({ slug }: { slug: string }) {
  const source = sourceParam(useSearchParams().get("src"));
  const options = useLoad(() => joinOptions(slug), [slug]), staff = useLoad(() => schoolHome().catch(() => []));
  const act = useAction(async () => { await options.reload(); });
  const [division, setDivision] = useState(""), [school, setSchool] = useState(""), [agreed, setAgreed] = useState(false), [outcome, setOutcome] = useState("");
  const o = options.data;
  useEffect(() => { if (o) { setDivision((d) => d || o.divisions[0]?.id || ""); setSchool((s) => s || o.schools.find((x) => x.can_enter)?.id || ""); } }, [o]);
  if (o === undefined) return <><Head title="Register" /><Loading error={options.error} /></>;
  if (o === null) return <div className="qb-card"><h1>Competition not found</h1><p><Link className="qb-link" href="/inter-school">See open competitions</Link></p></div>;
  const staffSchools = (staff.data ?? []).filter((s) => s.competitions.some((c) => c.id === o.id));

  return (
    <>
      <Head title={o.title} lead={REGISTRATION[o.registration]} />
      <Notice error={act.error} done={outcome} />
      {staffSchools.map((s) => <div className="qb-card" key={s.institution_id}><h2>Enter learners for {s.school}</h2><p><Link className="qb-btn" href={`/interschool/school/${o.id}?school=${s.institution_id}`}>Open the school roster</Link></p></div>)}
      {o.mine ? <div className="qb-card" role="status"><strong>You are registered for {o.mine.division}.</strong> Status: {o.mine.status === "PENDING" ? "waiting for your school to confirm" : o.mine.status.toLowerCase()}. <Link className="qb-link" href="/interschool">My competitions</Link></div>
        : !o.learner ? (staffSchools.length === 0 && <div className="qb-card"><p>Only learner accounts register here. Teachers of a verified school enter learners from their school roster.</p></div>)
        : o.registration_mode === "TEACHER" ? <div className="qb-card"><p>Learners are entered by their school. Ask a teacher to enter you.</p></div>
        : !canRegister(o.registration) ? <div className="qb-card"><p>Registration is not open: {REGISTRATION[o.registration].toLowerCase()}.</p></div>
        : o.divisions.length === 0 ? <div className="qb-card"><p>This competition has no division for your class level{o.level ? ` (${o.level})` : ""}.</p></div>
        : o.managed ? <div className="qb-card"><p>Accounts managed by a teacher or parent cannot register themselves. Ask your school.</p></div>
        : (
          <form className="qb-card" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { const r = await register(slug, division, school || null, source); setOutcome(r.status === "PENDING" ? "Registered. Your school must now confirm your place." : r.status === "WAITLISTED" ? "All places are taken: you are on the waiting list." : "You are registered."); }); }}>
            <label className="qb-field">Division<select value={division} onChange={(e) => setDivision(e.target.value)}>{o.divisions.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
            <label className="qb-field">School<select value={school} onChange={(e) => setSchool(e.target.value)} required={!o.individual_allowed}>
              <option value="">{o.individual_allowed ? "I am entering on my own" : "Choose your school"}</option>
              {o.schools.map((s) => <option key={s.id} value={s.id} disabled={!s.can_enter}>{s.name}{!s.can_enter ? " (not invited)" : s.verified_member ? "" : " (your school must confirm)"}</option>)}</select></label>
            {o.schools.length === 0 && !o.individual_allowed && <p className="qb-muted">Your account is not linked to a verified school. Join your teacher&apos;s class with its code, then come back.</p>}
            {o.rules && <details><summary>Competition rules</summary><p style={{ whiteSpace: "pre-line" }}>{o.rules}</p></details>}
            <label className="qb-check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I have read the rules. My name and school may be shown to the organiser&apos;s schools in results, and publicly only as a short name.</label>
            <p><button className="qb-btn" disabled={act.busy || !agreed || !division || (!school && !o.individual_allowed)}>{act.busy ? "Registering…" : "Register"}</button></p>
          </form>)}
    </>
  );
}
export default function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <Suspense fallback={<div className="qb-card" role="status">Loading…</div>}><Join slug={slug} /></Suspense>;
}
