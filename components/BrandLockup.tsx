import Image from "next/image";
import Link from "next/link";
import { BRAND_DESCRIPTOR_FULL, BRAND_DESCRIPTOR_SHORT, BRAND_ICON, BRAND_NAME, type LockupVariant } from "@/lib/public/brand";

// The QuizBox horizontal logo lockup (mark + QUIZBOX + descriptor).
//   full       QUIZBOX / Learning • Assessment • Competition Platform
//   compact    QUIZBOX / Learning • Assessment • Competition
//   mark       symbol + QUIZBOX, no descriptor (small navigation)
//   responsive full on wide screens, compact on medium, mark on small (see globals.css .qb-lockup)
// Screen readers hear only "QuizBox"; the descriptor is visual branding.
export default function BrandLockup({ variant = "full", size = 36, href, priority = false, className = "" }: { variant?: LockupVariant; size?: number; href?: string; priority?: boolean; className?: string }) {
  const body = (
    <>
      <Image src={BRAND_ICON.src} alt="" width={size} height={size} priority={priority} className="qb-lockup-mark" style={{ width: size, height: size }} />
      <span className="qb-lockup-text" aria-hidden="true">
        <span className="qb-lockup-word"><span className="qb-lockup-accent">Q</span>UIZ<span className="qb-lockup-accent qb-lockup-box">BOX</span></span>
        {variant !== "mark" && (
          <span className="qb-lockup-desc">
            {(variant === "full" || variant === "responsive") && <span className="qb-lockup-desc-full">{BRAND_DESCRIPTOR_FULL}</span>}
            {(variant === "compact" || variant === "responsive") && <span className="qb-lockup-desc-short">{BRAND_DESCRIPTOR_SHORT}</span>}
          </span>
        )}
      </span>
    </>
  );
  const classes = `qb-lockup qb-lockup-${variant} ${className}`.trim();
  return href
    ? <Link href={href} className={classes} aria-label={`${BRAND_NAME} home`}>{body}</Link>
    : <span className={classes} role="img" aria-label={BRAND_NAME}>{body}</span>;
}
