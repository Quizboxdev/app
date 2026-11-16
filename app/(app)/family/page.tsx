"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listFamilyChildren, listFamilyProgress, openFamilyWorkspace, type ChildLink, type ChildProgressLine, type FamilyChild } from "@/lib/api/family";
import AddChildForm from "@/components/family/AddChildForm";
import LinkExistingForm from "@/components/family/LinkExistingForm";
import InviteBox from "@/components/family/InviteBox";

// Family workspace: the parent's home. Their children as cards, Add child, and Link an existing student. A child stays an ordinary QuizBox student; the parent only sees and does
// what their link allows, and the database checks that on every call.
type Mode = "none" | "add" | "link";

export default function FamilyHomePage() {
  const [state, setState] = useState<"loading" | "off" | "notAdult" | "error" | "ready">("loading");
  const [name, setName] = useState("My family"), [children, setChildren] = useState<FamilyChild[]>([]), [mode, setMode] = useState<Mode>("none");
  const [lines, setLines] = useState<ChildProgressLine[]>([]);
  const [fresh, setFresh] = useState<{ link: ChildLink; name: string } | null>(null), [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setChildren(await listFamilyChildren()); setError(""); } catch (e) { setError((e as Error).message); }
    listFamilyProgress(30).then(setLines).catch(() => setLines([]));
  }, []);
  useEffect(() => {
    let live = true;
    openFamilyWorkspace().then(async (w) => { if (!live) return; setName(w.name); setState("ready"); await load(); })
      .catch((e: Error) => { if (live) setState(/not open yet/i.test(e.message) ? "off" : /adult/i.test(e.message) ? "notAdult" : "error"); });
    return () => { live = false; };
  }, [load]);

  if (state === "loading") return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" aria-label="Loading your family workspace" />;
  if (state === "off") return <section className="qb-card"><h1 style={{ marginTop: 0 }}>Family workspace</h1><p className="qb-muted">The Family workspace is not open yet. We will tell you as soon as it is.</p></section>;
  if (state === "notAdult") return <section className="qb-card"><h1 style={{ marginTop: 0 }}>Family workspace</h1><p className="qb-muted">The Family workspace is for parents and guardians. Ask your parent to open theirs.</p></section>;
  if (state === "error") return <section className="qb-card qb-error" role="alert"><h1 style={{ marginTop: 0 }}>Family workspace</h1><p>We could not open your Family workspace. Please try again.</p><button className="qb-btn secondary" onClick={() => window.location.reload()}>Try again</button></section>;

  const active = children.filter((c) => c.status === "active"), waiting = children.filter((c) => c.status !== "active");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", justifyContent: "space-between" }}>
        <div><p className="qb-muted qb-small" style={{ margin: 0 }}>Family workspace</p><h1 style={{ margin: 0 }}>{name}</h1>
          <p className="qb-muted" style={{ margin: "4px 0 0" }}>{active.length ? `${active.length} child${active.length === 1 ? "" : "ren"}` : "Add your first child to get started."}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn" onClick={() => { setMode("add"); setFresh(null); }}>+ Add child</button>
          <button className="qb-btn secondary" onClick={() => { setMode("link"); setFresh(null); }}>Link an existing student</button>
          {active.length > 0 && <Link className="qb-btn secondary" href="/family/assign">Give work</Link>}
          {active.length > 0 && <Link className="qb-btn secondary" href="/family/wallet">Coins and wallet</Link>}
          {active.length > 0 && <Link className="qb-btn secondary" href="/family/subscriptions">Subscriptions</Link>}
        </div>
      </header>

      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {fresh && fresh.link.token && <InviteBox name={fresh.name} token={fresh.link.token} expiresAt={fresh.link.expiresAt} username={fresh.link.username} />}
      {fresh && !fresh.link.token && <div className="qb-card" role="status">{fresh.name} was added. Open their page to make their workspace link.</div>}
      {mode === "add" && <AddChildForm onCancel={() => setMode("none")} onAdded={(link, who) => { setFresh({ link, name: who }); setMode("none"); void load(); }} />}
      {mode === "link" && <LinkExistingForm onCancel={() => setMode("none")} onSent={() => void load()} />}

      <section aria-labelledby="fam-children"><h2 id="fam-children" style={{ margin: "0 0 8px" }}>My children</h2>
        {!active.length ? <div className="qb-card qb-empty"><strong>No children yet</strong>Add a child to give them work, buy coins and follow their progress. A child you add is an ordinary QuizBox student, so they can also join their school class.</div>
          : <div className="qb-grid cols-3">{active.map((c) => (
            <Link key={c.relationship_id} href={`/family/children/${c.student_id}`} className="qb-card" style={{ display: "grid", gap: 4, textDecoration: "none", color: "inherit" }}>
              <strong style={{ fontSize: 18 }}>{c.full_name}</strong>
              <span className="qb-muted">{[c.grade_code, c.school_name].filter(Boolean).join(" · ") || "No class set"}</span>
              <span className="qb-chip" style={{ justifySelf: "start", minHeight: 26, padding: "0 10px", fontSize: 12 }}>{c.relationship_type.replace("_", " ")}</span>
            </Link>))}</div>}
      </section>

      {lines.length > 0 && <section aria-labelledby="fam-prog"><h2 id="fam-prog" style={{ margin: "0 0 8px" }}>This month at a glance</h2>
        <div className="qb-card" style={{ overflowX: "auto" }}><table className="qb-table"><thead><tr><th>Child</th><th>Work done</th><th>Average</th><th>Still to do</th></tr></thead><tbody>
          {lines.map((l) => <tr key={l.student_id}><td><Link className="qb-link" href={`/family/children/${l.student_id}`}>{l.name}</Link></td><td>{l.completed}</td><td>{l.average === null ? "—" : `${Math.round(Number(l.average))}%`}</td><td>{l.outstanding}</td></tr>)}</tbody></table></div></section>}

      {waiting.length > 0 && <section aria-labelledby="fam-waiting"><h2 id="fam-waiting" style={{ margin: "0 0 8px" }}>Waiting for an answer</h2>
        <div className="qb-card" style={{ display: "grid", gap: 6 }}>{waiting.map((c) => <div key={c.relationship_id}>Waiting for <strong>{c.label ?? "a student"}</strong> to accept your request.</div>)}</div></section>}
    </div>
  );
}
