-- Rollback for 20261036100000_policy_cms.sql. Removes the policy section, the company details and the acceptance records. The public pages fall back to their built-in text.
-- Acceptance records are legal evidence: export them first (select * from public.policy_acceptances) if any people have accepted.
begin;
drop function if exists public.qb_policy_record_for_managed(uuid, uuid);
drop function if exists public.qb_policy_my_acceptances();
drop function if exists public.qb_policy_accept(uuid[]);
drop function if exists public.qb_policy_pending();
drop function if exists public.qb_company_detail_save(text, text);
drop function if exists public.qb_company_details();
drop function if exists public.qb_policy_document_save(text, text, boolean, boolean, integer);
drop function if exists public.qb_policy_publish(uuid);
drop function if exists public.qb_policy_draft_discard(uuid);
drop function if exists public.qb_policy_draft_save(uuid, text, text, timestamptz, boolean);
drop function if exists public.qb_policy_admin_get(uuid);
drop function if exists public.qb_policy_admin_list();
drop function if exists public.qb_policy_public(text, integer);
drop function if exists public.qb_policy_resolve(text);
drop function if exists public.qb_policy_missing(text);
drop trigger if exists qb_policy_version_guard on public.policy_versions;
drop function if exists public.qb_trg_policy_version_guard();
drop table if exists public.policy_acceptances;
drop table if exists public.policy_versions;
drop table if exists public.policy_documents;
drop table if exists public.company_details;
commit;
notify pgrst, 'reload schema';
