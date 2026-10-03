import type { SupabaseClient } from "@supabase/supabase-js";
import type { Chunk } from "./lifecycle";

export type Organization = { sponsor_id: string; organization_name: string; organization_type: string; market_id: string; country_id: string; contact_email?: string; contact_name?: string; contact_phone?: string; website?: string; status: string; role: string; members?: Array<{ user_id: string; role: string; active: boolean }> };
export type DraftRecord = { competition_id: string; sponsor_id: string; revision: number; configuration: Record<string, unknown>; content_context_id: string | null };
export type DocumentRecord = { id: string; title: string; ingestion_status: string; approval_status: string; error_code: string | null };
export type SourceDetail = { id: string; bucket: string; path: string; mime_type: string; checksum: string; chunks: unknown[] };
export type WorkspaceAction = "list_organizations" | "create_organization" | "organization" | "edit_organization" | "member" | "sponsor_status" | "list_drafts" | "save_draft" | "draft" | "documents" | "register_source" | "source_detail" | "claim_extraction" | "finish_extraction" | "fail_extraction" | "fail_upload" | "retry_upload" | "jobs" | "queue_generation" | "claim_generation" | "generation_sources" | "finish_generation" | "fail_generation" | "cancel_generation" | "retry_generation" | "execute_generation" | "candidates" | "assign_candidate" | "review_queue" | "review_detail" | "complete_review" | "bank" | "include_bank" | "oversight" | "revise_candidate" | "materialize_candidate" | "publication_check" | "create_snapshot" | "publish" | "invite" | "analytics" | "discover" | "competition_info" | "register" | "start_competition" | "complete_competition" | "official_result" | "leaderboard" | "assignment_queue" | "eligible_reviewers" | "clone_competition" | "archive_competition" | "close_competition" | "published_version" | "eligibility_summary" | "readiness" | "competition_comparison";

export class SponsorRepository {
  constructor(private readonly client: Pick<SupabaseClient, "rpc">) {}
  async call<T>(action: WorkspaceAction, sponsor: string | null = null, data: Record<string, unknown> = {}): Promise<T> {
    const result = await this.client.rpc("qb_sponsor_workspace", { p_action: action, p_sponsor: sponsor, p_data: data });
    if (result.error) throw new Error(result.error.message);
    if (result.data === null) throw new Error("EMPTY_SPONSOR_RESPONSE");
    return result.data as T;
  }
  organizations() { return this.call<Organization[]>("list_organizations"); }
  organization(sponsor: string) { return this.call<Organization>("organization", sponsor); }
  createOrganization(data: Record<string, unknown>) { return this.call<{ sponsor_id: string }>("create_organization", null, data); }
  editOrganization(sponsor: string, data: Record<string, unknown>) { return this.call("edit_organization", sponsor, data); }
  member(sponsor: string, user: string, role: string, active: boolean) { return this.call("member", sponsor, { user_id: user, role, active }); }
  drafts(sponsor: string) { return this.call<DraftRecord[]>("list_drafts", sponsor); }
  draft(sponsor: string, competition: string) { return this.call<DraftRecord>("draft", sponsor, { competition_id: competition }); }
  saveDraft(sponsor: string, configuration: Record<string, unknown>, previous?: DraftRecord) { return this.call<DraftRecord>("save_draft", sponsor, { competition_id: previous?.competition_id ?? null, revision: previous?.revision ?? null, configuration }); }
  documents(sponsor: string, competition: string) { return this.call<DocumentRecord[]>("documents", sponsor, { competition_id: competition }); }
  source(sponsor: string, competition: string, document: string) { return this.call<SourceDetail>("source_detail", sponsor, { competition_id: competition, document_id: document }); }
  registerSource(sponsor: string, competition: string, metadata: Record<string, unknown>) { return this.call<{ id: string; bucket: string; path: string }>("register_source", sponsor, { ...metadata, competition_id: competition }); }
  claimExtraction(sponsor: string, competition: string, document: string) { return this.call<{ token: string }>("claim_extraction", sponsor, { competition_id: competition, document_id: document }); }
  finishExtraction(sponsor: string, competition: string, document: string, token: string, chunks: Array<Chunk & { checksum: string }>) { return this.call("finish_extraction", sponsor, { competition_id: competition, document_id: document, token, chunks }); }
  failExtraction(sponsor: string, competition: string, document: string, token: string) { return this.call("fail_extraction", sponsor, { competition_id: competition, document_id: document, token }); }
}
