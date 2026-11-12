import SocialIcon from "@/components/SocialIcon";
import { SOCIAL_CHANNELS } from "@/lib/public/social";

// Links to QuizBox's official channels, each in its platform's colour.
//   icons  a row of round buttons (footer, phone menu, sidebar); wraps on narrow screens, each at least 44px on a phone
//   list   icon, platform name and handle in a two-column grid (student home, contact page), so a learner knows what they are tapping
// Every link opens in a new tab and says so to screen readers; the glyphs themselves are decorative.
export default function SocialLinks({ variant = "icons", label = "QuizBox on social media", className = "" }: { variant?: "icons" | "list"; label?: string; className?: string }) {
  return (
    <ul className={`qb-social qb-social-${variant} ${className}`.trim()} aria-label={label}>
      {SOCIAL_CHANNELS.map((c) => (
        <li key={c.id}>
          <a className="qb-social-link" href={c.href} target="_blank" rel="noopener noreferrer" aria-label={`${c.verb} QuizBox on ${c.name} (opens in a new tab)`} title={`${c.name}: ${c.handle}`}>
            <span className="qb-social-chip" data-channel={c.id}><SocialIcon id={c.id} size={variant === "list" ? 22 : 20} /></span>
            {variant === "list" && <span className="qb-social-text"><strong>{c.name}</strong><span>{c.handle}</span></span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
