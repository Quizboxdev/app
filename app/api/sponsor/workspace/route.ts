import { SponsorRepository, type WorkspaceAction } from "@/lib/competition/repository";
import { boundedRequest, sponsorError, sponsorRequestClient } from "@/lib/competition/request-client";
import { configuredCompetitionProvider, executeGenerationJob } from "@/lib/competition/generation-job";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let client: Awaited<ReturnType<typeof sponsorRequestClient>> | null = null; let action = "";
  try {
    client = await sponsorRequestClient(request);
    const body = JSON.parse((await boundedRequest(request, 200_000)).toString("utf8")); action = String(body.action ?? "");
    const actions: WorkspaceAction[] = ["list_organizations", "create_organization", "organization", "edit_organization", "member", "sponsor_status", "list_drafts", "draft", "save_draft", "documents", "jobs", "queue_generation", "cancel_generation", "execute_generation", "retry_generation", "candidates", "assign_candidate", "review_queue", "review_detail", "complete_review", "bank", "include_bank", "oversight", "revise_candidate", "materialize_candidate", "publication_check", "create_snapshot", "publish", "invite", "analytics", "discover", "competition_info", "register", "start_competition", "complete_competition", "official_result", "leaderboard", "assignment_queue", "eligible_reviewers", "clone_competition", "archive_competition", "close_competition", "published_version", "eligibility_summary", "readiness", "competition_comparison"];
    if (!actions.includes(body.action) || body.sponsor !== null && body.sponsor !== undefined && typeof body.sponsor !== "string") throw new Error("INVALID_SPONSOR_ACTION");
    const repository = new SponsorRepository(client);
    let result: unknown;
    if (body.action === "execute_generation") {
      if (![body.sponsor, body.data?.competition_id, body.data?.job_id].every(value => typeof value === "string")) throw new Error("INVALID_SPONSOR_ACTION");
      result = await executeGenerationJob(repository, body.sponsor, body.data.competition_id, body.data.job_id, configuredCompetitionProvider(process.env));
    } else result = await repository.call(body.action, body.sponsor ?? null, body.data ?? {});
    return Response.json(result);
  } catch (error) {
    const operation = ({ execute_generation: "GENERATION", retry_generation: "GENERATION", publish: "PUBLICATION", create_snapshot: "PUBLICATION", complete_review: "SME_REVIEW", complete_competition: "RESULT_PERSISTENCE" } as Record<string, string>)[action];
    if (operation) await logFailure(client, operation, error);
    return sponsorError(error);
  }
}
// Best-effort operational logging; never changes the response the caller receives.
async function logFailure(client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<unknown> } | null, operation: string, error: unknown) {
  if (!client) return; const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message) ? error.message : "OPERATION_FAILED";
  try { await client.rpc("qb_operation_failure", { p_operation: operation, p_code: code }); } catch { /* ignore */ }
}

