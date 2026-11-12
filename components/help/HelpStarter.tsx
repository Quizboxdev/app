"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, CirclePlay, ListChecks, Megaphone, Share2, Trophy, UserPlus, Users, type LucideIcon } from "lucide-react";

// "New here?" on a person's home page: the three or four guides that matter most for their role. It can be put away (remembered on this device only) and it never blocks anything.
// Each guide is a rounded chip with an icon and a short action label (the full guide title is on the guide itself); on a phone the chips sit two to a row.
type Item = { slug: string; label: string; icon: LucideIcon };
const STARTERS: Record<string, { title: string; items: Item[] }> = {
  "/student": { title: "New here? Start with these guides", items: [
    { slug: "getting-started-learner", label: "Getting started", icon: BookOpen },
    { slug: "practice-session", label: "Start practising", icon: CirclePlay },
    { slug: "join-a-class", label: "Join a class", icon: Users },
    { slug: "join-challenge-or-competition", label: "Join a challenge", icon: Trophy }] },
  "/teacher": { title: "New here? Start with these guides", items: [
    { slug: "getting-started-teacher", label: "Getting started", icon: BookOpen },
    { slug: "create-a-class", label: "Create a class", icon: Users },
    { slug: "create-an-assignment", label: "Create an assignment", icon: ListChecks },
    { slug: "add-young-learners", label: "Add young learners", icon: UserPlus }] },
  "/sponsor": { title: "New here? Start with these guides", items: [
    { slug: "sponsor-a-challenge", label: "Sponsor a challenge", icon: Megaphone },
    { slug: "create-a-challenge", label: "Create a challenge", icon: Trophy },
    { slug: "share-challenge-or-competition", label: "Share your quiz", icon: Share2 }] },
};
const KEY = "qb-help-starter-dismissed";

export default function HelpStarter({ pathname }: { pathname: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(KEY) === "1"); } catch { setHidden(false); } }, []);
  const s = STARTERS[pathname];
  if (!s || hidden) return null;
  return (
    <aside className="qb-card" aria-label={s.title} style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>{s.title}</strong>
        <button type="button" className="qb-btn ghost" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* remembered for this visit only */ } setHidden(true); }} aria-label="Hide these guides">Hide</button>
      </div>
      <ul className="qb-link-chips">
        {s.items.map(({ slug, label, icon: Icon }) => <li key={slug}><Link className="qb-link-chip" href={`/guides/${slug}`}><Icon size={16} aria-hidden="true" />{label}</Link></li>)}
        <li><Link className="qb-link-chip is-quiet" href="/guides">All guides<ChevronRight size={16} aria-hidden="true" /></Link></li>
      </ul>
    </aside>
  );
}
