-- Becoming a seller: verified teachers as before, and (only while flags.mock_exams is on) verified ORGANIZATION sponsors. Everything else in this function is the original from 20261043100000
-- (same terms, same payout checks, same re-verification when payout details change). Rollback restores the original.
create or replace function public.qb_mk_seller_save(p_display_name text, p_school text, p_phone text, p_method text, p_network text, p_account text, p_account_name text, p_accept_terms boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; v_changed boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not (exists (select 1 from public.profiles p where p.id = auth.uid() and upper(p.role::text) = 'TEACHER' and lower(p.status::text) = 'active')
          or (coalesce(quizbox_core.flag('flags.mock_exams'), false) and exists (select 1 from public.profiles p join public.sponsor_profiles sp on sp.user_id = p.id
               where p.id = auth.uid() and upper(p.role::text) = 'SPONSOR' and lower(p.status::text) = 'active' and upper(coalesce(sp.sponsor_type, 'ORGANIZATION')) = 'ORGANIZATION'
                 and upper(coalesce(sp.verification_status, '')) = 'VERIFIED' and lower(coalesce(sp.status::text, 'active')) = 'active'))) then raise exception 'QB_TEACHERS_ONLY' using errcode = '42501'; end if;
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

-- Creates or updates the draft listing for the exam's current version. Nothing is on sale yet: the seller reviews the returned listing (price, split, access terms), then submits it.
create or replace function public.qb_mock_listing_prepare(p_exam uuid, p_price_minor integer, p_description text default null, p_term text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.sellable(p_exam, true); s public.mk_sellers := public.qb_mk_my_seller(); v public.mock_exam_versions; it public.mk_items; saved jsonb; v_subjects integer; v_subject text; v_stale integer;
begin
  select * into v from public.mock_exam_versions where id = e.current_version_id;
  v_stale := quizbox_mock.stale(v.id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since version % was published', v_stale, v.version_no using errcode = '55000'; end if;
  select count(distinct x ->> 'subject_code')::integer, min(x ->> 'subject_label') into v_subjects, v_subject from jsonb_array_elements(v.rounds) x;
  select * into it from public.mk_items where mock_exam_id = e.id;
  saved := public.qb_mk_item_save(it.id, v.title, coalesce(nullif(btrim(coalesce(p_description, '')), ''), v.description), case when v_subjects = 1 then v_subject else 'Multiple subjects' end, v.target_grade, nullif(btrim(coalesce(p_term, '')), ''), s.school_name, p_price_minor);
  update public.mk_items set mock_exam_id = e.id, mock_version_id = v.id, question_count = v.question_count where id = (saved ->> 'id')::uuid returning * into it;
  perform quizbox_core.audit('mock_exam.listing_prepare', 'mock_exams', e.id, jsonb_build_object('item', it.id, 'version', v.version_no, 'price_minor', p_price_minor));
  return quizbox_mock.listing_json(it);
end $fn$;

create or replace function public.qb_mock_listing_get(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); it public.mk_items;
begin
  select * into it from public.mk_items where mock_exam_id = e.id;
  if it.id is null then return null; end if;
  return quizbox_mock.listing_json(it) || jsonb_build_object('sales', (select count(*) from public.mk_purchases p where p.item_id = it.id and p.status = 'active'));
end $fn$;

create or replace function public.qb_mock_listing_submit(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.sellable(p_exam, true); it public.mk_items; v_stale integer;
begin
  select * into it from public.mk_items where mock_exam_id = e.id for update;
  if it.id is null then raise exception 'QB_MOCK_NOT_LISTED' using errcode = 'P0002'; end if;
  v_stale := quizbox_mock.stale(it.mock_version_id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since the listed version was published', v_stale using errcode = '55000'; end if;
  perform public.qb_mk_item_submit(it.id);
  perform quizbox_core.audit('mock_exam.listing_submit', 'mock_exams', e.id, jsonb_build_object('item', it.id));
  select * into it from public.mk_items where id = it.id;
  return quizbox_mock.listing_json(it);
end $fn$;

create or replace function public.qb_mock_listing_unlist(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); it public.mk_items;
begin
  select * into it from public.mk_items where mock_exam_id = e.id;
  if it.id is null then raise exception 'QB_MOCK_NOT_LISTED' using errcode = 'P0002'; end if;
  perform public.qb_mk_item_unlist(it.id);
  select * into it from public.mk_items where id = it.id;
  return quizbox_mock.listing_json(it);
end $fn$;
