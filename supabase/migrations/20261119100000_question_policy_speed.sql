-- The question table's access rules checked every row one at a time: the market rule re-read the user's context and every source document for each of 75,000 rows
-- (about 2 to 3 ms a row), so Question Banks, Editorial Review and Curriculum Coverage timed out. This migration keeps the rules' meaning and changes how they are evaluated:
--  1. market_question_access: the user's context and the allowed (curriculum, source document) pairs are worked out ONCE per statement; each row then only checks its own pairs.
--     Rows that need the full check (sponsor candidates, no source documents, release fixtures, a context that names source documents) still use quizbox_market.question_allowed unchanged.
--  2. questions_admin_all and questions_authorized_teacher_read: the user's role is read once per statement instead of once per row.
--  3. An index on created_at so a page of the newest questions stops after one page instead of checking every row.
-- No rule is widened: a row is visible exactly when it was before.
begin;

-- The pairs "curriculum:document" the signed-in user may see through the default (curriculum-aligned) context.
--   null  = the context names source documents, so rows must use the full per-row check
--   empty = nothing is allowed (the context is denied)
create or replace function quizbox_market.question_doc_pairs() returns text[] language plpgsql stable security definer set search_path = '' as $fn$
declare c jsonb;
begin
  begin
    c := quizbox_market.resolve_context();
  exception when sqlstate '42501' then
    return array[]::text[];
  end;
  if jsonb_array_length(c->'source_document_ids') <> 0 then return null; end if;
  return coalesce((
    select array_agg(d.curriculum_id::text || ':' || d.id::text)
      from public.source_documents d
     where d.validation_status = 'approved' and d.source_kind = 'CURRICULUM' and d.curriculum_id is not null
       and quizbox_market.document_owned(d.id)
       and quizbox_market.curriculum_allowed(d.curriculum_id, c)
  ), array[]::text[]);
end $fn$;

-- One row's answer. Same meaning as quizbox_market.question_allowed for curriculum questions that list source documents; everything else is handed to it.
create or replace function quizbox_market.question_row_allowed(p_id uuid, p_origin uuid, p_curriculum uuid, p_docs uuid[], p_source_type text, p_pairs text[]) returns boolean language sql stable set search_path = '' as $fn$
  select case
    when p_pairs is not null and p_origin is null and cardinality(p_docs) > 0 and p_source_type is distinct from 'DEV_ACCEPTANCE_FIXTURE'
      then not exists (select 1 from unnest(p_docs) s where not coalesce((p_curriculum::text || ':' || s::text) = any (p_pairs), false))
    else quizbox_market.question_allowed(p_id)
  end
$fn$;

revoke all on function quizbox_market.question_doc_pairs() from public, anon;
revoke all on function quizbox_market.question_row_allowed(uuid, uuid, uuid, uuid[], text, text[]) from public, anon;
grant execute on function quizbox_market.question_doc_pairs() to authenticated;
grant execute on function quizbox_market.question_row_allowed(uuid, uuid, uuid, uuid[], text, text[]) to authenticated;

drop policy if exists market_question_access on public.questions;
create policy market_question_access on public.questions as restrictive for all to authenticated
  using (quizbox_market.question_row_allowed(id, origin_candidate_id, curriculum_id, source_document_ids, source_type::text, (select quizbox_market.question_doc_pairs())))
  with check (quizbox_market.question_row_allowed(id, origin_candidate_id, curriculum_id, source_document_ids, source_type::text, (select quizbox_market.question_doc_pairs())));

do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'questions' and policyname = 'questions_admin_all') then
    alter policy questions_admin_all on public.questions
      using ((select public.qb_current_role()) = any (array['ADMIN'::text, 'OWNER'::text]))
      with check ((select public.qb_current_role()) = any (array['ADMIN'::text, 'OWNER'::text]));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'questions' and policyname = 'questions_authorized_teacher_read') then
    alter policy questions_authorized_teacher_read on public.questions
      using ((select upper(public.qb_current_role())) = 'TEACHER' and public.qb_question_is_available(questions) and (tenant_id is null or tenant_id = (select public.qb_public_tenant_id()) or public.qb_is_tenant_member(tenant_id)));
  end if;
end $$;

create index if not exists questions_created_at_idx on public.questions (created_at desc, id);

commit;
notify pgrst, 'reload schema';
