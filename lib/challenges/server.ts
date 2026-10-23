import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type { ChallengeCard, Format, LeaderRow, LibraryStats, PublicChallenge } from "./types";

// Public pages read campaigns on the server through the service role: the database functions return only live public data and never questions or answers.
// If the migration is not applied or the database is unreachable the pages show an empty state instead of failing.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export async function listPublicChallenges(format: Format = "CHALLENGE"): Promise<PublicChallenge[]> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("challenge_public_list", { p_limit: 48, p_offset: 0, p_format: format });
    if (error) console.error("[challenges] public list failed:", `${error.code ?? ""} ${error.message}`.trim());
    return (data ?? []) as PublicChallenge[];
  } catch (e) { console.error("[challenges] public list unavailable:", e instanceof Error ? e.message : "unknown error"); return []; }
}
export async function getPublicChallenge(slug: string): Promise<ChallengeCard | null> {
  if (!SLUG.test(slug)) return null;
  try { const { data } = await getSupabaseAdminClient().rpc("challenge_public_get", { p_slug: slug }); return (data ?? null) as ChallengeCard | null; } catch { return null; }
}
export async function getPublicLeaderboard(slug: string): Promise<LeaderRow[]> {
  if (!SLUG.test(slug)) return [];
  try { const { data } = await getSupabaseAdminClient().rpc("challenge_leaderboard", { p_slug: slug, p_limit: 20 }); return (data ?? []) as LeaderRow[]; } catch { return []; }
}

// Whether a public quiz has a player limit and is full (counts only). Not full, and no limit, if the database function is not there yet.
export async function getSeatStatus(slug: string): Promise<{ capped: boolean; cap: number | null; joined: number; full: boolean }> {
  const none = { capped: false, cap: null, joined: 0, full: false };
  if (!SLUG.test(slug)) return none;
  try { const { data } = await getSupabaseAdminClient().rpc("qb_challenge_seat_status", { p_slug: slug }); return (data ?? none) as typeof none; } catch { return none; }
}

// How much material QuizBox hosts, by type (counts only). Empty if the database function is not there yet.
export async function getLibraryStats(): Promise<LibraryStats> {
  try { const { data } = await getSupabaseAdminClient().rpc("challenge_library_stats"); return (data ?? { documents: 0, by_type: {} }) as LibraryStats; } catch { return { documents: 0, by_type: {} }; }
}
