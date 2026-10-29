import { ImageResponse } from "next/og";

// One 1200 x 630 card for every link preview (audit UX-032): QuizBox wordmark, a headline, a line of detail, and an accent bar.
export const OG_SIZE = { width: 1200, height: 630 } as const;

export function ogCard({ eyebrow, title, detail, accent = "#2563eb" }: { eyebrow: string; title: string; detail?: string; accent?: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0f172a", color: "#ffffff", padding: "64px 72px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>
          <span style={{ color: "#f87171" }}>QUIZ</span><span>BOX</span>
          <span style={{ marginLeft: 24, fontSize: 24, fontWeight: 500, color: "#94a3b8" }}>{eyebrow}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: title.length > 48 ? 64 : 80, fontWeight: 800, lineHeight: 1.1, letterSpacing: -2 }}>{title}</div>
          {detail ? <div style={{ display: "flex", marginTop: 24, fontSize: 34, color: "#cbd5e1", lineHeight: 1.3 }}>{detail}</div> : null}
        </div>
        <div style={{ display: "flex", height: 12, width: "100%", background: accent, borderRadius: 6 }} />
      </div>
    ),
    { ...OG_SIZE },
  );
}
