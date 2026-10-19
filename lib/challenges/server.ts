import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type { ChallengeCard, LeaderRow, PublicChallenge } from "./types";

// Public pages read campaigns on the server through the service role: the database functions return only live public data and never questions or answers.
// If the migration is not applied or the database is unreachable the pages show an empty state instead of failing.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export async function listPublicChallenges(): Promise<PublicChallenge[]> {
  try { const { data } = await getSupabaseAdminClient().rpc("challenge_public_list", { p_limit: 48, p_offset: 0 }); return (data ?? []) as PublicChallenge[]; } catch { return []; }
}
export async function getPublicChallenge(slug: string): Promise<ChallengeCard | null> {
  if (!SLUG.test(slug)) return null;
  try { const { data } = await getSupabaseAdminClient().rpc("challenge_public_get", { p_slug: slug }); return (data ?? null) as ChallengeCard | null; } catch { return null; }
}
export async function getPublicLeaderboard(slug: string): Promise<LeaderRow[]> {
  if (!SLUG.test(slug)) return [];
  try { const { data } = await getSupabaseAdminClient().rpc("challenge_leaderboard", { p_slug: slug, p_limit: 20 }); return (data ?? []) as LeaderRow[]; } catch { return []; }
}
