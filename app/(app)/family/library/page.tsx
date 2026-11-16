"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { familyLibrary, grantSet, listFamilyChildren, revokeSet, type FamilyChild, type LibrarySet } from "@/lib/api/family";
import ChildPicker from "@/components/family/ChildPicker";

// Question library: sets you bought in the Marketplace. Give a set to the children you tick; they practise the original set (nothing is copied) for as long as your purchase lasts.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function FamilyLibraryPage() {
  const [sets, setSets] = useState<LibrarySet[] | null>(null), [kids, setKids] = useState<FamilyChild[]>([]), [open, setOpen] = useState(""), [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const load = useCallback(() => { familyLibrary().then(setSets).catch((e: Error) => { setSets([]); setError(e.message); }); }, []);
  useEffect(() => { load(); listFamilyChildren().then((r) => setKids(r.filter((c) => c.status === "active" && c.permissions?.assign))).catch(() => setKids([])); }, [load]);

  async function give(item: string) {
    setBusy(true); setError(""); setNote("");
    try { const r = await grantSet(item, ids); setNote(r.granted ? `Given to ${r.granted} child${r.granted === 1 ? "" : "ren"}. They will see it on their home screen.` : "They already have this set."); setOpen(""); setIds([]); load(); }
    catch (e) { setError((e as Error).message === "That did not work. Please try again." ? "That set cannot be given right now. Check that your purchase has not expired." : (e as Error).message); }
    setBusy(false);
  }
  async function take(item: string, student: string) {
    setBusy(true); setError(""); setNote("");
    try { await revokeSet(item, student); load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  if (sets === null) return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" aria-label="Loading" />;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}><Link className="qb-link" href="/family">&larr; My family</Link></p>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <div><h1 style={{ margin: 0 }}>Question library</h1><p className="qb-muted" style={{ margin: "4px 0 0" }}>Sets you bought in the Marketplace. Give them to the children who need them.</p></div>
        <Link className="qb-btn" href="/marketplace">Browse the Marketplace</Link>
      </header>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {note && <div className="qb-card" role="status"><strong>{note}</strong></div>}
      {!sets.length ? <div className="qb-card qb-empty"><strong>No sets yet</strong>Buy a set in the Marketplace and it appears here, ready to give to your children.</div> : sets.map((s) => (
        <section key={s.item_id} className="qb-card" style={{ display: "grid", gap: 10 }} aria-label={s.title}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div><h2 style={{ margin: 0 }}>{s.title}</h2><p className="qb-muted qb-small" style={{ margin: "2px 0 0" }}>{[s.subject, s.school, s.grade].filter(Boolean).join(" · ")} · {s.active ? `yours until ${day(s.expires_at)}` : "expired"}</p></div>
            {s.active && open !== s.item_id && <button className="qb-btn" disabled={!kids.length} onClick={() => { setOpen(s.item_id); setIds([]); setNote(""); }}>Give to children</button>}
          </div>
          {s.children.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{s.children.map((c) => <span key={c.student_id} className="qb-chip" style={{ minHeight: 28, padding: "0 10px", fontSize: 12.5 }}>{c.name}{c.best !== null ? ` · best ${Math.round(Number(c.best))}%` : " · not tried yet"}
            <button type="button" aria-label={`Take back from ${c.name}`} disabled={busy} onClick={() => void take(s.item_id, c.student_id)} style={{ all: "unset", cursor: "pointer", marginInlineStart: 6, fontWeight: 700 }}>×</button></span>)}</div>}
          {open === s.item_id && <>
            <ChildPicker legend="Who should have this set?" value={ids} onChange={setIds} options={kids.map((c) => ({ id: c.student_id as string, name: c.full_name ?? "Child", detail: c.grade_code ?? undefined }))} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="qb-btn" disabled={busy || !ids.length} onClick={() => void give(s.item_id)}>{busy ? "Giving…" : `Give to ${ids.length || "…"} ${ids.length === 1 ? "child" : "children"}`}</button><button className="qb-btn secondary" disabled={busy} onClick={() => setOpen("")}>Cancel</button></div>
          </>}
        </section>))}
    </div>
  );
}
