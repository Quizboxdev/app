-- Rollback for 20261122120000_mock_exams_marketplace.sql: removes the mock-exam Marketplace functions and triggers.
-- KEPT on purpose: the nullable columns on mk_items and mk_purchases, the enrolments and the private assessments (they record who bought which version and what they answered), and every sale and ledger row.
-- Roll back only while flags.mock_exams is off and no exam has been sold: with the attempt guard gone, a refunded buyer could start a new attempt on a copy they already hold.
begin;
drop trigger if exists mk_purchases_mock_version on public.mk_purchases;
drop trigger if exists mk_purchases_mock_enrol on public.mk_purchases;
drop trigger if exists mk_questions_no_mock_copy on public.mk_questions;
drop trigger if exists attempts_mock_entitlement on public.attempts;
drop trigger if exists mock_exams_unlist_on_archive on public.mock_exams;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('qb_mock_listing_prepare', 'qb_mock_listing_get', 'qb_mock_listing_submit', 'qb_mock_listing_unlist',
      'qb_mock_admin_listing', 'qb_mock_listing_info', 'qb_mock_listing_kinds', 'qb_mock_my_purchases', 'qb_mock_start_purchased') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'quizbox_mock'::regnamespace and p.proname in ('entitled', 'ensure_enrolment', 'listing_json', 'purchase_version', 'purchase_enrol',
      'no_question_copy', 'attempt_guard', 'exam_archived', 'sellable', 'open_copy') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;
-- Put back the original teachers-only seller sign-up (20261043100000). Sponsors who became sellers while this was on keep their seller record.
create or replace function public.qb_mk_seller_save(p_display_name text, p_school text, p_phone text, p_method text, p_network text, p_account text, p_account_name text, p_accept_terms boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; v_changed boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and upper(p.role::text) = 'TEACHER' and lower(p.status::text) = 'active') then raise exception 'QB_TEACHERS_ONLY' using errcode = '42501'; end if;
  select * into s from public.mk_sellers where user_id = auth.uid() for update;
  if s.id is not null and s.status = 'suspended' then raise exception 'QB_SELLER_SUSPENDED' using errcode = '55000'; end if;
  if s.terms_accepted_at is null and not coalesce(p_accept_terms, false) then raise exception 'QB_TERMS_REQUIRED' using errcode = '22023'; end if;
  begin
    if s.id is null then
      insert into public.mk_sellers(user_id, display_name, school_name, phone, payout_method, payout_network, payout_account, payout_account_name, terms_accepted_at)
      values (auth.uid(), btrim(p_display_name), btrim(p_school), btrim(p_phone), p_method, btrim(p_network), regexp_replace(coalesce(p_account, ''), '[ -]', '', 'g'), btrim(p_account_name), case when coalesce(p_accept_terms, false) then now() end) returning * into s;
    else
      v_changed := s.payout_method <> p_method or s.payout_network <> btrim(coalesce(p_network, '')) or s.payout_account <> regexp_replace(coalesce(p_account, ''), '[ -]', '', 'g') or s.payout_account_name <> btrim(coalesce(p_account_name, ''));
      update public.mk_sellers set display_name = btrim(p_display_name), school_name = btrim(p_school), phone = btrim(p_phone), payout_method = p_method, payout_network = btrim(p_network),
             payout_account = regexp_replace(coalesce(p_account, ''), '[ -]', '', 'g'), payout_account_name = btrim(p_account_name),
             terms_accepted_at = coalesce(terms_accepted_at, case when coalesce(p_accept_terms, false) then now() end),
             status = case when v_changed and status = 'verified' then 'pending' else status end, verified_at = case when v_changed and status = 'verified' then null else verified_at end,
             review_note = case when v_changed and status = 'verified' then 'Payout details changed: needs checking again.' else review_note end, updated_at = now()
       where id = s.id returning * into s;
    end if;
  exception when check_violation then raise exception 'QB_SELLER_INVALID' using errcode = '22023';
  end;
  return public.qb_mk_seller_get();
end $fn$;
commit;
notify pgrst, 'reload schema';
