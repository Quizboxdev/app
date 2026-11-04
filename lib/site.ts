// Canonical public origin of QuizBox. Used for metadata (canonical/Open Graph URLs), robots.txt and the sitemap.
// Auth email links deliberately keep using the visitor's own origin (window.location.origin), so previews and
// the vercel.app URL keep working; only search engines and link previews are pointed at this domain.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.quizbox.io").replace(/\/+$/, "");

// Where a buyer is sent back to after paying: the site they started from, so Preview payments return to Preview and Production to Production.
// Only https addresses on quizbox.io are trusted; anything else (a local run, an odd host header) falls back to the canonical site.
export function returnOrigin(requestUrl: string): string {
  try {
    const u = new URL(requestUrl), host = u.hostname.toLowerCase();
    if (u.protocol === "https:" && (host === "quizbox.io" || host.endsWith(".quizbox.io"))) return u.origin;
  } catch { /* fall through */ }
  return new URL(SITE_URL).origin;
}

// Public, indexable marketing and legal pages. Everything else (workspaces, auth, onboarding) is private.
export const PUBLIC_PATHS = ["/", "/join/country", "/join/school", "/join/sme", "/join/sponsor", "/pricing", "/contact", "/privacy", "/terms", "/refunds", "/cookies", "/help"] as const;
