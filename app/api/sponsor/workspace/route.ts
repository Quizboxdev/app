import { SponsorRepository, type WorkspaceAction } from "@/lib/competition/repository";
import { boundedRequest, sponsorError, sponsorRequestClient } from "@/lib/competition/request-client";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const client = await sponsorRequestClient(request);
    const body = JSON.parse((await boundedRequest(request, 200_000)).toString("utf8"));
    const actions: WorkspaceAction[] = ["list_organizations", "create_organization", "organization", "edit_organization", "member", "sponsor_status", "list_drafts", "draft", "save_draft", "documents", "jobs", "queue_generation", "cancel_generation"];
    if (!actions.includes(body.action) || body.sponsor !== null && body.sponsor !== undefined && typeof body.sponsor !== "string") throw new Error("INVALID_SPONSOR_ACTION");
    const result = await new SponsorRepository(client).call(body.action, body.sponsor ?? null, body.data ?? {});
    return Response.json(result);
  } catch (error) { return sponsorError(error); }
}
