"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { familyChallenges, inviteToChallenge, listFamilyChildren, uninviteFromChallenge, type FamilyChallenge, type FamilyChild } from "@/lib/api/family";
import ChildPicker from "@/components/family/ChildPicker";

// Challenges: build one in Create and share (the same tool everyone uses), then invite the children you choose. They see it on their home screen with its access code and play it normally.
const STATE: Record<string, string> = { DRAFT: "Not published yet", LIVE: "Live", PAUSED: "Paused", COMPLETED: "Finished" };

export default function FamilyChallengesPage() {
  const [rows, setRows] = useState<FamilyChallenge[] | null>(null), [kids, setKids] = useState<FamilyChild[]>([]), [open, setOpen] = useState(""), [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const load = useCallback(() => { familyChallenges().then(setRows).catch((e: Error) => { setRows([]); setError(e.message); }); }, []);
  useEffect(() => { load(); listFamilyChildren().then((r) => setKids(r.filter((c) => c.status === "active" && c.permissions?.create_challenge))).catch(() => setKids([])); }, [load]);

  async function invite(id: string) {
    setBusy(true); setError(""); setNote("");
    try { const r = await inviteToChallenge(id, ids); setNote(r.invited ? `Invited ${r.invited} child${r.invited === 1 ? "" : "ren"}. They will see it on their home screen.` : "They were already invited."); setOpen(""); setIds([]); load(); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  async function remove(id: string, student: string) { setBusy(true); setError(""); try { await uninviteFromChallenge(id, student); load(); } catch (e) { setError((e as Error).message); } setBusy(false); }

  if (rows === null) return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" aria-label="Loading" />;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}><Link className="qb-link" href="/family">&larr; My family</Link></p>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <div><h1 style={{ margin: 0 }}>Challenges</h1><p className="qb-muted" style={{ margin: "4px 0 0" }}>Make a challenge, then invite the children you choose.</p></div>
        <Link className="qb-btn" href="/creator/new">Create a challenge</Link>
      </header>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {note && <div className="qb-card" role="status"><strong>{note}</strong></div>}
      {!rows.length ? <div className="qb-card qb-empty"><strong>No challenges yet</strong>Create one, publish it, and it appears here ready to send to your children.</div> : rows.map((c) => (
        <section key={c.campaign_id} className="qb-card" style={{ display: "grid", gap: 10 }} aria-label={c.title}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div><h2 style={{ margin: 0 }}>{c.title}</h2><p className="qb-muted qb-small" style={{ margin: "2px 0 0" }}>{STATE[c.status] ?? c.status}{c.ends_at ? ` · ends ${new Date(c.ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</p></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="qb-btn secondary" href={`/creator/${c.campaign_id}`}>Open</Link>
              {open !== c.campaign_id && <button className="qb-btn" disabled={!kids.length} onClick={() => { setOpen(c.campaign_id); setIds([]); setNote(""); }}>Invite children</button>}
            </div>
          </div>
          {c.children.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{c.children.map((k) => <span key={k.student_id} className="qb-chip" style={{ minHeight: 28, padding: "0 10px", fontSize: 12.5 }}>{k.name}
            <button type="button" aria-label={`Take back the invitation from ${k.name}`} disabled={busy} onClick={() => void remove(c.campaign_id, k.student_id)} style={{ all: "unset", cursor: "pointer", marginInlineStart: 6, fontWeight: 700 }}>×</button></span>)}</div>}
          {open === c.campaign_id && <>
            <ChildPicker legend="Who should be invited?" value={ids} onChange={setIds} options={kids.map((k) => ({ id: k.student_id as string, name: k.full_name ?? "Child", detail: k.grade_code ?? undefined }))} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="qb-btn" disabled={busy || !ids.length} onClick={() => void invite(c.campaign_id)}>{busy ? "Inviting…" : `Invite ${ids.length || "…"} ${ids.length === 1 ? "child" : "children"}`}</button><button className="qb-btn secondary" disabled={busy} onClick={() => setOpen("")}>Cancel</button></div>
          </>}
        </section>))}
    </div>
  );
}
