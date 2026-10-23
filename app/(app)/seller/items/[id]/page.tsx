"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GRADE_OPTIONS, ITEM_STATUS, itemQuestionsSet, itemSave, itemSubmit, itemUnlist, myItem, parseQuestions, questionsToText, sellerGet, SUBJECT_SUGGESTIONS, TERM_OPTIONS, type ItemDetail } from "@/lib/api/marketplace";

// Create or edit a question set. Questions are pasted in a simple format (shown below the box) and checked as you type. A set is editable while it is a draft, was sent back, or is off sale;
// once it is waiting for review or on sale it is locked so buyers always get what was approved. Prices are whole cedis from 5 to 200.
const EXAMPLE = `What is the chemical symbol for sodium?
A. So
B. Na
C. Sd
D. N
Answer: B
Why: Sodium comes from the Latin "natrium".

Which gas do plants take in for photosynthesis?
A. Oxygen
B. Nitrogen
C. Carbon dioxide
Answer: C`;

export default function ItemEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), router = useRouter(), isNew = id === "new";
  const [item, setItem] = useState<ItemDetail | null>(null), [loaded, setLoaded] = useState(isNew), [error, setError] = useState(""), [ok, setOk] = useState(""), [busy, setBusy] = useState(false), [verified, setVerified] = useState(true);
  const [f, setF] = useState({ title: "", description: "", subject: "", grade: "SHS1", term: "Term 2", school: "", price: "10" }), [text, setText] = useState("");

  useEffect(() => {
    sellerGet().then((s) => { if (!s) { router.replace("/seller"); return; } setVerified(s.status === "verified"); if (isNew) setF((x) => ({ ...x, school: s.school_name })); }).catch(() => undefined);
    if (!isNew) myItem(id).then((d) => { setItem(d); setF({ title: d.title, description: d.description, subject: d.subject, grade: d.grade, term: d.term ?? "", school: d.school_name, price: String(d.price_minor / 100) }); setText(questionsToText(d.questions)); setLoaded(true); }).catch((e) => { setError(e.message); setLoaded(true); });
  }, [id, isNew, router]);

  const parsed = useMemo(() => parseQuestions(text), [text]);
  const editable = isNew || !item || ["draft", "rejected", "unlisted"].includes(item.status);
  const price = Number(f.price);
  const priceOk = Number.isInteger(price) && price >= 5 && price <= 200;
  const set = <K extends keyof typeof f>(k: K, v: string) => { setF((x) => ({ ...x, [k]: v })); setOk(""); };

  async function save(thenSubmit: boolean) {
    setBusy(true); setError(""); setOk("");
    try {
      if (!priceOk) throw new Error("The price must be a whole number of cedis between 5 and 200.");
      if (parsed.errors.length) throw new Error(parsed.errors[0]);
      const saved = await itemSave({ id: isNew ? null : id, title: f.title, description: f.description, subject: f.subject, grade: f.grade, term: f.term, school: f.school, price_minor: price * 100 });
      await itemQuestionsSet(saved.id, parsed.questions);
      if (thenSubmit) { const r = await itemSubmit(saved.id); router.replace(`/seller/items?sent=1${r.duplicates ? "&dups=" + r.duplicates : ""}`); return; }
      if (isNew) { router.replace(`/seller/items/${saved.id}`); return; }
      setOk(`Saved ${parsed.questions.length} questions.`); setItem(await myItem(saved.id));
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  if (!loaded) return <div className="qb-card qb-muted">Loading…</div>;
  return (
    <>
      <div className="qb-page-head"><div><p className="qb-small"><Link className="qb-link" href="/seller/items">← Your question sets</Link></p><h1>{isNew ? "Add a question set" : item?.title || "Question set"}</h1>
        {item && <p><span className="qb-pill neutral">{ITEM_STATUS[item.status]}</span></p>}</div></div>
      {!verified && <div className="qb-card" role="status">Your seller account is not verified yet. You can prepare a set now and send it for review once you are verified.</div>}
      {item?.status === "rejected" && item.review_note && <div className="qb-card qb-error" role="alert"><strong>Needs changes:</strong> {item.review_note}</div>}
      {!editable && <div className="qb-card" role="status">This set is {item?.status === "approved" ? "on sale" : "waiting for review"}, so it cannot be changed. Take it off sale from <Link className="qb-link" href="/seller/items">Your question sets</Link> to edit it; buyers keep what they already bought.
        {item?.status && <> <button className="qb-btn secondary" style={{ marginLeft: 8 }} onClick={() => void itemUnlist(id).then(() => window.location.reload())}>Take off sale</button></>}</div>}

      <fieldset disabled={!editable || busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 16 }}>
        <div className="qb-card qb-form" style={{ display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Details</h3>
          <label className="qb-field">Title<input value={f.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Chemistry End of Term 2 Test" /></label>
          <div className="qb-grid cols-2">
            <label className="qb-field">Subject<input list="subjects" value={f.subject} maxLength={60} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Chemistry" /><datalist id="subjects">{SUBJECT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist></label>
            <label className="qb-field">School the questions come from<input value={f.school} maxLength={120} onChange={(e) => set("school", e.target.value)} placeholder="e.g. Opoku Ware School" /></label>
            <label className="qb-field">Class<select value={f.grade} onChange={(e) => set("grade", e.target.value)}>{GRADE_OPTIONS.map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="qb-field">Term<select value={f.term} onChange={(e) => set("term", e.target.value)}><option value="">Not specific to a term</option>{TERM_OPTIONS.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="qb-field">Price in cedis (whole numbers, 5 to 200)<input inputMode="numeric" value={f.price} onChange={(e) => set("price", e.target.value.replace(/\D/g, ""))} aria-invalid={!priceOk} /></label>
            <div className="qb-small qb-muted" style={{ alignSelf: "end" }}>{priceOk ? <>You earn <strong>GHS {Math.floor(price * 60) / 100}</strong> from each sale (60%). QuizBox keeps 40%.</> : "Enter a whole number from 5 to 200."}</div>
          </div>
          <label className="qb-field">A short description (optional)<textarea rows={3} maxLength={800} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What does this set cover? Who is it for?" /></label>
        </div>

        <div className="qb-card qb-form" style={{ display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Questions</h3>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>Paste your questions, one after another, with a blank line between them. Give each question 2 to 5 answers (A, B, C…) and a line such as <code>Answer: B</code>. A <code>Why:</code> line is optional. Sets need at least 10 questions and at most 200.</p>
          <textarea rows={14} value={text} onChange={(e) => { setText(e.target.value); setOk(""); }} placeholder={EXAMPLE} aria-label="Questions" style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
          <p className="qb-small" style={{ margin: 0 }} role="status"><strong>{parsed.questions.length}</strong> question{parsed.questions.length === 1 ? "" : "s"} ready{parsed.errors.length ? <span className="qb-error"> · {parsed.errors.length} to fix</span> : null}</p>
          {!!parsed.errors.length && <ul className="qb-list qb-error qb-small" style={{ margin: 0 }}>{parsed.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}{parsed.errors.length > 6 && <li>…and {parsed.errors.length - 6} more.</li>}</ul>}
        </div>
      </fieldset>

      {error && <p className="qb-error" role="alert">{error}</p>}
      {ok && <p className="qb-ok" role="status">{ok}</p>}
      {editable && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn secondary" disabled={busy} onClick={() => void save(false)}>{busy ? "Saving…" : "Save draft"}</button>
        <button className="qb-btn" disabled={busy || !verified || parsed.questions.length < 10} onClick={() => void save(true)} title={!verified ? "Available once you are verified" : parsed.questions.length < 10 ? "Add at least 10 questions" : ""}>Save and send for review</button>
      </div>}
    </>
  );
}
