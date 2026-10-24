-- Becoming a seller (teachers only). Changing where the money goes sends a verified seller back to "pending" so staff look at it again.
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

create or replace function public.qb_mk_slugify(p_title text) returns text language plpgsql volatile security definer set search_path = '' as $fn$
declare base text := trim(both '-' from regexp_replace(lower(coalesce(p_title, 'set')), '[^a-z0-9]+', '-', 'g')); cand text;
begin
  base := left(coalesce(nullif(base, ''), 'set'), 50);
  loop cand := base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5); exit when not exists (select 1 from public.mk_items where slug = cand); end loop;
  return cand;
end $fn$;
revoke all on function public.qb_mk_slugify(text) from public, anon, authenticated;

create or replace function public.qb_mk_item_save(p_id uuid, p_title text, p_description text, p_subject text, p_grade text, p_term text, p_school text, p_price_minor integer) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; it public.mk_items;
begin
  s := public.qb_mk_my_seller();
  if s.status = 'suspended' then raise exception 'QB_SELLER_SUSPENDED' using errcode = '55000'; end if;
  if p_price_minor is null or p_price_minor % 100 <> 0 or p_price_minor < public.qb_mk_num('marketplace.min_price_minor', 500) or p_price_minor > public.qb_mk_num('marketplace.max_price_minor', 20000) then raise exception 'QB_PRICE_INVALID' using errcode = '22023'; end if;
  begin
    if p_id is null then
      insert into public.mk_items(seller_id, slug, title, description, subject, grade, term, school_name, price_minor)
      values (s.id, public.qb_mk_slugify(p_title), btrim(p_title), btrim(coalesce(p_description, '')), btrim(p_subject), btrim(p_grade), nullif(btrim(coalesce(p_term, '')), ''), btrim(p_school), p_price_minor) returning * into it;
    else
      select * into it from public.mk_items where id = p_id and seller_id = s.id for update;
      if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
      if it.status not in ('draft', 'rejected', 'unlisted') then raise exception 'QB_ITEM_LOCKED' using errcode = '55000'; end if;
      update public.mk_items set title = btrim(p_title), description = btrim(coalesce(p_description, '')), subject = btrim(p_subject), grade = btrim(p_grade), term = nullif(btrim(coalesce(p_term, '')), ''),
             school_name = btrim(p_school), price_minor = p_price_minor, status = 'draft', updated_at = now() where id = it.id returning * into it;
    end if;
  exception when check_violation then raise exception 'QB_ITEM_INVALID' using errcode = '22023';
  end;
  return to_jsonb(it);
end $fn$;

-- Replace the questions of a draft set. Each needs 2 to 5 distinct options and one correct answer; the same question may not appear twice.
create or replace function public.qb_mk_item_questions_set(p_item uuid, p_questions jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; it public.mk_items; q jsonb; i integer := 0; n integer; seen text[] := '{}'; norm text; opts jsonb;
begin
  s := public.qb_mk_my_seller();
  select * into it from public.mk_items where id = p_item and seller_id = s.id for update;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if it.status not in ('draft', 'rejected', 'unlisted') then raise exception 'QB_ITEM_LOCKED' using errcode = '55000'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > public.qb_mk_num('marketplace.max_questions', 200) then raise exception 'QB_QUESTIONS_INVALID' using errcode = '22023'; end if;
  delete from public.mk_questions where item_id = it.id;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    if jsonb_typeof(q->'options') <> 'array' then raise exception 'QB_QUESTIONS_INVALID' using errcode = '22023'; end if;
    opts := q->'options'; n := jsonb_array_length(opts);
    if n not between 2 and 5 or (q->>'correct_index') !~ '^[0-4]$' or (q->>'correct_index')::int >= n
       or (select count(distinct lower(btrim(o))) from jsonb_array_elements_text(opts) o) <> n or exists (select 1 from jsonb_array_elements_text(opts) o where length(btrim(o)) not between 1 and 200) then raise exception 'QB_QUESTIONS_INVALID' using errcode = '22023'; end if;
    norm := lower(regexp_replace(coalesce(q->>'question_text', ''), '[^a-zA-Z0-9]+', ' ', 'g'));
    if norm = any (seen) then raise exception 'QB_QUESTIONS_DUPLICATE' using errcode = '22023'; end if;
    seen := seen || norm;
    begin
      insert into public.mk_questions(item_id, position, question_text, options, correct_index, explanation)
      values (it.id, i, btrim(q->>'question_text'), opts, (q->>'correct_index')::int, nullif(btrim(coalesce(q->>'explanation', '')), ''));
    exception when check_violation then raise exception 'QB_QUESTIONS_INVALID' using errcode = '22023';
    end;
  end loop;
  update public.mk_items set question_count = i, status = 'draft', updated_at = now() where id = it.id;
  return jsonb_build_object('ok', true, 'count', i);
end $fn$;
