import { SponsorRepository, type WorkspaceAction } from "@/lib/competition/repository";
import { boundedRequest, sponsorError, sponsorRequestClient } from "@/lib/competition/request-client";
import { configuredCompetitionProvider, executeGenerationJob } from "@/lib/competition/generation-job";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const client = await sponsorRequestClient(request);
    const body = JSON.parse((await boundedRequest(request, 200_000)).toString("utf8"));
    const actions: WorkspaceAction[] = ["list_organizations", "create_organization", "organization", "edit_organization", "member", "sponsor_status", "list_drafts", "draft", "save_draft", "documents", "jobs", "queue_generation", "cancel_generation", "execute_generation", "retry_generation", "candidates", "assign_candidate", "review_queue", "review_detail", "complete_review", "bank", "include_bank", "oversight"];
    if (!actions.includes(body.action) || body.sponsor !== null && body.sponsor !== undefined && typeof body.sponsor !== "string") throw new Error("INVALID_SPONSOR_ACTION");
    const repository = new SponsorRepository(client);
    let result: unknown;
    if (body.action === "execute_generation") {
      if (![body.sponsor, body.data?.competition_id, body.data?.job_id].every(value => typeof value === "string")) throw new Error("INVALID_SPONSOR_ACTION");
      result = await executeGenerationJob(repository, body.sponsor, body.data.competition_id, body.data.job_id, configuredCompetitionProvider(process.env));
    } else result = await repository.call(body.action, body.sponsor ?? null, body.data ?? {});
    return Response.json(result);
  } catch (error) { return sponsorError(error); }
}
