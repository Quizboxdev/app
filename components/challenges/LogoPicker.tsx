"use client";

import { useRef, useState } from "react";
import { LOGO_MAX_CHARS, LOGO_MAX_PIXELS } from "@/lib/challenges/limits";

// Pick a logo: it is shrunk in the browser to at most 160 pixels and stored as a small picture (PNG, JPEG or WebP; SVG is not accepted because it can carry scripts).
// Users see it on the quiz card, the sponsored carousel and the quiz page.
async function shrink(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG or WebP picture.");
  if (file.size > 4 * 1024 * 1024) throw new Error("That picture is larger than 4 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("We could not read that picture.")); i.src = url; });
    for (const [max, quality] of [[LOGO_MAX_PIXELS, 0.85], [LOGO_MAX_PIXELS, 0.6], [112, 0.6], [80, 0.5]] as const) {
      const scale = Math.min(1, max / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Your browser cannot prepare pictures.");
      ctx.drawImage(img, 0, 0, w, h);
      for (const type of ["image/webp", "image/png"]) { const data = canvas.toDataURL(type, quality); if (data.startsWith(`data:${type}`) && data.length <= LOGO_MAX_CHARS) return data; }
    }
    throw new Error("That logo is too detailed. Try a simpler or smaller version.");
  } finally { URL.revokeObjectURL(url); }
}

export default function LogoPicker({ value, onChange, onError }: { value?: string; onChange: (dataUrl: string | undefined) => void; onError?: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  async function pick(file: File | undefined) {
    if (!file) return; setBusy(true); setProblem(""); onError?.("");
    try { onChange(await shrink(file)); } catch (e: any) { setProblem(e.message); onError?.(e.message); }
    setBusy(false); if (input.current) input.current.value = "";
  }
  return (
    <div className="qb-field">
      <span>Logo</span>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div aria-hidden="true" style={{ width: 72, height: 72, borderRadius: 12, border: "1px dashed currentColor", display: "grid", placeItems: "center", overflow: "hidden", background: "#fff" }}>
          {value ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={value} alt="" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <span style={{ color: "#777", fontSize: 12 }}>No logo</span>}
        </div>
        <div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pick(e.target.files?.[0])} aria-label="Choose a logo picture" disabled={busy} />
          {value && <button type="button" className="qb-link-btn" onClick={() => onChange(undefined)}>Remove logo</button>}
          <p className="qb-muted qb-small">A square picture works best. It is shrunk for you. People see it on your quiz card and in the sponsored carousel.</p>
          {problem && <p role="alert" className="qb-error">{problem}</p>}
        </div>
      </div>
    </div>
  );
}
