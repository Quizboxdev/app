begin;

-- Supply a source file by hand. The server fetch cannot always reach an official host (a slow or geo-limited government site), so a Super Admin
-- may attach the official PDF they downloaded to ONE registry row. This only claims that row for the caller: the file is then recorded by the
-- existing finish_fetch step (fingerprint, storage path, text) and lands in NEEDS_REVIEW, where the normal human review, rights attestation
-- and activation apply unchanged. Nothing is approved here.
create or replace function public.qb_source_claim_file(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g quizbox_sources.registry;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into g from quizbox_sources.registry where id = p_id for update;
  if g.id is null or not quizbox_market.market_allowed(g.market_id) then raise exception 'QB_SOURCE_NOT_FOUND' using errcode = '42501'; end if;
  if g.status <> 'IMPORTED' or g.source_document_id is not null or g.verification_status <> 'VERIFIED' then raise exception 'QB_SOURCE_INVALID_TRANSITION'; end if;
  update quizbox_sources.registry set claim_token = gen_random_uuid(), claimed_by = auth.uid(), claimed_at = now() where id = g.id returning * into g;
  perform quizbox_sources.log(g.id, g.package_id, g.job_id, 'FILE_SUPPLY_CLAIMED', jsonb_build_object('reason', 'administrator supplies the official file'));
  return jsonb_build_object('id', g.id, 'token', g.claim_token, 'url', g.canonical_url, 'title', g.title, 'market_id', g.market_id);
end $$;

revoke all on function public.qb_source_claim_file(uuid) from public, anon;
grant execute on function public.qb_source_claim_file(uuid) to authenticated;

commit;
