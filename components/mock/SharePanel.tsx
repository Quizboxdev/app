"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { assignToClass, classOptions, examAssignments, getListing, prepareListing, submitListing, unlistListing, type ClassOption, type Exam, type ExamAssignment, type Listing } from "@/lib/api/mock-exams";
import { cedis, ITEM_STATUS, TERM_OPTIONS } from "@/lib/api/marketplace";
import FamilyGivePanel from "@/components/mock/FamilyGivePanel";
import LinkPanel from "@/components/mock/LinkPanel";
import { formatDateTime } from "@/lib/format";
import { gradeLabel, stageLabel, stageOf } from "@/lib/mock-exams/grades";

// Giving the exam to learners: to a class the author teaches (teachers, free, through the normal assignments), to the children in a sponsor's family (free), by a link with places a sponsor pays for in Coins, or on the Marketplace for a price (teachers and verified organisation sponsors who are verified sellers). Selling is a choice the author makes here;
// nothing is listed until the author has reviewed the price and terms and sent the listing for staff review.
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default function SharePanel({ exam }: { exam: Exam }) {
  const published = Boolean(exam.current_version_id), archived = exam.status === "archived";
  if (!published) return <div className="qb-card"><h2>Share</h2><p className="qb-muted">Publish the exam first (Review and publish). Then you can {exam.owner_kind === "sponsor" ? "give it to your family, share it by link or sell it on the Marketplace" : "assign it to a class or sell it on the Marketplace"}.</p></div>;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {exam.owner_kind === "sponsor" ? <><FamilyGivePanel exam={exam} disabled={archived} /><LinkPanel exam={exam} disabled={archived} /></> : <AssignPanel exam={exam} disabled={archived} />}
      {(exam.owner_kind === "teacher" || exam.owner_kind === "sponsor") && <SellPanel exam={exam} disabled={archived} />}
    </div>
  );
}

function AssignPanel({ exam, disabled }: { exam: Exam; disabled: boolean }) {
  const [classes, setClasses] = useState<ClassOption[] | null>(null), [given, setGiven] = useState<ExamAssignment[] | null>(null), [cls, setCls] = useState(""), [start, setStart] = useState(nowLocal()), [due, setDue] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  const stage = stageOf(exam.target_grade);
  const load = useCallback(() => { classOptions().then(setClasses).catch((e) => { setError(e.message); setClasses([]); }); examAssignments(exam.id).then(setGiven).catch(() => setGiven([])); }, [exam.id]);
  useEffect(() => { load(); }, [load]);
  const fitting = (classes ?? []).filter((c) => c.stage === stage);

  async function assign() {
    setBusy(true); setError(""); setDone("");
    try { const a = await assignToClass(exam.id, cls, toIso(start), toIso(due)); setDone(`Assigned version ${a.version_no} to the class. Learners will find it in their assignments.`); setCls(""); load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  return (
    <section className="qb-card qb-form" aria-label="Assign to a class">
      <h2 style={{ margin: 0 }}>Assign to a class</h2>
      <p className="qb-muted qb-small" style={{ margin: 0 }}>Learners in the class take version {exam.current_version_no} in their normal assignments. Marking, time limit, attempts and late rules are the usual ones. Only classes at the {stageLabel(stage)} stage fit this exam.</p>
      {error && <p className="qb-error" role="alert">{error}</p>}{done && <p className="qb-ok" role="status">{done}</p>}
      {classes === null ? <p className="qb-muted">Loading…</p> : !fitting.length ? <p className="qb-muted">You have no active {stageLabel(stage)} class. <Link className="qb-link" href="/teacher/classes">Create or open a class</Link>.</p> :
        <div className="qb-grid cols-3">
          <div className="qb-field"><label htmlFor="as-class">Class</label><select id="as-class" value={cls} onChange={(e) => setCls(e.target.value)} disabled={disabled}><option value="">Choose a class</option>{fitting.map((c) => <option key={c.id} value={c.id}>{c.class_name} · {gradeLabel(c.grade_code)} · {c.learners} learners</option>)}</select></div>
          <div className="qb-field"><label htmlFor="as-start">Opens</label><input id="as-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} disabled={disabled} /></div>
          <div className="qb-field"><label htmlFor="as-due">Closes (optional)</label><input id="as-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} disabled={disabled} /></div>
        </div>}
      <div><button className="qb-btn" disabled={busy || disabled || !cls} onClick={() => void assign()}>{busy ? "Assigning…" : "Assign to this class"}</button></div>
      {!!given?.length && <><h3 style={{ margin: "8px 0 0" }}>Already assigned</h3>
        <ul className="qb-list">{given.map((g) => <li key={g.assignment_id}>{g.class_name} · version {g.version_no} · {g.learners} learners · {g.due_at ? `closes ${formatDateTime(g.due_at)}` : "no closing time"}</li>)}</ul></>}
    </section>
  );
}

function SellPanel({ exam, disabled }: { exam: Exam; disabled: boolean }) {
  const [listing, setListing] = useState<Listing | null | undefined>(undefined), [on, setOn] = useState(false), [price, setPrice] = useState(""), [description, setDescription] = useState(exam.description), [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  useEffect(() => { getListing(exam.id).then((l) => { setListing(l); if (l) { setOn(true); setPrice(String(l.price_minor / 100)); setDescription(l.description); setTerm(l.term ?? ""); } }).catch(() => setListing(null)); }, [exam.id]);
  const locked = listing ? listing.status === "approved" || listing.status === "submitted" : false;
  const cedisValue = Number(price), valid = Number.isInteger(cedisValue) && cedisValue >= 5 && cedisValue <= 200;

  async function act(fn: () => Promise<Listing>, ok: string) { setBusy(true); setError(""); setDone(""); try { setListing(await fn()); setDone(ok); } catch (e) { setError((e as Error).message); } setBusy(false); }
  if (listing === undefined) return <div className="qb-card qb-muted" role="status">Loading…</div>;

  return (
    <section className="qb-card qb-form" aria-label="Sell on the Marketplace">
      <h2 style={{ margin: 0 }}>Sell on marketplace</h2>
      <label className="qb-check"><input type="checkbox" checked={on} disabled={disabled || !!listing} onChange={(e) => setOn(e.target.checked)} /> Sell this exam on the Marketplace so learners outside my classes can buy it</label>
      {!on && <p className="qb-muted qb-small" style={{ margin: 0 }}>Off. Nothing is listed or priced until you choose to sell.</p>}
      {error && <p className="qb-error" role="alert">{error} {/QB_NOT_A_SELLER|seller account first/i.test(error) && <Link className="qb-link" href="/seller">Open seller set-up</Link>}</p>}
      {done && <p className="qb-ok" role="status">{done}</p>}
      {on && <>
        {!locked && !disabled && <div className="qb-grid cols-2">
          <div className="qb-field"><label htmlFor="sl-price">Price (whole cedis, GHS 5 to GHS 200)</label><input id="sl-price" type="number" inputMode="numeric" min={5} max={200} step={1} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 20" />
            {price && !valid && <span className="qb-error qb-small">Enter a whole number of cedis from 5 to 200.</span>}</div>
          <div className="qb-field"><label htmlFor="sl-term">Term (optional)</label><select id="sl-term" value={term} onChange={(e) => setTerm(e.target.value)}><option value="">Not term-specific</option>{TERM_OPTIONS.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="qb-field" style={{ gridColumn: "1 / -1" }}><label htmlFor="sl-desc">What buyers read (up to 800 characters)</label><textarea id="sl-desc" maxLength={800} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>}
        {!locked && !disabled && <div><button className="qb-btn" disabled={busy || !valid} onClick={() => void act(() => prepareListing(exam.id, cedisValue * 100, description, term), "Listing saved as a draft. Review it below, then send it for review.")}>{busy ? "Saving…" : listing ? "Update the draft listing" : "Prepare the listing"}</button></div>}
        {listing && <div className="qb-card" aria-label="Listing preview" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{listing.title}</strong><span className={`qb-pill ${listing.status === "approved" ? "success" : listing.status === "rejected" ? "danger" : "warning"}`}>{ITEM_STATUS[listing.status] ?? listing.status}</span></div>
          <ul className="qb-list" style={{ margin: 0 }}>
            <li><strong>What is sold:</strong> version {listing.version_no} of this exam, {listing.question_count} questions, {gradeLabel(listing.grade)}, {listing.subject}.</li>
            <li><strong>Price buyers see:</strong> {cedis(listing.price_minor)}</li>
            <li><strong>You receive:</strong> {cedis(listing.seller_share_minor)} ({listing.seller_share_percent}%); QuizBox keeps {cedis(listing.platform_fee_minor)}. Payments are held for a few days before you can request a payout.</li>
            <li><strong>Buyer terms:</strong> access for {listing.access_days} days from payment, as many attempts as the exam allows ({exam.attempts_allowed}). Buyers see the exam’s shape before paying and never the questions or answers. A refund ends their access to new attempts and takes your share back.</li>
            <li><strong>Your buyers:</strong> you see their results as “Buyer 1, 2 …” with no names, emails or schools.</li>
          </ul>
          {listing.behind_current && <p className="qb-error" role="alert">You have published a newer version of this exam. This listing sells version {listing.version_no}.{locked ? " Take it off sale and prepare it again to sell the newer version." : " Update the draft listing to sell the newer version."}</p>}
          {listing.status === "rejected" && listing.review_note && <p className="qb-error" role="alert">Staff asked for changes: {listing.review_note}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(listing.status === "draft" || listing.status === "rejected" || listing.status === "unlisted") && !disabled && <button className="qb-btn" disabled={busy} onClick={() => void act(() => submitListing(exam.id), "Sent for review. Staff check it before it goes on sale.")}>Send for review</button>}
            {(listing.status === "approved" || listing.status === "submitted") && <button className="qb-btn secondary" disabled={busy} onClick={() => void act(() => unlistListing(exam.id), "Taken off sale. People who already bought it keep their access.")}>Take off sale</button>}
            {listing.status === "approved" && <Link className="qb-btn secondary" href={`/marketplace/${listing.slug}`}>See it in the Marketplace</Link>}
          </div>
          {listing.status === "approved" && <p className="qb-small qb-muted" style={{ margin: 0 }}>{listing.sales ?? 0} sold so far.</p>}
        </div>}
      </>}
    </section>
  );
}
