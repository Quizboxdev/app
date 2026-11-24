"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { authorStatus, mockMessage, type AuthorStatus } from "@/lib/api/mock-exams";

// Every mock-exam author screen opens through this gate: the database says whether the feature is on and whether this person may build exams (an active teacher, a verified organisation sponsor, or staff).
export default function AccessGate({ children }: { children: (status: AuthorStatus) => ReactNode }) {
  const [status, setStatus] = useState<AuthorStatus | null | undefined>(undefined), [error, setError] = useState("");
  useEffect(() => { authorStatus().then(setStatus).catch((e) => { setError(e.message); setStatus(null); }); }, []);
  if (status === undefined) return <div className="qb-card qb-muted" role="status">Loading…</div>;
  if (status === null) return <div className="qb-card qb-error" role="alert">{error || "We could not check your access. Please try again."}</div>;
  if (!status.enabled) return <div className="qb-card"><h2>Mock exams are not open yet</h2><p className="qb-muted">We will tell you when you can build cumulative exams for your classes.</p></div>;
  if (!status.can_author) return <div className="qb-card"><h2>Mock exams</h2><p>{mockMessage(status.reason)}</p><Link className="qb-btn secondary" href="/account">Go to my account</Link></div>;
  return <>{children(status)}</>;
}
