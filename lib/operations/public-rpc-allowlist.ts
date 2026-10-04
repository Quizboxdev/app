// Functions deliberately executable by the `anon` role. Every entry is an explicit, reviewed public
// contract; there are no patterns or wildcards. Any other anon-executable function is a P0 finding.
//
// - qb_marketplace_catalog: published/approved marketplace catalogue, read-only.
// - qb_signup_markets: country-first signup market list (countries + ACTIVE non-test markets with
//   display configuration). Granted to anon in 20261003100000_multi_market_platform.sql
//   ("grant execute on function public.qb_signup_markets() to anon,authenticated") after an
//   explicit revoke from public/anon; documented in docs/security-release-review.md.
//
// Not listed (reviewed 2026-10-04, NEEDS_CHANGES): qb_auth_failure. Anonymous by necessity and
// write-only, but p_code accepts free text and its rate cap depends on an unverified index. Add it
// only after docs/proposals/qb_auth_failure_hardening.sql (or equivalent) is applied.
export const INTENTIONAL_ANON_RPCS: Readonly<Record<string, string>> = Object.freeze({
  qb_marketplace_catalog: "anon published catalogue; authenticated",
  qb_signup_markets: "anon country-first signup market list (read-only, display metadata); authenticated",
});

export function isIntentionalAnonRpc(name: unknown): boolean {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(INTENTIONAL_ANON_RPCS, name);
}

export function unexpectedAnonFunctions<T extends { name?: unknown; anon?: unknown }>(functions: T[]): T[] {
  return functions.filter((f) => Boolean(f.anon) && !isIntentionalAnonRpc(f.name));
}
