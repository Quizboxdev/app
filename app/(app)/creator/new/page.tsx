"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { bootstrapUser } from "@/lib/auth";
import { createChallenge, getCampaignForEdit, setBrand, setTargeting, updateCampaign } from "@/lib/api/challenges";
import { CHALLENGE_CATEGORIES, FORMATS, type Brand, type Format } from "@/lib/challenges/types";
import { TARGET_LEVELS } from "@/lib/challenges/content-types";
import { useDraft } from "@/lib/drafts/use-draft";
import DraftNotice from "@/components/DraftNotice";
import SpotlightCard from "@/components/challenges/SpotlightCard";
import MaterialUploader from "@/components/challenges/MaterialUploader";
import AudiencePanel from "@/components/challenges/AudiencePanel";
import LogoPicker from "@/components/challenges/LogoPicker";

// The quiz studio: one guided path, one question at a time, with a live preview that fills in as you type. Step 1 creates the quiz as a draft; every later step saves as you go,
// so nothing is lost by leaving. The last step opens the question editor.
const STEPS = ["The idea", "The material", "The audience", "Your look", "Finish"] as const;
const TIMES = [{ label: "Quick · 5 minutes", seconds: 300 }, { label: "Standard · 10 minutes", seconds: 600 }, { label: "Long · 20 minutes", seconds: 1200 }];

function Studio() {
  const router = useRouter(), q = useSearchParams();
  const [format, setFormat] = useState<Format>(q.get("format") === "competition" ? "COMPETITION" : "CHALLENGE");
  const [role, setRole] = useState(""), [step, setStep] = useState(0), [id, setId] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const [headline, setHeadline] = useState(""), [summary, setSummary] = useState(""), [category, setCategory] = useState("general_knowledge"), [seconds, setSeconds] = useState(600), [questions, setQuestions] = useState(10), [attempts, setAttempts] = useState(1);
  const [visibility, setVisibility] = useState("PUBLIC"), [code, setCode] = useState(""), [opens, setOpens] = useState(""), [closes, setCloses] = useState(""), [levels, setLevels] = useState<string[]>([]);
  const [brand, setBrandState] = useState<Brand>({}), [campaign, setCampaign] = useState<Record<string, any> | null>(null);
  useEffect(() => { bootstrapUser().then((c: any) => { const r = String(c.role ?? "").toUpperCase(); setRole(r); if (r === "SPONSOR") setCategory("sponsor"); }).catch(() => undefined); }, []);
  const fmt = FORMATS[format], noun = fmt.noun;

  // What is typed in step 1 is kept as a draft until the quiz is created.
  const draft = useDraft({ kind: format === "COMPETITION" ? "competition" : "challenge", title: headline, path: `/creator/new?format=${format.toLowerCase()}`, ready: !id,
    value: { headline, summary, category, seconds, questions, attempts }, empty: !headline.trim() && !summary.trim() || !!id,
    apply: (v: any) => { if (v?.headline) setHeadline(v.headline); if (v?.summary) setSummary(v.summary); if (v?.category) setCategory(v.category); if (v?.seconds) setSeconds(v.seconds); if (v?.questions) setQuestions(v.questions); if (v?.attempts) setAttempts(v.attempts); } });

  async function run(work: () => Promise<void>) { setBusy(true); setError(""); setNote(""); try { await work(); } catch (e: any) { setError(e.message); } setBusy(false); }
  const refresh = async () => { if (id) { const r = await getCampaignForEdit(id); setCampaign(r.campaign); } };

  const create = () => run(async () => {
    const r = await createChallenge({ title: headline.trim(), summary: summary.trim(), category, visibility: "PUBLIC", questionCount: questions, timeLimitSeconds: seconds, maxAttempts: attempts, format });
    await draft.finish(); setId(r.id); setStep(1);
  });
  const saveAudience = () => run(async () => {
    if (visibility === "PRIVATE" && code.trim().length < 4) throw new Error("Choose an access code of at least 4 characters.");
    await updateCampaign(id, { visibility, access_code: visibility === "PRIVATE" ? code.trim() : null, starts_at: opens ? new Date(opens).toISOString() : null, ends_at: closes ? new Date(closes).toISOString() : null });
    await setTargeting(id, levels); await refresh(); setStep(3);
  });
  const saveLook = () => run(async () => { await setBrand(id, brand); await refresh(); setStep(4); });
  const hasMaterial = !!campaign?.reader_enabled;
  const preview = (
    <div style={{ position: "sticky", top: 12 }} aria-label="Live preview">
      <p className="qb-overline">What people will see</p>
      <SpotlightCard title={headline} summary={summary} brand={brand} format={format} rounds={campaign?.stage_count} questions={questions} hasMaterial={hasMaterial} sponsored={role === "SPONSOR"} cta={format === "COMPETITION" ? "Join the competition" : "Play now"} />
      <p className="qb-muted qb-small">This is the card on the Challenges page{role === "SPONSOR" || role === "ADMIN" || role === "OWNER" ? " and in the Sponsored carousel once your quiz is live" : ""}.</p>
    </div>
  );

  return (
    <>
      <div className="qb-page-head"><div><h1>{id ? `Set up your ${noun}` : `Start a ${noun}`}</h1><p>Step {step + 1} of {STEPS.length}: {STEPS[step]}</p></div><div><Link className="qb-link" href={format === "COMPETITION" ? "/creator?format=competition" : "/creator"}>My {fmt.plural}</Link></div></div>
      <ol aria-label="Steps" style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: 0, listStyle: "none", margin: "0 0 12px" }}>
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} className="qb-pill" style={{ opacity: i <= step ? 1 : 0.5, fontWeight: i === step ? 700 : 400 }}>{i + 1}. {s}</li>)}
      </ol>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {note && <div className="qb-card" role="status">{note}</div>}
      <style>{`.qb-studio{display:grid;gap:16px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start}@media (max-width:860px){.qb-studio{grid-template-columns:minmax(0,1fr)}}`}</style>
      <div className="qb-studio">
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {step === 0 && <>
            {!id && <DraftNotice restored={!!draft.restored} expiresAt={draft.expiresAt} noun={noun} onDiscard={() => void draft.finish()} />}
            <div className="qb-card qb-form">
              <h2>What kind of quiz is it?</h2>
              <div role="radiogroup" aria-label="Kind of quiz" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                {([["CHALLENGE", "Challenge", "One timed round. Fast, simple, easy to share. Best for a product quiz, a story check or a class warm-up."], ["COMPETITION", "Competition", "Several rounds. The best players go through to the next round until there is a winner."]] as const).map(([k, name, text]) => (
                  <button key={k} type="button" role="radio" aria-checked={format === k} className={`qb-btn ${format === k ? "" : "qb-btn-secondary"}`} onClick={() => setFormat(k)} style={{ textAlign: "left", height: "auto", whiteSpace: "normal", display: "grid", gap: 4, padding: "12px 14px", justifyContent: "flex-start" }}>
                    <strong>{name}</strong><span className="qb-small" style={{ opacity: 0.85 }}>{text}</span>
                  </button>))}
              </div>
            </div>
            <div className="qb-card qb-form">
              <h2>What should we call it?</h2>
              <label className="qb-field"><span className="qb-sr-only">Headline</span>
                <input autoFocus value={headline} maxLength={120} onChange={(e) => setHeadline(e.target.value)} placeholder={role === "SPONSOR" ? "e.g. Know our products: Spring 2027" : "e.g. Who knows the story best?"} style={{ fontSize: 22, padding: 14 }} />
                <span className="qb-muted qb-small">{headline.length}/120 · This is the big title people see. Watch the card on the right.</span></label>
              <label className="qb-field">One line that makes people want to join
                <textarea rows={2} maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Ten quick questions. The fastest correct answers win a prize." /></label>
              <div className="qb-field"><span>It is about</span>
                <div role="radiogroup" aria-label="Category" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CHALLENGE_CATEGORIES.map((c) => <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className={`qb-chip ${category === c.id ? "qb-chip-on" : ""}`} style={category === c.id ? { fontWeight: 700, outline: "2px solid currentColor" } : undefined} onClick={() => setCategory(c.id)}>{c.label}</button>)}
                </div></div>
              <div className="qb-field"><span>How long is {format === "COMPETITION" ? "the first round" : "it"}?</span>
                <div role="radiogroup" aria-label="Time" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {TIMES.map((t) => <button key={t.seconds} type="button" role="radio" aria-checked={seconds === t.seconds} className={`qb-chip`} style={seconds === t.seconds ? { fontWeight: 700, outline: "2px solid currentColor" } : undefined} onClick={() => setSeconds(t.seconds)}>{t.label}</button>)}
                </div></div>
              <div className="qb-grid cols-2">
                <label className="qb-field">Questions each player gets<input type="number" min={3} max={100} value={questions} onChange={(e) => setQuestions(Math.max(3, Math.min(100, Number(e.target.value) || 3)))} /></label>
                <label className="qb-field">Tries per player<input type="number" min={1} max={10} value={attempts} onChange={(e) => setAttempts(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></label>
              </div>
              <div><button className="qb-btn" disabled={busy || headline.trim().length < 3} onClick={() => void create()}>{busy ? "Creating…" : "Continue"}</button></div>
            </div>
          </>}

          {step === 1 && <>
            <div className="qb-card"><h2>Add the material your quiz is about</h2><p className="qb-muted">A story book, a policy, a product guide, a faith book… Load it and people who join can read the chapters you choose before they play. You can skip this and write your own questions.</p></div>
            <MaterialUploader campaignId={id} reader={{ enabled: !!campaign?.reader_enabled, closes: campaign?.reader_closes === "START" ? "START" : "END" }} hasOpeningTime={!!opens} onError={setError} onChanged={() => void refresh()} />
            <div style={{ display: "flex", gap: 8 }}><button className="qb-btn" onClick={() => setStep(2)}>{campaign?.reader_enabled ? "Continue" : "Skip for now"}</button></div>
          </>}

          {step === 2 && <>
            <div className="qb-card qb-form">
              <h2>Who can join?</h2>
              <div role="radiogroup" aria-label="Who can join" style={{ display: "grid", gap: 8 }}>
                {([["PUBLIC", "Everyone", "Listed on QuizBox for anyone to find."], ["UNLISTED", "Anyone with the link", "Not listed. Share the link on WhatsApp or social media."], ["PRIVATE", "Only people with a code", "You give out the code. Good for a company or a club."]] as const).map(([k, name, text]) => (
                  <button key={k} type="button" role="radio" aria-checked={visibility === k} className={`qb-btn ${visibility === k ? "" : "qb-btn-secondary"}`} onClick={() => setVisibility(k)} style={{ textAlign: "left", height: "auto", whiteSpace: "normal", display: "grid", gap: 2, padding: "10px 12px", justifyContent: "flex-start" }}>
                    <strong>{name}</strong><span className="qb-small" style={{ opacity: 0.85 }}>{text}</span></button>))}
              </div>
              {visibility === "PRIVATE" && <label className="qb-field">Access code<input value={code} maxLength={24} onChange={(e) => setCode(e.target.value)} placeholder="At least 4 characters, e.g. SPRING27" /></label>}
              <p className="qb-muted qb-small">Everyone has to sign up to join, and the free sessions apply. That is how your quiz brings new people to QuizBox.</p>
            </div>
            <div className="qb-card qb-form">
              <h2>Who is it for?</h2>
              <p className="qb-muted">We use this to show your quiz to the right people on QuizBox. Leave all unticked to show it to everyone.</p>
              <div style={{ display: "grid", gap: 6 }}>{TARGET_LEVELS.map((l) => <label key={l.id} className="qb-check"><input type="checkbox" checked={levels.includes(l.id)} onChange={(e) => setLevels((x) => e.target.checked ? [...x, l.id] : x.filter((y) => y !== l.id))} /> {l.label}</label>)}</div>
              <div className="qb-grid cols-2">
                <label className="qb-field">Opens (optional)<input type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} /></label>
                <label className="qb-field">Closes (optional)<input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
              </div>
            </div>
            <AudiencePanel id={id} draft format={format} current={{ class: campaign?.audience_class_id, institution: campaign?.audience_institution_id }} onChanged={() => void refresh()} onError={setError} />
            <div style={{ display: "flex", gap: 8 }}><button className="qb-btn qb-btn-secondary" onClick={() => setStep(1)}>‹ Back</button><button className="qb-btn" disabled={busy} onClick={() => void saveAudience()}>{busy ? "Saving…" : "Continue"}</button></div>
          </>}

          {step === 3 && <>
            <div className="qb-card qb-form">
              <h2>Make it yours</h2>
              <p className="qb-muted">Add your logo and colour so people recognise you. They appear on the card and on your quiz page.</p>
              <LogoPicker value={brand.logo} onChange={(logo) => setBrandState((b) => ({ ...b, logo }))} onError={setError} />
              <div className="qb-grid cols-2">
                <label className="qb-field">Your name or organisation<input maxLength={60} value={brand.organiser_name ?? ""} onChange={(e) => setBrandState({ ...brand, organiser_name: e.target.value })} placeholder="e.g. Accra Bank" /></label>
                <label className="qb-field">Your colour<input type="color" value={brand.accent ?? "#1a7f5a"} onChange={(e) => setBrandState({ ...brand, accent: e.target.value })} /></label>
              </div>
              <label className="qb-field">A welcome message (optional)<textarea rows={2} maxLength={300} value={brand.welcome ?? ""} onChange={(e) => setBrandState({ ...brand, welcome: e.target.value })} /></label>
            </div>
            <div style={{ display: "flex", gap: 8 }}><button className="qb-btn qb-btn-secondary" onClick={() => setStep(2)}>‹ Back</button><button className="qb-btn" disabled={busy} onClick={() => void saveLook()}>{busy ? "Saving…" : "Continue"}</button></div>
          </>}

          {step === 4 && <div className="qb-card">
            <h2>You are nearly there</h2>
            <ul className="qb-list">
              <li>✔ {headline} is saved as a draft. It stays in My {fmt.plural}.</li>
              <li>{hasMaterial ? "✔ Reading material is ready for people who join." : "• No reading material. You can add it any time from the Material tab."}</li>
              <li>{brand.logo ? "✔ Your logo is set." : "• No logo yet. You can add one from Look and feel."}</li>
            </ul>
            <p><strong>Next: add the questions.</strong> {format === "COMPETITION" ? "Set up the rounds, then add questions for each round." : "Type them, paste them, or pick them from the QuizBox bank."}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="qb-btn qb-btn-secondary" onClick={() => setStep(3)}>‹ Back</button><button className="qb-btn" onClick={() => router.push(`/creator/${id}`)}>Add questions</button></div>
          </div>}
        </div>
        {preview}
      </div>
    </>
  );
}

export default function NewQuizPage() { return <Suspense fallback={<div className="qb-card" role="status">Loading…</div>}><Studio /></Suspense>; }
