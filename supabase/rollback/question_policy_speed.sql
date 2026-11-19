-- Rollback for 20261119100000_question_policy_speed.sql: puts back the original per-row rules on public.questions (same meaning, slower on a large table).
begin;
drop policy if exists market_question_access on public.questions;
create policy market_question_access on public.questions as restrictive for all to authenticated using (quizbox_market.question_allowed(id)) with check (quizbox_market.question_allowed(id));
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'questions' and policyname = 'questions_admin_all') then
    alter policy questions_admin_all on public.questions
      using (public.qb_current_role() = any (array['ADMIN'::text, 'OWNER'::text]))
      with check (public.qb_current_role() = any (array['ADMIN'::text, 'OWNER'::text]));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'questions' and policyname = 'questions_authorized_teacher_read') then
    alter policy questions_authorized_teacher_read on public.questions
      using (upper(public.qb_current_role()) = 'TEACHER' and public.qb_question_is_available(questions) and (tenant_id is null or tenant_id = public.qb_public_tenant_id() or public.qb_is_tenant_member(tenant_id)));
  end if;
end $$;
drop function if exists quizbox_market.question_row_allowed(uuid, uuid, uuid, uuid[], text, text[]);
drop function if exists quizbox_market.question_doc_pairs();
drop index if exists public.questions_created_at_idx;
commit;
notify pgrst, 'reload schema';
