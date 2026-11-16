"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { resendInvitation, resetChildAccess, revokeInvitation, unlinkChild } from "@/lib/api/family";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import InviteBox from "@/components/family/InviteBox";

// One child's page. Phase 3 shows who they are and how the parent manages their access: a new workspace link, a reset, cancelling an unused link, and removing the child from the family.
// Work, challenges, coins and subscriptions are added to this page in the next phases. Every action is checked by the database against the parent's link to this child.
type Summary = { student_id: string; full_name: string; grade_code: string | null; school_name: string | null };

export default function ChildPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const router = useRouter();
  const [child, setChild] = useState<Summary | null>(null), [state, setState] = useState<"loading" | "ready" | "forbidden">("loading");
  const [invite, setInvite] = useState<{ token: string; expiresAt?: string } | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [note, setNote] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabaseBrowserClient().rpc("qb_family_child_summary", { p_student: studentId });
    if (err || !data) { setState("forbidden"); return; }
    setChild(data as Summary); setState("ready");
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);

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

      <section className="qb-card" aria-labelledby="child-work" style={{ display: "grid", gap: 8 }}>
        <h2 id="child-work" style={{ margin: 0 }}>Work</h2>
        <p className="qb-muted" style={{ margin: 0 }}>Give {first} practice on topics from their class. It appears in their workspace marked as Family, next to any work from school.</p>
        <Link className="qb-btn" style={{ justifySelf: "start" }} href={`/family/assign?child=${studentId}`}>Give {first} work</Link>
      </section>

      <section className="qb-card" aria-labelledby="child-more" style={{ display: "grid", gap: 6 }}>
        <h2 id="child-more" style={{ margin: 0 }}>Coming next</h2>
        <p className="qb-muted" style={{ margin: 0 }}>Challenges, buying questions, coins and subscriptions, and following {first}&apos;s progress will appear here.</p>
      </section>

      <section className="qb-card" aria-labelledby="child-remove" style={{ display: "grid", gap: 8 }}>
        <h2 id="child-remove" style={{ margin: 0 }}>Remove from my family</h2>
        <p className="qb-muted" style={{ margin: 0 }}>This ends your link to {first}. Their account, school and results stay exactly as they are; you just stop seeing and managing them.</p>
        <button className="qb-btn secondary" style={{ justifySelf: "start" }} disabled={!!busy} onClick={() => { if (!window.confirm(`Remove ${child.full_name} from your family? You will no longer see their progress or manage their account.`)) return; void run("unlink", async () => { await unlinkChild(studentId); router.replace("/family"); }); }}>Remove {first}</button>
      </section>
    </div>
  );
}
