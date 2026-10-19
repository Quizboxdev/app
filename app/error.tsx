"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/monitoring/report";

// Shown when a page crashes while rendering. The learner sees a plain message and a way forward; the crash is reported for staff.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError("RENDER", error); }, [error]);
  return (
    <main style={{ maxWidth: 520, margin: "12vh auto", padding: "0 16px", textAlign: "center", fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
      <p style={{ color: "#475569" }}>This page hit a problem. Your work is saved. Please try again, and if it keeps happening, tell us and we will fix it.</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
        <button type="button" className="qb-btn" onClick={reset}>Try again</button>
        <Link className="qb-btn secondary" href="/contact">Contact us</Link>
      </div>
    </main>
  );
}
