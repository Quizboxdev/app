"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { myRequests, CATEGORIES, type MyRequest } from "@/lib/api/support";
import { StatusChip, when } from "@/components/support/parts";

// Help and support for everyone signed in: your requests, and a way to send a new one. (The Help centre with guides comes first for most questions; this is for when a guide is not enough.)
export default function SupportPage() {
  const [items, setItems] = useState<MyRequest[] | null>(null), [error, setError] = useState("");
  useEffect(() => { myRequests().then(setItems).catch((e) => { setError(e.message); setItems([]); }); }, []);
  return (
    <>
      <div className="qb-page-head">
        <div><h1>Support</h1><p>Ask us for help, and follow your requests. We usually reply within 3 working days.</p></div>
        <Link className="qb-btn" href="/support/new">Send a new request</Link>
      </div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div className="qb-card">
        <h2>Your requests</h2>
        {items === null ? <p className="qb-muted">Loading…</p> : items.length === 0 ? <p className="qb-muted">You have not sent a request yet.</p> : (
          <table className="qb-table"><thead><tr><th>Reference</th><th>About</th><th>Status</th><th>Last update</th></tr></thead><tbody>
            {items.map((r) => <tr key={r.id}><td><Link className="qb-link" href={`/support/${r.id}`}>{r.reference}</Link></td><td>{r.subject}<span className="qb-muted qb-small" style={{ display: "block" }}>{CATEGORIES[r.category]}</span></td><td><StatusChip status={r.status} /></td><td>{when(r.last_message_at)}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </>
  );
}
