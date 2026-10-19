"use client";

import { useEffect } from "react";

// Sends one view per browser session for a public challenge page. Storage can be blocked, so every access is guarded.
export default function ViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    try { if (sessionStorage.getItem(`qb-ch-view:${slug}`)) return; sessionStorage.setItem(`qb-ch-view:${slug}`, "1"); } catch { /* count it anyway */ }
    void fetch("/api/challenges/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }), keepalive: true }).catch(() => undefined);
  }, [slug]);
  return null;
}
