import { parseBlocks } from "@/lib/policies/render";

// Marketing posts (migration 20261124120000): pure helpers shared by the public page, the admin screen and the tests.
export type PostPublic = { slug: string; title: string; summary: string; body: string; flyer_path: string | null; flyer_alt: string | null; published_at: string | null; updated_at: string };
export type PostListItem = { slug: string; title: string; summary: string; flyer_path: string | null; published_at: string | null };

export const POST_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const slugFromTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// Where a reader lands when they press Subscribe: the sign-up screen. The source is kept in the address so it can be counted later.
export const subscribeHref = (slug: string) => `/login?mode=register&utm_source=post&utm_campaign=${encodeURIComponent(slug)}`;

// The page address people paste into social media, email and WhatsApp.
export const postUrl = (origin: string, slug: string) => `${origin.replace(/\/+$/, "")}/p/${slug}`;

// The flyer is stored in a public bucket so other sites can fetch it for link previews. Null when there is no flyer or no storage address configured.
export function flyerUrl(path: string | null | undefined, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!path || !supabaseUrl || !/^[0-9a-f-]{36}\.png$/.test(path)) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/marketing-posts/${path}`;
}

// What staff paste into a post, and what we send to the sharing sites. Kept short and plain.
export const shareText = (title: string, summary: string, url: string) => `${title}\n${summary}\n${url}`;

const SUBSCRIBE_LINE = (href: string, first: boolean) => first
  ? `**New to QuizBox?** [Subscribe free and start practising](${href})`
  : `**Ready to try it?** [Subscribe to QuizBox now](${href})`;
const isPlain = (block: string) => block.trim() !== "" && !/^(#{1,3}\s|[-*]\s|\d+[.)]\s)/.test(block.trim());

// Puts subscribe links into the article so a reader meets one without scrolling to the end.
//   - Writers can place one: [any words](subscribe) becomes a link to the sign-up screen.
//   - Where a writer has not, one line is added after the second paragraph and, in a long post, another about two thirds of the way down.
// Lines are only added between plain paragraphs, never inside a list or against a heading.
export function injectSubscribe(body: string, href: string): string {
  const placed = /\]\(subscribe\)/i.test(body);
  const source = body.replace(/\r\n?/g, "\n").replace(/\]\(subscribe\)/gi, `](${href})`);
  if (placed) return source;      // the writer placed at least one
  const blocks = source.split(/\n{2,}/);
  const plainIdx = blocks.map((b, i) => (isPlain(b) ? i : -1)).filter((i) => i >= 0);
  if (plainIdx.length < 2) return source;
  const spots = new Set<number>([plainIdx[1]]);
  if (plainIdx.length >= 8) spots.add(plainIdx[Math.min(plainIdx.length - 1, Math.floor((plainIdx.length * 2) / 3))]);
  let first = true;
  const out: string[] = [];
  blocks.forEach((b, i) => { out.push(b); if (spots.has(i)) { out.push(SUBSCRIBE_LINE(href, first)); first = false; } });
  return out.join("\n\n");
}

// How many links to the sign-up screen a rendered article holds (used by the tests and by the admin preview note).
export const subscribeLinkCount = (body: string, href: string) => parseBlocks(injectSubscribe(body, href)).reduce((n, b) => n + (b.kind === "p" ? (b.text.match(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length : 0), 0);
