import type { QaFixture } from "../fixture-server";
import { baseTables, profileRow, shellRpc, uid } from "./common";

// Challenges QA fixture (signed in as an administrator, who can create, play and moderate challenges). Covers: the console with a live, a draft and a taken-down challenge,
// the editor with rounds, a book source, prizes and results, the player, a public page with rounds, prizes and a leaderboard, and the player's own history.
// Run: npx tsx scripts/qa/visual-qa.ts --role challenges --widths 360,390,768
const USER = uid(901), C_LIVE = uid(910), C_DRAFT = uid(911), C_HIDDEN = uid(912);
const iso = (days: number) => new Date(Date.now() + days * 864e5).toISOString();
const options = (n: number) => Array.from({ length: 4 }, (_, k) => `Option ${String.fromCharCode(65 + k)} for question ${n}, long enough to wrap on a narrow phone screen`);

export function buildChallengesFixture() {
  const profile = profileRow(USER, "ADMIN", "Efua Mensah");
  const brand = { organiser_name: "Accra Academy", tagline: "Think fast, think smart", welcome: "Good luck, and read each question carefully.", accent: "#1a7f5a" };
  const stages = [{ stage_no: 1, title: "Qualifier", question_count: 10, time_limit_seconds: 600, pass_percent: 60 }, { stage_no: 2, title: "Final", question_count: 15, time_limit_seconds: 900, pass_percent: 0 }];
  const prizes = [{ rank_from: 1, rank_to: 1, kind: "goods", title: "A tablet for the winner", details: "Delivered at school" }, { rank_from: 2, rank_to: 3, kind: "certificate", title: "Certificate of merit", details: null }];
  const card = { slug: "maths-sprint", title: "Maths Sprint: Basic 7 Showdown", summary: "Ten quick questions on fractions, ratio and algebra. Beat the clock and climb the board.", category: "curriculum", visibility: "PUBLIC", status: "LIVE", live: true,
    starts_at: iso(-3), ends_at: iso(10), question_count: 10, time_limit_seconds: 600, max_attempts: 2, reward_text: "Top three get certificates", participants: 128, stage_count: 2, stages, prizes, brand, finalized: false };
  const board = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, name: ["Kofi B.", "Abena O.", "Yaw D.", "Ama K.", "Kwame A.", "Esi T."][i % 6], score: 25 - i, max_score: 25, duration_ms: 400000 + i * 21000, is_me: i === 3, stages_done: 2 }));
  const mine = [
    { id: C_LIVE, slug: card.slug, title: card.title, status: "LIVE", visibility: "PUBLIC", category: "curriculum", question_count: 10, starts_at: card.starts_at, ends_at: card.ends_at, created_at: iso(-5), questions_loaded: 25, participants: 128, access_code: null },
    { id: C_DRAFT, slug: "book-week-quiz", title: "Book Week Quiz: Ananse and the Pot of Wisdom", status: "DRAFT", visibility: "PRIVATE", category: "book", question_count: 12, starts_at: null, ends_at: null, created_at: iso(-1), questions_loaded: 4, participants: 0, access_code: "ANANSE24" },
    { id: C_HIDDEN, slug: "reported-quiz", title: "A challenge that was reported", status: "LIVE", visibility: "PUBLIC", category: "community", question_count: 10, starts_at: null, ends_at: null, created_at: iso(-9), questions_loaded: 10, participants: 3, access_code: null },
  ];
  const questions = Array.from({ length: 6 }, (_, i) => ({ id: uid(930 + i), position: i + 1, question_text: `Which statement about the passage is correct for question ${i + 1}, and why does the author include it?`, options: options(i + 1), correct_index: i % 4,
    explanation: "Because the passage says so.", stage_no: i < 3 ? 1 : 2, source_chunk_id: uid(940 + i), source_quote: "Ananse wanted all the wisdom in the world, so he gathered it in a clay pot." }));
  const analytics = { views: 842, started: 301, players: 128, completed: 256, expired: 14, avg_score_percent: 64.2, avg_duration_ms: 412000,
    distribution: [{ band: 0, count: 8 }, { band: 20, count: 22 }, { band: 40, count: 61 }, { band: 60, count: 98 }, { band: 80, count: 67 }],
    stages: [{ stage_no: 1, started: 220, completed: 201, players: 128 }, { stage_no: 2, started: 81, completed: 55, players: 70 }],
    questions: Array.from({ length: 8 }, (_, i) => ({ position: i + 1, stage_no: 1, text: `A fairly long question text number ${i + 1} that should truncate cleanly`, answered: 200 - i * 3, percent_correct: 90 - i * 9 })),
    daily: Array.from({ length: 10 }, (_, i) => ({ day: new Date(Date.now() - (9 - i) * 864e5).toISOString().slice(0, 10), starts: 5 + ((i * 7) % 23) })) };
  const progress = stages.map((s, i) => ({ ...s, state: i === 0 ? "OPEN" : "LOCKED", attempts_used: 1, attempts_allowed: 2, best_score: i === 0 ? 5 : null, best_max: i === 0 ? 10 : null }));
  const started = { attempt_id: uid(950), expires_at: iso(0.007), time_limit_seconds: 600, title: card.title, stage_no: 1, stage_title: "Qualifier", stage_count: 2,
    questions: Array.from({ length: 10 }, (_, i) => ({ id: uid(960 + i), question_text: `Question ${i + 1}: what is the value of the expression when the numbers are written as fractions and then simplified?`, options: options(i + 1) })) };

  return {
    role: "challenges", user: { id: USER, email: profile.email },
    routes: [
      { path: "/creator", label: "console" },
      { path: `/creator/${C_DRAFT}`, label: "editor-questions" },
      ...["Rounds", "Source", "Prizes", "Look and feel", "Results"].map((clickText) => ({ path: `/creator/${C_LIVE}`, label: `editor-${clickText.toLowerCase().replace(/\W+/g, "-")}`, steps: [{ clickText }] })),
      { path: "/play", label: "my-challenges" },
      { path: `/play/${card.slug}`, label: "play-start" },
      { path: `/play/${card.slug}`, label: "play-question", steps: [{ clickText: "Start" }, { wait: 400 }] },
      { path: "/challenges", label: "public-list" },
      { path: `/challenges/${card.slug}`, label: "public-detail" },
      { path: "/admin/challenge-reports", label: "admin-reports" },
    ],
    tables: { ...baseTables(), profiles: [profile] },
    rpc: {
      ...shellRpc({ role: "platform_admin" }),
      qb_sme_context: () => ({ reviewer: false, content_admin: false, super_admin: true, finance_admin: false }),
      challenge_my_campaigns: () => mine,
      challenge_admin_overview: () => ({ campaigns: { LIVE: 2, DRAFT: 1 }, attempts_30d: 301, players_30d: 128, awards_pending: 3, top: [{ slug: card.slug, title: card.title, status: "LIVE", players: 128 }] }),
      challenge_creator_get: ({ p_id }: any) => ({ campaign: { ...(mine.find((m) => m.id === p_id) ?? mine[0]), brand, stage_count: p_id === C_LIVE ? 2 : 1, time_limit_seconds: 600, finalized_at: null, moderation_state: p_id === C_HIDDEN ? "UNDER_REVIEW" : "OK", moderation_note: null }, stages: p_id === C_LIVE ? stages : [], prizes: p_id === C_LIVE ? prizes : [], questions }),
      challenge_content_list: () => [{ asset_id: uid(970), title: "Ananse and the Pot of Wisdom", kind: "book", current_version: 2, versions: [{ version_id: uid(971), version: 2, source_name: "ananse.pdf", chunk_count: 18, char_count: 22000, created_at: iso(-1) }, { version_id: uid(972), version: 1, source_name: "ananse-draft.pdf", chunk_count: 16, char_count: 20000, created_at: iso(-4) }] }],
      challenge_content_chunks: () => Array.from({ length: 4 }, (_, i) => ({ id: uid(940 + i), position: i + 1, heading: i === 0 ? "Chapter 1" : null, body: "Ananse wanted all the wisdom in the world, so he gathered it in a clay pot and tried to hide it where no one could find it. ".repeat(3) })),
      challenge_analytics: () => analytics,
      challenge_awards_list: () => [],
      challenge_public_get: () => card,
      challenge_public_list: () => [card, { ...card, slug: "book-week", title: "Book Week", category: "book", stage_count: 1, participants: 14, brand: {} }],
      challenge_leaderboard: () => board,
      challenge_my_progress: () => progress,
      challenge_start: () => started,
      challenge_my_attempts: () => [{ slug: card.slug, title: card.title, attempt_no: 1, score: 5, max_score: 10, duration_ms: 388000, started_at: iso(-2), submitted_at: iso(-2), expired: false }, { slug: "book-week", title: "Book Week", attempt_no: 1, score: null, max_score: null, duration_ms: null, started_at: iso(-1), submitted_at: null, expired: false }],
      challenge_my_awards: () => [{ campaign: "Spelling Bee", slug: "spelling-bee", rank: 2, prize: "Certificate of merit", details: "Collect from the school office", status: "CONTACTED", updated_at: iso(-1) }],
      challenge_reports_list: () => [{ id: uid(980), reason: "misleading", details: "The answers to several questions are wrong.", status: "OPEN", created_at: iso(-1), handled_note: null, campaign_id: C_HIDDEN, slug: "reported-quiz", title: "A challenge that was reported", campaign_status: "LIVE", moderation_state: "UNDER_REVIEW", owner_name: "Efua Mensah", open_reports: 3 }],
    },
  } satisfies QaFixture;
}
