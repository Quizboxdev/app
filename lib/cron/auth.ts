import { timingSafeEqual } from "node:crypto";

// Scheduled routes are open only to a caller holding CRON_SECRET (16+ characters) as a bearer token.
export const cronConfigured = () => (process.env.CRON_SECRET ?? "").length >= 16;
export function cronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET, header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
