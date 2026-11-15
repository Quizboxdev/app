"use client";

import { useEffect, useState } from "react";
import { Globe, Mail } from "lucide-react";
import SocialIcon, { type GlyphId } from "@/components/SocialIcon";
import SocialLinks from "@/components/SocialLinks";
import { kindInfo, loadSocialChannels, type PublicChannel, type SocialKind } from "@/lib/api/social";

// The channels in the app menu's "Follow QuizBox" corner. They come from Admin > Social channels once that is switched on;
// until then (or if the list cannot be loaded) the built-in six are shown, exactly as before.
const GLYPH: Partial<Record<SocialKind, GlyphId>> = { tiktok: "tiktok", instagram: "instagram", facebook: "facebook", youtube: "youtube", linkedin: "linkedin", snapchat: "snapchat", whatsapp: "whatsapp", whatsapp_channel: "whatsapp", telegram: "telegram", x: "x" };

export function ChannelIcon({ kind, size = 20 }: { kind: SocialKind; size?: number }) {
  const g = GLYPH[kind];
  if (g) return <SocialIcon id={g} size={size} />;
  return kind === "email" ? <Mail size={size - 4} aria-hidden="true" /> : <Globe size={size - 4} aria-hidden="true" />;
}

// null while loading or when nothing is managed yet.
export function useSocialChannels(): PublicChannel[] | null {
  const [list, setList] = useState<PublicChannel[] | null>(null);
  useEffect(() => { let on = true; void loadSocialChannels().then((r) => { if (on && r.length) setList(r); }); return () => { on = false; }; }, []);
  return list;
}

export default function AppSocialLinks() {
  const list = useSocialChannels();
  if (!list) return <SocialLinks />;
  return (
    <ul className="qb-social qb-social-icons" aria-label="QuizBox on social media">
      {list.map((c) => {
        const mail = c.kind === "email";
        const name = `${kindInfo(c.kind)?.verb ?? "Open"} QuizBox on ${c.label}`;
        return (
          <li key={c.id}>
            <a className="qb-social-link" href={c.url} {...(mail ? {} : { target: "_blank", rel: "noopener noreferrer" })} aria-label={mail ? name : `${name} (opens in a new tab)`} title={c.handle ? `${c.label}: ${c.handle}` : c.label}>
              <span className="qb-social-chip" data-channel={c.kind}><ChannelIcon kind={c.kind} /></span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
