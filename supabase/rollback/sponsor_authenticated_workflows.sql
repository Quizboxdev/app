-- Operator-only reversal; refuses to discard organization/workflow or stored files.
begin;
do $$ begin
 if exists(select 1 from quizbox_competition.sponsor_organizations)
 or exists(select 1 from storage.objects where bucket_id='competition-sources') then
  raise exception 'ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE';
 end if;
end $$;
drop policy competition_source_read on storage.objects;
drop policy competition_source_insert on storage.objects;
delete from storage.buckets where id='competition-sources';
drop function public.qb_sponsor_workspace(text,uuid,jsonb);
create or replace function quizbox_market.document_owned(p_document uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.source_documents d where d.id=p_document and (quizbox_market.is_super() or d.uploaded_by=auth.uid()
 or exists(select 1 from public.sponsor_profiles s where s.id=d.sponsor_id and s.user_id=auth.uid())
 or (d.source_kind<>'SPONSOR_SOURCE' and d.sponsor_id is null and d.tenant_id is null)
 or (d.source_kind<>'SPONSOR_SOURCE' and public.qb_is_tenant_member(d.tenant_id))));
$$;
drop function quizbox_competition.managed_source_access(uuid);
drop function quizbox_competition.storage_access(text,boolean);
drop function quizbox_competition.dispatch(text,uuid,jsonb);
drop function quizbox_competition.require_member(uuid,boolean,boolean);
revoke usage on schema quizbox_competition from authenticated;
drop index quizbox_competition.sponsor_generation_request;
alter table quizbox_competition.generation_jobs drop column execution_token,drop column request_key;
alter table quizbox_competition.documents drop column extraction_token,drop column extraction_started_at;
alter table quizbox_competition.sponsor_organizations drop column contact_email,drop column contact_phone;
alter table quizbox_competition.drafts alter column content_context_id set not null;
commit;
