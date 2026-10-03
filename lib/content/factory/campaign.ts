import { generateQuestions, type QuestionProvider, type ResolvedGenerationSources } from "./generation";
import { similarity } from "./duplicates";
import type { Candidate, CurriculumNode, GenerationSpec } from "./contract";

// Server-side Content Factory runner. It reuses the curriculum generation engine (generateQuestions + the
// authenticated source resolver) and the governed ingest core behind qb_content_factory('finish_job').
export type FactoryRpc = <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
export type ClaimedJob = { job_id: string; token: string; provider: string; model: string; spec: GenerationSpec; node: CurriculumNode; existing: Array<{ id: string; text: string }> };
export type JobOutcome = { job_id: string; status: string; valid?: number; rejected?: number; duplicates?: number; error?: string };

export const NEAR_DUPLICATE_THRESHOLD = 0.85;

// The same configured adapter endpoint as the sponsor engine; the curriculum contract is { kind, prompt, spec } -> Candidate[].
export function configuredFactoryProvider(env: Record<string, string | undefined>, request: typeof fetch = fetch): QuestionProvider {
  const name = env.QUIZBOX_GENERATION_PROVIDER, model = env.QUIZBOX_GENERATION_MODEL, endpoint = env.QUIZBOX_GENERATION_ENDPOINT;
  if (!name || !model || !endpoint) throw new Error("GENERATION_PROVIDER_NOT_CONFIGURED");
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("INVALID_GENERATION_PROVIDER_ENDPOINT");
  return { name, model, async generate(prompt, spec) {
    const response = await request(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000),
      headers: { "Content-Type": "application/json", ...(env.QUIZBOX_GENERATION_API_KEY ? { Authorization: `Bearer ${env.QUIZBOX_GENERATION_API_KEY}` } : {}) },
      body: JSON.stringify({ kind: "curriculum", prompt, spec }) });
    if (!response.ok) throw new Error("GENERATION_PROVIDER_FAILED");
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error("INVALID_PROVIDER_OUTPUT");
    return text;
  } };
}

// Near-duplicate flags against existing indicator questions and earlier candidates in the same batch.
export function nearDuplicates(candidates: Candidate[], existing: Array<{ id: string; text: string }>, threshold = NEAR_DUPLICATE_THRESHOLD) {
  const flags: Array<{ index: number; question_id: string; similarity: number }> = [];
  candidates.forEach((candidate, index) => {
    let best: { id: string; score: number } | null = null;
    for (const other of existing) { const score = similarity(candidate.question_text, other.text); if (score >= threshold && (!best || score > best.score)) best = { id: other.id, score }; }
    if (best) flags.push({ index, question_id: best.id, similarity: Math.round(best.score * 100) / 100 });
  });
  return flags;
}

const code = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "GENERATION_FAILED";

// One bounded execution: claims at most the campaign's max_jobs_per_execution and runs them sequentially.
export async function executeCampaignJobs(rpc: FactoryRpc, campaignId: string, provider: QuestionProvider): Promise<{ claimed: number; outcomes: JobOutcome[] }> {
  const jobs = await rpc<ClaimedJob[]>("qb_content_factory", { p_action: "claim_jobs", p_data: { campaign_id: campaignId } });
  const outcomes: JobOutcome[] = [];
  for (const job of jobs) {
    const args = { campaign_id: campaignId, job_id: job.job_id, token: job.token };
    try {
      if (job.provider !== provider.name || job.model !== provider.model) throw new Error("GENERATION_PROVIDER_OR_IDENTITY_MISMATCH");
      // Reauthorize market/curriculum/source access before any provider call.
      const resolved = await rpc<ResolvedGenerationSources>("qb_resolve_generation_sources", { p_spec: job.spec });
      const candidates = await generateQuestions(job.spec, job.node, provider, resolved);
      const result = await rpc<JobOutcome>("qb_content_factory", { p_action: "finish_job", p_data: { ...args, provider: provider.name, model: provider.model, candidates, near_duplicates: nearDuplicates(candidates, job.existing) } });
      outcomes.push(result);
    } catch (error) {
      const failure = code(error);
      await rpc("qb_content_factory", { p_action: "fail_job", p_data: { ...args, error_code: failure } }).catch(() => undefined);
      outcomes.push({ job_id: job.job_id, status: "FAILED", error: failure });
    }
  }
  return { claimed: jobs.length, outcomes };
}
