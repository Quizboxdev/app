import { generateCandidates, type Actor, type Candidate, type Chunk, type GenerationInput } from "./lifecycle";
import type { SponsorRepository } from "./repository";
import type { ContentContext, SourceCorpus } from "../content/market-context";

type JobInput = { competitionId: string; sponsorId: string; scope: "LOCAL_MARKET" | "MULTI_MARKET" | "GLOBAL"; sourceMode: "CURRICULUM_ALIGNED" | "SPONSOR_SOURCE" | "HYBRID"; marketIds: string[]; sourceIds: string[]; count: number; provider: string; model: string };
export type CompetitionProvider = { name: string; model: string; generate(input: GenerationInput, chunks: Chunk[]): Promise<Candidate[]> };
export function configuredCompetitionProvider(env: Record<string, string | undefined>, request: typeof fetch = fetch): CompetitionProvider {
  const name = env.QUIZBOX_GENERATION_PROVIDER, model = env.QUIZBOX_GENERATION_MODEL, endpoint = env.QUIZBOX_GENERATION_ENDPOINT;
  if (!name || !model || !endpoint) throw new Error("GENERATION_PROVIDER_NOT_CONFIGURED");
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("INVALID_GENERATION_PROVIDER_ENDPOINT");
  return { name, model, async generate(input, chunks) {
    const response = await request(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", ...(env.QUIZBOX_GENERATION_API_KEY ? { Authorization: `Bearer ${env.QUIZBOX_GENERATION_API_KEY}` } : {}) },
      body: JSON.stringify({ input, chunks }) });
    if (!response.ok) throw new Error("GENERATION_PROVIDER_FAILED");
    // This is the configured adapter's Candidate[] contract, not a guessed vendor API.
    const reader = response.body?.getReader(); if (!reader) throw new Error("INVALID_GENERATION_OUTPUT");
    let length = 0; const bytes: Uint8Array[] = [];
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 1_000_000) { await reader.cancel(); throw new Error("INVALID_GENERATION_OUTPUT"); } bytes.push(part.value); }
    return JSON.parse(Buffer.concat(bytes).toString("utf8"));
  } };
}
export async function executeGenerationJob(repository: SponsorRepository, sponsor: string, competition: string, job: string, provider: CompetitionProvider) {
  const args = { competition_id: competition, job_id: job };
  const claim = await repository.call<{ token: string; provider: string; model: string }>("claim_generation", sponsor, args);
  try {
    // Reauthorization happens AFTER claiming and BEFORE any external provider call.
    const authorized = await repository.call<{ input: JobInput; actor: Actor; sources: SourceCorpus[]; chunks: Chunk[] }>("generation_sources", sponsor, { ...args, token: claim.token });
    if (provider.name !== claim.provider || provider.model !== claim.model || authorized.input.sponsorId !== sponsor || authorized.input.competitionId !== competition) throw new Error("GENERATION_PROVIDER_OR_IDENTITY_MISMATCH");
    const spec = authorized.input;
    const context: ContentContext = { scope: spec.scope === "LOCAL_MARKET" ? "local_market" : spec.scope === "MULTI_MARKET" ? "selected_multi_market" : "global", sourceMode: spec.sourceMode === "CURRICULUM_ALIGNED" ? "curriculum_aligned" : spec.sourceMode === "SPONSOR_SOURCE" ? "sponsor_document" : "hybrid", marketIds: spec.marketIds, sourceIds: spec.sourceIds };
    const input: GenerationInput = { competitionId: competition, sponsorId: sponsor, jobId: job, count: spec.count, provider: provider.name, model: provider.model, context, settings: structuredClone(spec) };
    // The authority for markets/sources is the preceding authenticated SQL resolver.
    const result = await generateCandidates(input, authorized.actor, authorized.sources, authorized.chunks, (i, chunks) => provider.generate(i, chunks));
    return await repository.call<{ status: string; candidate_ids: string[] }>("finish_generation", sponsor, { ...args, token: claim.token, candidates: result.candidates });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message) ? error.message : "GENERATION_FAILED";
    await repository.call("fail_generation", sponsor, { ...args, token: claim.token, error_code: code }).catch(() => undefined);
    throw error;
  }
}
