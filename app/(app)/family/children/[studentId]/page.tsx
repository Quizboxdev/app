"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { childProgress, resendInvitation, resetChildAccess, revokeInvitation, unlinkChild, type ChildProgress } from "@/lib/api/family";
import SourceChip from "@/components/SourceChip";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import InviteBox from "@/components/family/InviteBox";

// One child's page. Phase 3 shows who they are and how the parent manages their access: a new workspace link, a reset, cancelling an unused link, and removing the child from the family.
// Work, challenges, coins and subscriptions are added to this page in the next phases. Every action is checked by the database against the parent's link to this child.
type Summary = { student_id: string; full_name: string; grade_code: string | null; school_name: string | null };

export default function ChildPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const router = useRouter();
  const [child, setChild] = useState<Summary | null>(null), [state, setState] = useState<"loading" | "ready" | "forbidden">("loading");
  const [prog, setProg] = useState<ChildProgress | null>(null);
  const [invite, setInvite] = useState<{ token: string; expiresAt?: string } | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [note, setNote] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabaseBrowserClient().rpc("qb_family_child_summary", { p_student: studentId });
    if (err || !data) { setState("forbidden"); return; }
    setChild(data as Summary); setState("ready");
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { childProgress(studentId, 30).then(setProg).catch(() => setProg(null)); }, [studentId]);

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key); setError(""); setNote("");
    try { await work(); } catch (e) { setError((e as Error).message || "That did not work. Please try again."); }
    setBusy("");
  }

  if (state === "loading") return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" aria-label="Loading" />;
  if (state === "forbidden" || !child) return <section className="qb-card"><h1 style={{ marginTop: 0 }}>Child not found</h1><p className="qb-muted">This child is not linked to your Family workspace.</p><Link className="qb-btn secondary" href="/family">Back to my family</Link></section>;

  const first = child.full_name.split(" ")[0];
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}><Link className="qb-link" href="/family">&larr; My family</Link></p>
      <header><h1 style={{ margin: 0 }}>{child.full_name}</h1>
        <p className="qb-muted" style={{ margin: "4px 0 0" }}>{[child.grade_code, child.school_name].filter(Boolean).join(" · ") || "No class set"}</p></header>

      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {note && <div className="qb-card" role="status">{note}</div>}
      {invite && <InviteBox name={first} token={invite.token} expiresAt={invite.expiresAt} />}

      <section className="qb-card" aria-labelledby="child-access" style={{ display: "grid", gap: 10 }}>
        <h2 id="child-access" style={{ margin: 0 }}>Workspace access</h2>
        <p className="qb-muted" style={{ margin: 0 }}>{first} signs in with their own username and password. If they have not set one yet, or have lost it, send them a new link.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn" disabled={!!busy} onClick={() => void run("resend", async () => { const r = await resendInvitation(studentId); setInvite({ token: r.token, expiresAt: r.expires_at }); })}>{busy === "resend" ? "Making link…" : "Make a new workspace link"}</button>
          <button className="qb-btn secondary" disabled={!!busy} onClick={() => { if (!window.confirm(`Reset ${first}'s access? Their current password stops working straight away and you get a new link to send them.`)) return; void run("reset", async () => { const r = await resetChildAccess(studentId); setInvite({ token: r.token, expiresAt: r.expiresAt }); }); }}>{busy === "reset" ? "Resetting…" : "Reset access"}</button>
          <button className="qb-btn secondary" disabled={!!busy} onClick={() => void run("revoke", async () => { const r = await revokeInvitation(studentId); setInvite(null); setNote(r.revoked ? "The unused link was cancelled." : "There was no unused link to cancel."); })}>Cancel unused link</button>
        </div>
      </section>

      {prog && <section className="qb-card" aria-labelledby="child-prog" style={{ display: "grid", gap: 12 }}>
        <h2 id="child-prog" style={{ margin: 0 }}>Progress, last {prog.days} days</h2>
        <div className="qb-grid cols-4">
          {([["Work done", prog.completed], ["Average", prog.average === null ? "—" : `${Math.round(Number(prog.average))}%`], ["Best", prog.best === null ? "—" : `${Math.round(Number(prog.best))}%`], ["Still to do", prog.outstanding]] as const).map(([label, value]) => <div key={label} className="qb-card" style={{ display: "grid", gap: 2 }}><span className="qb-muted qb-small">{label}</span><strong style={{ fontSize: 24 }}>{value}</strong></div>)}
        </div>
        {prog.weekly.length > 0 && <div role="img" aria-label="Work done each week" style={{ display: "flex", gap: 6, alignItems: "end", height: 90 }}>
          {prog.weekly.map((w) => { const max = Math.max(1, ...prog.weekly.map((x) => Number(x.completed))); return <div key={w.week} title={`Week of ${w.week}: ${w.completed} done${w.average !== null ? `, average ${Math.round(Number(w.average))}%` : ""}`} style={{ flex: 1, minWidth: 14, maxWidth: 48, height: `${Math.max(6, (Number(w.completed) / max) * 100)}%`, background: "var(--blue, #2563eb)", borderRadius: "4px 4px 0 0" }} />; })}</div>}
        {prog.recent.length > 0 ? <div style={{ display: "grid", gap: 6 }}>{prog.recent.map((r, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span><strong>{r.title}</strong><SourceChip row={{ source_type: r.source }} /></span><span className="qb-muted">{r.percentage === null ? "—" : `${Math.round(Number(r.percentage))}%`} · {new Date(r.submitted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>)}</div>
          : <p className="qb-muted" style={{ margin: 0 }}>No finished work in this period yet.</p>}
      </section>}

      <section className="qb-card" aria-labelledby="child-work" style={{ display: "grid", gap: 8 }}>
        <h2 id="child-work" style={{ margin: 0 }}>Work</h2>
        <p className="qb-muted" style={{ margin: 0 }}>Give {first} practice on topics from their class. It appears in their workspace marked as Family, next to any work from school.</p>
        <Link className="qb-btn" style={{ justifySelf: "start" }} href={`/family/assign?child=${studentId}`}>Give {first} work</Link>
      </section>

      <section className="qb-card" aria-labelledby="child-buy" style={{ display: "grid", gap: 8 }}>
        <h2 id="child-buy" style={{ margin: 0 }}>Coins and subscription</h2>
        <p className="qb-muted" style={{ margin: 0 }}>See {first}&apos;s Coins and plan, and buy for {first}, or for several children at once.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="qb-btn secondary" href="/family/wallet">Coins and wallet</Link><Link className="qb-btn secondary" href="/family/subscriptions">Subscriptions</Link></div>
      </section>

      <section className="qb-card" aria-labelledby="child-more" style={{ display: "grid", gap: 6 }}>
        <h2 id="child-more" style={{ margin: 0 }}>Coming next</h2>
        <p className="qb-muted" style={{ margin: 0 }}>Challenges, buying questions, and following {first}&apos;s progress will appear here.</p>
      </section>

      <section className="qb-card" aria-labelledby="child-remove" style={{ display: "grid", gap: 8 }}>
        <h2 id="child-remove" style={{ margin: 0 }}>Remove from my family</h2>
        <p className="qb-muted" style={{ margin: 0 }}>This ends your link to {first}. Their account, school and results stay exactly as they are; you just stop seeing and managing them.</p>
        <button className="qb-btn secondary" style={{ justifySelf: "start" }} disabled={!!busy} onClick={() => { if (!window.confirm(`Remove ${child.full_name} from your family? You will no longer see their progress or manage their account.`)) return; void run("unlink", async () => { await unlinkChild(studentId); router.replace("/family"); }); }}>Remove {first}</button>
      </section>
    </div>
  );
}
