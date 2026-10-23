"use client";

import HelpLink from "@/components/help/HelpLink";
import { useEffect, useMemo, useState } from "react";
import { KeyRound, Printer, UserMinus } from "lucide-react";
import { bootstrapUser } from "@/lib/auth";
import { listTeacherClasses } from "@/lib/api/teacher";
import { archiveManagedLearner, createManagedLearners, listManagedLearners, resetManagedPassword, type ManagedLearner, type NewLearner } from "@/lib/api/managed";
import { parseNamesBrowser } from "@/lib/managed/names";

// Young learners (under 13) do not register themselves. A teacher adds the learners of a class here: first names only, no email, no phone.
// Each child gets a username and a password on a printed card. The password is shown once, here, and is never stored; a reset makes a new one.
export default function YoungLearnersPage() {
  const [classes, setClasses] = useState<any[] | null>(null), [classId, setClassId] = useState("");
  const [roster, setRoster] = useState<ManagedLearner[]>([]);
  const [text, setText] = useState(""), [consentOk, setConsentOk] = useState(false), [consentRef, setConsentRef] = useState("");
  const [cards, setCards] = useState<NewLearner[]>([]), [failed, setFailed] = useState<{ name: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  useEffect(() => { bootstrapUser().then((ctx) => listTeacherClasses(String((ctx as any).teacherProfile?.id ?? ""))).then((rows) => { setClasses(rows as any[]); if (rows?.[0]) setClassId(String((rows[0] as any).id)); }).catch((e) => { setError(e.message); setClasses([]); }); }, []);
  const loadRoster = (id: string) => { if (id) listManagedLearners(id).then(setRoster).catch(() => setRoster([])); };
  useEffect(() => { loadRoster(classId); setCards([]); setFailed([]); }, [classId]);
  const parsed = useMemo(() => parseNamesBrowser(text), [text]);
  const klass = classes?.find((c) => String(c.id) === classId);

  async function create() {
    setBusy(true); setError(""); setDone("");
    try {
      const r = await createManagedLearners(classId, parsed.names, consentRef.trim());
      setCards(r.created); setFailed(r.failed); setText(""); loadRoster(classId);
      setDone(`${r.created.length} account${r.created.length === 1 ? "" : "s"} created. Print the cards now: the passwords are not shown again.`);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  async function reset(l: ManagedLearner) {
    if (!window.confirm(`Set a new password for ${l.first_name}? The old one stops working.`)) return;
    setBusy(true); setError(""); setDone("");
    try { const r = await resetManagedPassword(l.user_id); setCards([{ first_name: l.first_name, username: l.username, password: r.password }]); setFailed([]); setDone(`New password for ${l.first_name}. Print the card now: it is not shown again.`); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  async function end(l: ManagedLearner) {
    if (!window.confirm(`End ${l.first_name}'s account? They will no longer be able to sign in. Their learning history is kept by the school.`)) return;
    setBusy(true); setError(""); setDone("");
    try { await archiveManagedLearner(l.user_id); setDone(`${l.first_name}'s account has ended.`); loadRoster(classId); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="qb-page-head"><div><h1>Young learners</h1><p>Create sign-ins for learners under 13 in your classes. They use a username and password, with no email.</p></div><HelpLink slug="add-young-learners" label="How to add young learners" /></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status">{done}</div>}

      {classes === null ? <div className="qb-card qb-skeleton" style={{ minHeight: 100 }} aria-busy="true" /> : !classes.length ? <div className="qb-card qb-muted">Create a class first, then come back to add its learners.</div> : <>
        <section className="qb-card">
          <h2>1. Choose the class</h2>
          <select className="qb-input" aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.class_name} · {c.grade_label ?? c.grade}</option>)}</select>
        </section>

        <section className="qb-card" style={{ marginTop: 16 }}>
          <h2>2. Add learners</h2>
          <label>First names, one per line (up to 60)<textarea className="qb-input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Ama\nKofi\nEfua"} style={{ width: "100%" }} /></label>
          <p className="qb-small qb-muted">{parsed.names.length} ready{parsed.rejected.length ? `; not accepted (letters, spaces, hyphens and apostrophes only): ${parsed.rejected.join(", ")}` : ""}. Only first names are stored.</p>
          <label className="qb-small" style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={consentOk} onChange={(e) => setConsentOk(e.target.checked)} /> I confirm that our school holds a parent or guardian&apos;s consent for each of these learners to use QuizBox, and that I will end an account if consent is withdrawn.</label>
          <label style={{ display: "block", marginTop: 8 }}>Where is the consent recorded? (for example &ldquo;Class consent forms, term 1, kept in the school office&rdquo;)<input className="qb-input" value={consentRef} maxLength={120} onChange={(e) => setConsentRef(e.target.value)} style={{ width: "100%" }} /></label>
          <button className="qb-btn" style={{ marginTop: 10 }} disabled={busy || !classId || !parsed.names.length || !consentOk || consentRef.trim().length < 5} onClick={() => void create()}>{busy ? "Creating…" : `Create ${parsed.names.length || ""} account${parsed.names.length === 1 ? "" : "s"}`}</button>
        </section>

        {cards.length > 0 && <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="cards-title">
          <div className="qb-page-head"><h2 id="cards-title">Sign-in cards</h2><button className="qb-btn" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> Print cards</button></div>
          <p className="qb-small qb-muted">Give each child their card. Sign in at www.quizbox.io with the username and password. Passwords are not shown again: use Reset password if one is lost.</p>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))" }}>
            {cards.map((c) => <div key={c.username} className="qb-card" style={{ breakInside: "avoid" }}>
              <strong>{c.first_name}</strong><div className="qb-small">{klass?.class_name}</div>
              <div style={{ marginTop: 6 }}>Username: <code>{c.username}</code></div><div>Password: <code>{c.password}</code></div>
            </div>)}
          </div>
          {failed.length > 0 && <p className="qb-error" role="alert">Not created: {failed.map((f) => `${f.name} (${f.reason})`).join(", ")}. Add them again.</p>}
        </section>}

        <section className="qb-card" style={{ marginTop: 16 }}>
          <h2>Learners in this class</h2>
          {!roster.length ? <p className="qb-muted">No young learners added yet.</p> :
            <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>First name</th><th>Username</th><th>Status</th><th /></tr></thead><tbody>
              {roster.map((l) => <tr key={l.user_id}><td>{l.first_name}</td><td><code>{l.username}</code></td><td>{l.status === "active" ? "Active" : "Ended"}</td>
                <td>{l.status === "active" && <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="qb-btn secondary" disabled={busy} onClick={() => void reset(l)}><KeyRound size={14} aria-hidden="true" /> Reset password</button>
                  <button className="qb-btn secondary" disabled={busy} onClick={() => void end(l)}><UserMinus size={14} aria-hidden="true" /> End account</button></span>}</td></tr>)}
            </tbody></table></div>}
        </section>
      </>}
    </>
  );
}
