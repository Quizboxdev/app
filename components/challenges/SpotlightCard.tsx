import Link from "next/link";
import { BookOpen, Trophy, Zap } from "lucide-react";
import { FORMATS, formatOf, readableText, type Brand } from "@/lib/challenges/types";

// How a quiz looks to people browsing: the carousel, the sidebar, and the live preview while it is being made. Pure display (no data loading).
export type SpotlightProps = { title: string; summary?: string; brand?: Brand; format?: string; rounds?: number; questions?: number; hasMaterial?: boolean; played?: number; href?: string; sponsored?: boolean; compact?: boolean; cta?: string };

export default function SpotlightCard(p: SpotlightProps) {
  const f = FORMATS[formatOf(p.format)], accent = p.brand?.accent && /^#[0-9a-f]{6}$/i.test(p.brand.accent) ? p.brand.accent : "#1a7f5a";
  const btn = { background: accent, color: readableText(accent) ?? "#fff", borderColor: accent } as const;
  const body = (
    <div className="qb-card" style={{ borderTop: `6px solid ${accent}`, display: "grid", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div aria-hidden="true" style={{ flex: "0 0 auto", width: p.compact ? 44 : 64, height: p.compact ? 44 : 64, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.12)", display: "grid", placeItems: "center", overflow: "hidden" }}>
          {p.brand?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.brand.logo} alt="" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <Trophy size={p.compact ? 20 : 28} color={accent} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <p className="qb-overline" style={{ margin: 0 }}>{p.brand?.organiser_name || "Your organisation"}{p.sponsored !== false ? " · Sponsored" : ""}</p>
          <h3 style={{ margin: "2px 0 0", overflowWrap: "anywhere" }}>{p.title.trim() || "Your headline appears here"}</h3>
        </div>
      </div>
      {!p.compact && <p className="qb-muted" style={{ margin: 0 }}>{p.summary?.trim() || "A short line that makes people want to join."}</p>}
      <p className="qb-muted qb-small" style={{ margin: 0, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span><Zap size={12} aria-hidden="true" /> {f.noun === "competition" ? ((p.rounds ?? 1) > 1 ? `${p.rounds} rounds` : "Competition") : "Challenge"}</span>
        {p.questions ? <span>{p.questions} questions</span> : null}
        {p.hasMaterial ? <span><BookOpen size={12} aria-hidden="true" /> Reading included</span> : null}
        {p.played ? <span>{p.played} played</span> : null}
      </p>
      <span className="qb-btn" style={{ ...btn, justifySelf: "start" }}>{p.cta ?? "Take part"}</span>
    </div>
  );
  return p.href ? <Link href={p.href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : body;
}
