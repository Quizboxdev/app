// Shapes of what the competition API returns, so the competition screens are checked by the compiler instead of using `any`.
// The database client is not generated from the schema, so rows are described here, once, and cast at the API boundary (lib/api/competition.ts).
export type CompetitionTeam = { id: string; team_name: string; team_code?: string | null; institutions?: { name?: string | null } | null; [column: string]: unknown };
export type CompetitionInstitution = { id: string; name?: string | null; school_name?: string | null; [column: string]: unknown };
export type LeaderboardRow = { entity_type: string; entity_id: string; rank?: number | null; score: number; percentage?: number | string | null; [column: string]: unknown };
