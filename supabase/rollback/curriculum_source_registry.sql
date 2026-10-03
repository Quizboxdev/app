-- Reverse 20261006100000 (curriculum source registry). Refuses once any package has been imported; fetched files,
-- source documents and approvals are never removed here.
begin;
do $$ begin if exists(select 1 from quizbox_sources.packages) then raise exception 'CURRICULUM_SOURCE_ROLLBACK_REFUSED_DATA_EXISTS'; end if; end $$;
drop policy if exists curriculum_sources_super_insert on storage.objects;
drop policy if exists curriculum_sources_super_read on storage.objects;
delete from storage.buckets where id='curriculum-sources' and not exists(select 1 from storage.objects where bucket_id='curriculum-sources');
drop function if exists public.qb_content_factory_sources(uuid,uuid);
drop function if exists public.qb_curriculum_sources(text,jsonb);
drop schema quizbox_sources cascade;
alter table public.curriculum_authorities drop column if exists official_domains;
-- Restore the pre-registry campaign validation and readiness by re-running their definitions from
-- 20261005100000_content_factory.sql and 20261003100000_multi_market_platform.sql respectively.
commit;
