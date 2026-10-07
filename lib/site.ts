// Canonical public origin of QuizBox. Used for metadata (canonical/Open Graph URLs), robots.txt and the sitemap.
// Auth email links deliberately keep using the visitor's own origin (window.location.origin), so previews and
// the vercel.app URL keep working; only search engines and link previews are pointed at this domain.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://quizbox.io").replace(/\/+$/, "");

// Public, indexable marketing and legal pages. Everything else (workspaces, auth, onboarding) is private.
export const PUBLIC_PATHS = ["/", "/join/country", "/join/school", "/join/sme", "/join/sponsor", "/contact", "/privacy", "/terms"] as const;
