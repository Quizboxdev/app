"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { findStaff, getMyStaffAccess, listStaff, setStaffAccess, STAFF_OFF_MESSAGE, type StaffAccount, type StaffMember } from "@/lib/api/staff";
import { WORKFLOWS, workflowLabel } from "@/lib/staff/workflows";
import { formatDate } from "@/lib/format";

// Admin, Staff access (Super Admin only). Find a colleague by email and tick the connected workflows they may use. Each workflow opens a set of admin tabs that belong together;
// the database still checks every action, so a ticked box can never give more than that workflow allows. Git, Vercel and Supabase are not part of any workflow.
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export default function StaffAccessPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [members, setMembers] = useState<StaffMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState<StaffAccount | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const refresh = useCallback(async () => { setMembers(await listStaff()); }, []);
  useEffect(() => {
    getMyStaffAccess()
      .then(async (me) => { setEnabled(me.enabled); if (me.enabled) await refresh(); })
      .catch((e) => { setError(e.message); setEnabled(false); setMembers([]); });
  }, [refresh]);

  function pick(a: StaffAccount) { setAccount(a); setChosen(a.workflows); setDone(""); setError(""); }
  async function find(address = email) {
    setBusy(true); setError(""); setDone("");
    try { pick(await findStaff(address)); } catch (e: any) { setAccount(null); setError(e.message); }
    setBusy(false);
  }
  async function save() {
    if (!account) return;
    const added = chosen.filter((id) => !account.workflows.includes(id) && WORKFLOWS.find((w) => w.id === id)?.sensitive);
    if (added.length && !window.confirm(`${added.map(workflowLabel).join(" and ")} shows money and payment records. Give ${account.email} this access?`)) return;
    setBusy(true); setError(""); setDone("");
    try {
      const r = await setStaffAccess(account.user_id, chosen);
      setAccount({ ...account, workflows: r.workflows }); setChosen(r.workflows);
      setDone(r.workflows.length ? `${account.email} can now use: ${r.workflows.map(workflowLabel).join(", ")}. They see the new tabs the next time they open the app.` : `${account.email} no longer has any staff access.`);
      await refresh();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  const changed = account ? !same(chosen, account.workflows) : false;
  return (
    <>
      <div className="qb-page-head"><div><h1>Staff access</h1>
        <p>Give a colleague the tabs for the work they do. Find them by the email on their QuizBox account, tick the workflows, and save. You can change or withdraw access at any time.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {done}</div>}

      {enabled === null ? <p className="qb-muted">Loading…</p> : !enabled ? <div className="qb-card" role="status">{STAFF_OFF_MESSAGE}</div> : <>
        <section className="qb-card qb-form" aria-labelledby="qb-staff-find">
          <h2 id="qb-staff-find">Find a colleague</h2>
          <form onSubmit={(e) => { e.preventDefault(); void find(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="qb-field" style={{ flex: "1 1 260px" }}>Email on their QuizBox account
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" /></label>
            <button className="qb-btn" disabled={busy || !email.includes("@")} type="submit">Find</button>
          </form>
          <p className="qb-small qb-muted">The person needs a QuizBox account first. Ask them to sign up, then find them here.</p>
        </section>

        {account && <section className="qb-card qb-form" style={{ marginTop: 16 }} aria-labelledby="qb-staff-edit">
          <h2 id="qb-staff-edit">{account.full_name || account.email}</h2>
          <p className="qb-muted">{account.email} · {account.role.toLowerCase()} account · {account.status}</p>
          {account.is_super ? <p role="status">This is a Super Admin. Their access is not managed here.</p> : account.status.toLowerCase() !== "active" ? <p role="status">This account is not active, so it cannot be given staff access.</p> : <>
            <fieldset className="qb-field"><legend>Workflows this person may use</legend>
              {WORKFLOWS.map((w) => <label key={w.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
                <input type="checkbox" checked={chosen.includes(w.id)} style={{ marginTop: 4 }}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, w.id] : chosen.filter((x) => x !== w.id))} />
                <span><strong>{w.label}</strong>{w.sensitive && <span className="qb-pill" style={{ marginLeft: 8 }}>Sensitive</span>}
                  <span style={{ display: "block" }}>{w.summary}</span>
                  <span className="qb-small qb-muted" style={{ display: "block" }}>Opens: {w.tabs.map(([, label]) => label).join(", ")}</span></span>
              </label>)}
            </fieldset>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="qb-btn" disabled={busy || !changed} onClick={() => void save()}>{busy ? "Saving…" : chosen.length ? "Save access" : "Withdraw all access"}</button>
              <button className="qb-btn secondary" disabled={busy} onClick={() => { setAccount(null); setEmail(""); }}>Close</button>
            </div>
          </>}
        </section>}

        <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="qb-staff-list">
          <h2 id="qb-staff-list">Who has access now</h2>
          {members === null ? <p className="qb-muted">Loading…</p> : !members.length ? <p className="qb-muted">Nobody has been given staff access yet.</p> :
            <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Name</th><th>Email</th><th>Workflows</th><th>Since</th><th>Action</th></tr></thead><tbody>
              {members.map((m) => <tr key={m.user_id}>
                <td>{m.full_name || "—"}</td><td>{m.email}</td>
                <td>{m.workflows.length ? m.workflows.map(workflowLabel).join(", ") : <span className="qb-muted">None</span>}</td>
                <td>{formatDate(m.since)}</td>
                <td><button className="qb-btn secondary" disabled={busy} onClick={() => { setEmail(m.email); void find(m.email); }}>Change</button></td></tr>)}
            </tbody></table></div>}
        </section>
      </>}
    </>
  );
}
