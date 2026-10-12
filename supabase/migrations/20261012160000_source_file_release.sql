begin;

-- Release the file attached to a source row that has NOT been approved, so the correct official file can be supplied in its place.
-- Only NEEDS_REVIEW and REJECTED rows can be released: an approved or active source is never touched here (it carries a rights
-- attestation and may already be cited by loaded questions). The previous document is kept for the record, marked rejected, and the
-- registry row returns to IMPORTED so "supply the PDF yourself" (qb_source_claim_file) applies to it again.
create or replace function public.qb_source_release_file(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g quizbox_sources.registry; prev_status text; prev_sha text; prev_doc uuid;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into g from quizbox_sources.registry where id = p_id for update;
  if g.id is null or not quizbox_market.market_allowed(g.market_id) then raise exception 'QB_SOURCE_NOT_FOUND' using errcode = '42501'; end if;
  if g.status not in ('NEEDS_REVIEW', 'REJECTED') or g.source_document_id is null then raise exception 'QB_SOURCE_INVALID_TRANSITION'; end if;
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'QB_REVIEW_NOTE_REQUIRED'; end if;
  prev_status := g.status; prev_sha := g.sha256; prev_doc := g.source_document_id;
  update public.source_documents
     set validation_status = 'rejected',
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('released_at', now(), 'released_note', left(trim(p_note), 500), 'released_registry_id', g.id)
   where id = prev_doc and validation_status <> 'approved';
  update quizbox_sources.registry
     set status = 'IMPORTED', sha256 = null, byte_size = null, storage_path = null, pages = null, source_document_id = null,
         claim_token = null, claimed_by = null, claimed_at = null, fetch_attempts = 0, last_error = null, review_note = left(trim(p_note), 1000)
   where id = g.id returning * into g;
  perform quizbox_sources.log(g.id, g.package_id, g.job_id, 'FILE_RELEASED',
    jsonb_build_object('previous_status', prev_status, 'previous_sha256', prev_sha, 'previous_document', prev_doc, 'note', left(trim(p_note), 500)));
  return jsonb_build_object('id', g.id, 'status', g.status, 'title', g.title, 'previous_sha256', prev_sha);
end $$;

revoke all on function public.qb_source_release_file(uuid, text) from public, anon;
grant execute on function public.qb_source_release_file(uuid, text) to authenticated;

commit;
