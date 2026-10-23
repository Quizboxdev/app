"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// "New here?" on a person's home page: the three or four guides that matter most for their role. It can be put away (remembered on this device only) and it never blocks anything.
const STARTERS: Record<string, { title: string; items: { slug: string; label: string }[] }> = {
  "/student": { title: "New here? Start with these guides", items: [{ slug: "getting-started-learner", label: "Getting started as a learner" }, { slug: "practice-session", label: "Start a practice session" }, { slug: "join-a-class", label: "Join a class with a code" }, { slug: "join-challenge-or-competition", label: "Join a challenge or competition" }] },
  "/teacher": { title: "New here? Start with these guides", items: [{ slug: "getting-started-teacher", label: "Getting started as a teacher" }, { slug: "create-a-class", label: "Create a class and send the code" }, { slug: "create-an-assignment", label: "Create an assignment" }, { slug: "add-young-learners", label: "Add young learners (under 13)" }] },
  "/sponsor": { title: "New here? Start with these guides", items: [{ slug: "sponsor-a-challenge", label: "Run a sponsored challenge or competition" }, { slug: "create-a-challenge", label: "Create a challenge" }, { slug: "share-challenge-or-competition", label: "Share your quiz" }] },
};
const KEY = "qb-help-starter-dismissed";

export default function HelpStarter({ pathname }: { pathname: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(KEY) === "1"); } catch { setHidden(false); } }, []);
  const s = STARTERS[pathname];
  if (!s || hidden) return null;
  return (
    <aside className="qb-card" aria-label={s.title} style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>{s.title}</strong>
        <button type="button" className="qb-btn ghost" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* remembered for this visit only */ } setHidden(true); }} aria-label="Hide these guides">Hide</button>
      </div>
      <ul style={{ margin: 0, display: "flex", gap: "6px 18px", flexWrap: "wrap", listStyle: "none", padding: 0 }}>{s.items.map((i) => <li key={i.slug}><Link className="qb-link" href={`/guides/${i.slug}`}>{i.label}</Link></li>)}</ul>
      <Link className="qb-link qb-small" href="/guides">See all guides</Link>
    </aside>
  );
}
