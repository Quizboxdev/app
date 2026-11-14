-- Approve Batches, Review sample: the preview took about 32 s on 36,718 questions and the screen stayed on "Drawing a random sample...". It scanned the whole questions table five times for a tag pattern.
-- Fix: an immutable helper that lists the load batches named in a question's tags, a GIN index on it, and a preview that reads the batch ONCE through the index. Same result, same fields.
-- Additive and idempotent (one function, one index, one replaced function). Rollback: supabase/rollback/batch_preview_fast.sql.
begin;

create or replace function public.qb_ql_batches(p_tags text[]) returns uuid[] language sql immutable parallel safe set search_path = '' as $fn$
  select coalesce(array_agg(distinct substring(t from '^source:QL:([0-9a-f-]{36}):')::uuid), '{}'::uuid[]) from unnest(p_tags) t where t like 'source:QL:%'
$fn$;

create index if not exists questions_ql_batches_gin on public.questions using gin (public.qb_ql_batches(tags));

create or replace function public.qb_owner_batch_preview(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare b public.question_load_batches; ids uuid[]; total integer; by_state jsonb; valid integer; avail integer; sample jsonb;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  select coalesce(array_agg(q.id), '{}'::uuid[]) into ids from public.questions q where public.qb_ql_batches(q.tags) @> array[b.id];
  total := cardinality(ids);
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into by_state from (
    select q.validation_status || '/' || q.status::text as k, count(*) as n from public.questions q where q.id = any (ids) group by 1) s;
  select count(*)::integer into valid from public.questions q where q.id = any (ids)
     and q.validation_status = 'review' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb;
  select count(*)::integer into avail from public.questions q where q.id = any (ids) and public.qb_question_is_available(q);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'question', question_text, 'a', option_a, 'b', option_b, 'c', option_c, 'd', option_d, 'correct', correct_answer, 'difficulty', difficulty_label)), '[]'::jsonb)
    into sample from (select * from public.questions q where q.id = any (ids) order by random() limit 20) s;
  return jsonb_build_object('batch_id', b.id, 'file', b.file_name, 'batch_status', b.status, 'questions_found', total, 'by_state', by_state,
    'would_approve', valid, 'already_available_to_learners', avail,
    'min_sample_required', 20, 'sample', sample);
end $fn$;

commit;
