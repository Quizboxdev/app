"use client";

import { useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import LogoImage from "./LogoImage";

export default function LogoPicker({ campaignId, value, onChange, onError }: { campaignId: string; value?: string; onChange: (storagePath: string | undefined) => void; onError?: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  async function pick(file: File | undefined) {
    if (!file) return; setBusy(true); setProblem(""); onError?.("");
    try {
      if (file.size > 4_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image up to 4 MB.");
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error("Please sign in again.");
      const form = new FormData(); form.set("campaign_id", campaignId); form.set("file", file);
      const response = await fetch("/api/challenges/logo", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` }, body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.path !== "string") throw new Error(result.error === "QB_PERMISSION_DENIED" ? "You cannot change this challenge logo." : "The logo could not be uploaded. Please try another image.");
      onChange(result.path);
    } catch (e) { const message = e instanceof Error ? e.message : "The logo upload failed."; setProblem(message); onError?.(message); }
    setBusy(false); if (input.current) input.current.value = "";
  }
  return (
    <div className="qb-field">
      <span>Logo</span>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div aria-hidden="true" style={{ width: 72, height: 72, borderRadius: 12, border: "1px dashed currentColor", display: "grid", placeItems: "center", overflow: "hidden", background: "#fff" }}>
          {value ? <LogoImage src={value} style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <span style={{ color: "#777", fontSize: 12 }}>No logo</span>}
        </div>
        <div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pick(e.target.files?.[0])} aria-label="Choose a logo picture" disabled={busy} />
          {value && <button type="button" className="qb-link-btn" onClick={() => onChange(undefined)}>Remove logo</button>}
          <p className="qb-muted qb-small">PNG, JPEG or WebP up to 4 MB. QuizBox compresses it to WebP, at most 160 × 160 pixels and 24 KB. It appears on your quiz card and public challenge page.</p>
          {problem && <p role="alert" className="qb-error">{problem}</p>}
        </div>
      </div>
    </div>
  );
}
