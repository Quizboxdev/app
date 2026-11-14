-- Rollback for 20261072100000_batch_preview_fast.sql: puts the original (slow, full-scan) qb_owner_batch_preview back and drops the index and helper.
begin;
drop index if exists public.questions_ql_batches_gin;
create or replace function public.qb_owner_batch_preview(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare b public.question_load_batches; tag text; total integer; by_state jsonb; valid integer; avail integer; sample jsonb;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  tag := 'source:QL:' || b.id || ':%';
  select count(*)::integer into total from public.questions q cross join lateral unnest(q.tags) t where t like tag;
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into by_state from (
    select q.validation_status || '/' || q.status::text as k, count(*) as n from public.questions q
     where exists (select 1 from unnest(q.tags) t where t like tag) group by 1) s;
  select count(*)::integer into valid from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag)
     and q.validation_status = 'review' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb;
  select count(*)::integer into avail from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag) and public.qb_question_is_available(q);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'question', question_text, 'a', option_a, 'b', option_b, 'c', option_c, 'd', option_d, 'correct', correct_answer, 'difficulty', difficulty_label)), '[]'::jsonb)
    into sample from (select * from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag) order by random() limit 20) s;
  return jsonb_build_object('batch_id', b.id, 'file', b.file_name, 'batch_status', b.status, 'questions_found', total, 'by_state', by_state,
    'would_approve', valid, 'already_available_to_learners', avail,
    'min_sample_required', 20, 'sample', sample);
end $fn$;
drop function if exists public.qb_ql_batches(text[]);
commit;
