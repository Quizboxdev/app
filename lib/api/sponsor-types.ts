// Shapes of what the sponsor API returns, so the sponsor dashboard is checked by the compiler instead of using `any`.
// The database client is not generated from the schema, so rows are described here, once, and cast at the API boundary (lib/api/sponsor.ts).
export type SponsorProfile = { id: string; organization_name?: string | null; contact_name?: string | null; [column: string]: unknown };
export type SponsorCompetitionRow = {
  id: string;
  sponsorship_role?: string | null;
  status?: string | null;
  currency?: string | null;
  committed_amount?: number | string | null;
  competitions?: { title?: string | null } | null;
  [column: string]: unknown;
};
export type ParticipationFunnel = { registrations?: number | string | null; started?: number | string | null; completed?: number | string | null; drop_off_rate?: number | string | null };
export type ScoreBucket = Record<string, unknown>;
export type DemographicItem = { label?: string | null; name?: string | null; value?: number | string | null; count?: number | string | null };
export type SponsorDemographics = { markets?: DemographicItem[]; institutions?: DemographicItem[] };
export type QuestionPerformanceRow = { label?: string | null; difficulty?: string | null; percentage?: number | string | null };
