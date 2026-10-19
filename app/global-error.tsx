"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/monitoring/report";

// Last resort: the whole app failed to render (the layout itself crashed). Inline styles only, because the stylesheet may not have loaded.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError("RENDER", error, "/"); }, [error]);
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
      <main style={{ maxWidth: 520, margin: "12vh auto", padding: "0 16px", textAlign: "center" }}>
        <h1 style={{ fontSize: 24 }}>QuizBox is having a problem</h1>
        <p style={{ color: "#475569" }}>Please try again in a moment. If it continues, email us from the contact page.</p>
        <button type="button" onClick={reset} style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: "#2563eb", color: "#fff", fontSize: 16 }}>Try again</button>
      </main>
    </body></html>
  );
}
