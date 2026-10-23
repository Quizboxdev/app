-- The QuizBox Marketplace: verified teachers sell end-of-term question sets; buyers get a set for 90 days; each sale is split 60% teacher / 40% QuizBox and recorded; teachers request payouts.
-- (A clean module beside the older marketplace_* tables, which are left as they are.)
--   mk_sellers     a verified teacher: display name, school, payout destination (never shown to buyers), status pending / verified / suspended
--   mk_items       a question set: title, subject, class, term, SCHOOL (the source shown on the listing), whole-cedi price, status draft / submitted / approved / rejected / unlisted
--   mk_questions   the questions of a set (answers are given only to the person who bought it, the seller and staff)
--   mk_purchases   one row per sale, with the price, the 60/40 split and the 90-day expiry copied in, so later changes never rewrite history
--   mk_ledger      the seller's money: sale (+60%, available after a 7-day hold), reversal on a refund, payout reserved / released, adjustments
--   mk_payouts     payout requests: the teacher approves a breakdown (sales less QuizBox's 40%), finance pays by hand within 24 hours on working days and marks it paid
-- Settings (Admin): flags.marketplace (off), marketplace.seller_share_percent 60, hold_days 7, access_days 90, min_price_minor 500, max_price_minor 20000, min_payout_minor 2000, min_questions 10, max_questions 200.
-- Payment arrives through the normal Paystack checkout (the Coins pipeline), then qb_mk_fulfil_purchase records the sale. Money functions are service-only; the tables are closed to every browser.
-- Additive and idempotent. Rollback: supabase/rollback/marketplace.sql.
begin;

insert into public.platform_settings(key, value, description)
select v.key, v.value::jsonb, v.descr from (values
  ('flags.marketplace', 'false', 'The Marketplace is open'),
  ('marketplace.seller_share_percent', '60', 'Percent of each sale that goes to the teacher (the rest is QuizBox)'),
  ('marketplace.hold_days', '7', 'Days a sale is held before the teacher can request it (the refund window)'),
  ('marketplace.access_days', '90', 'Days a buyer keeps a purchased set'),
  ('marketplace.min_price_minor', '500', 'Lowest price of a set, in pesewas (GHS 5, the smallest online payment)'),
  ('marketplace.max_price_minor', '20000', 'Highest price of a set, in pesewas (GHS 200)'),
  ('marketplace.min_payout_minor', '2000', 'Smallest payout a teacher can request, in pesewas'),
  ('marketplace.min_questions', '10', 'Fewest questions in a set'),
  ('marketplace.max_questions', '200', 'Most questions in a set')) as v(key, value, descr)
where not exists (select 1 from public.platform_settings p where p.key = v.key and p.scope_type = 'global');

create table if not exists public.mk_sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 2 and 80),
  school_name text not null check (length(btrim(school_name)) between 2 and 120),
  phone text not null check (phone ~ '^[0-9+ ]{8,20}$'),
  payout_method text not null check (payout_method in ('mobile_money', 'bank')),
  payout_network text not null check (length(btrim(payout_network)) between 2 and 40),
  payout_account text not null check (payout_account ~ '^[0-9]{6,30}$'),
  payout_account_name text not null check (length(btrim(payout_account_name)) between 2 and 80),
  status text not null default 'pending' check (status in ('pending', 'verified', 'suspended')),
  verified_by uuid references public.profiles(id), verified_at timestamptz, review_note text not null default '' check (length(review_note) <= 500),
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.mk_items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.mk_sellers(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 70),
  title text not null check (length(btrim(title)) between 5 and 120),
  description text not null default '' check (length(description) <= 800),
  subject text not null check (length(btrim(subject)) between 2 and 60),
  grade text not null check (length(btrim(grade)) between 1 and 20),
  term text check (term in ('Term 1', 'Term 2', 'Term 3')),
  school_name text not null check (length(btrim(school_name)) between 2 and 120),
  price_minor integer not null check (price_minor between 500 and 100000 and price_minor % 100 = 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'unlisted')),
  review_note text not null default '' check (length(review_note) <= 500), reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
  question_count integer not null default 0, dup_matches integer not null default 0, purchases_count integer not null default 0 check (purchases_count >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), approved_at timestamptz
);
create index if not exists mk_items_catalog on public.mk_items(status, subject, grade);
create index if not exists mk_items_seller on public.mk_items(seller_id, updated_at desc);

create table if not exists public.mk_questions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.mk_items(id) on delete cascade,
  position integer not null check (position >= 1),
  question_text text not null check (length(btrim(question_text)) between 8 and 600),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5),
  correct_index integer not null check (correct_index between 0 and 4),
  explanation text check (explanation is null or length(explanation) <= 600),
  fingerprint text generated always as (md5(lower(regexp_replace(question_text, '[^a-zA-Z0-9]+', ' ', 'g')))) stored,
  unique (item_id, position)
);
create index if not exists mk_questions_fingerprint on public.mk_questions(fingerprint);

create table if not exists public.mk_purchases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.mk_items(id) on delete restrict,
  seller_id uuid not null references public.mk_sellers(id) on delete restrict,
  buyer_user_id uuid not null references public.profiles(id) on delete restrict,
  payment_reference text not null unique,
  item_title text not null, item_subject text not null, item_school text not null, item_grade text not null,
  price_minor bigint not null check (price_minor > 0), seller_share_minor bigint not null check (seller_share_minor >= 0), platform_fee_minor bigint not null check (platform_fee_minor >= 0),
  currency text not null default 'GHS',
  status text not null default 'active' check (status in ('active', 'reversed')),
  purchased_at timestamptz not null default now(), expires_at timestamptz not null, reversed_at timestamptz, reversal_reason text,
  check (seller_share_minor + platform_fee_minor = price_minor)
);
create index if not exists mk_purchases_buyer on public.mk_purchases(buyer_user_id, expires_at desc);
create index if not exists mk_purchases_seller on public.mk_purchases(seller_id, purchased_at desc);
create index if not exists mk_purchases_item on public.mk_purchases(item_id);

create table if not exists public.mk_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.mk_sellers(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  gross_minor bigint not null default 0, platform_fee_minor bigint not null default 0, refunds_minor bigint not null default 0, sales_count integer not null default 0,
  status text not null default 'requested' check (status in ('requested', 'paid', 'rejected', 'cancelled')),
  destination jsonb not null,
  requested_at timestamptz not null default now(), due_at timestamptz not null,
  paid_at timestamptz, paid_by uuid references public.profiles(id), transfer_ref text, decided_note text not null default '' check (length(decided_note) <= 500)
);
create index if not exists mk_payouts_seller on public.mk_payouts(seller_id, requested_at desc);
create index if not exists mk_payouts_queue on public.mk_payouts(status, due_at);

create table if not exists public.mk_ledger (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.mk_sellers(id) on delete restrict,
  kind text not null check (kind in ('sale', 'reversal', 'adjustment', 'payout_reserved', 'payout_released')),
  amount_minor bigint not null check (amount_minor <> 0),
  purchase_id uuid references public.mk_purchases(id) on delete restrict,
  payout_id uuid references public.mk_payouts(id) on delete restrict,
  available_at timestamptz not null default now(),
  note text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists mk_ledger_seller on public.mk_ledger(seller_id, available_at);
create unique index if not exists mk_ledger_one_sale on public.mk_ledger(purchase_id) where kind = 'sale';
create unique index if not exists mk_ledger_one_reversal on public.mk_ledger(purchase_id) where kind = 'reversal';

create table if not exists public.mk_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.mk_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  correct integer not null check (correct >= 0), total integer not null check (total >= 1 and correct <= total),
  created_at timestamptz not null default now()
);
create index if not exists mk_attempts_user on public.mk_attempts(user_id, item_id, created_at desc);

alter table public.mk_sellers enable row level security; alter table public.mk_items enable row level security; alter table public.mk_questions enable row level security;
alter table public.mk_purchases enable row level security; alter table public.mk_payouts enable row level security; alter table public.mk_ledger enable row level security; alter table public.mk_attempts enable row level security;
revoke all on public.mk_sellers, public.mk_items, public.mk_questions, public.mk_purchases, public.mk_payouts, public.mk_ledger, public.mk_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_num(p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = '' as $fn$
  select coalesce(nullif(quizbox_core.setting(p_key) #>> '{}', '')::numeric, p_default);
$fn$;

-- Staff: 'review' = owner, admin, super admin or content admin; 'finance' = owner, super admin or finance admin (money).
create or replace function public.qb_mk_is_staff(p_kind text) returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and (
    case when p_kind = 'finance' then quizbox_core.is_staff(array['super_admin', 'finance_admin'])
         else exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active' and upper(p.role::text) in ('ADMIN', 'OWNER')) or quizbox_core.is_staff(array['super_admin', 'content_admin']) end);
$fn$;

-- The sale split in pesewas: the teacher's share is rounded down, QuizBox keeps the rest, so the two always add up to the price.
create or replace function public.qb_mk_split(p_price bigint) returns bigint[] language sql stable security definer set search_path = '' as $fn$
  select array[floor(p_price * public.qb_mk_num('marketplace.seller_share_percent', 60) / 100)::bigint, p_price - floor(p_price * public.qb_mk_num('marketplace.seller_share_percent', 60) / 100)::bigint];
$fn$;

-- 24 hours on working days (Monday to Friday, Ghana time is UTC): a weekend request is counted from Monday, and a due time that lands on a weekend moves to Monday 17:00.
create or replace function public.qb_mk_due_at(p_from timestamptz) returns timestamptz language plpgsql stable set search_path = '' as $fn$
declare d timestamptz := p_from;
begin
  if extract(isodow from d) = 6 then d := date_trunc('day', d) + interval '2 days'; elsif extract(isodow from d) = 7 then d := date_trunc('day', d) + interval '1 day'; end if;
  d := d + interval '24 hours';
  if extract(isodow from d) = 6 then d := date_trunc('day', d) + interval '2 days 17 hours'; elsif extract(isodow from d) = 7 then d := date_trunc('day', d) + interval '1 day 17 hours'; end if;
  return d;
end $fn$;

create or replace function public.qb_mk_notify(p_user uuid, p_title text, p_message text, p_link text) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  begin
    execute 'insert into public.notifications(recipient_user_id, recipient_profile_id, recipient_email, recipient_role, type, title, message, link, category) select p.id, p.id, p.email, p.role, $1, $2, $3, $4, $5 from public.profiles p where p.id = $6'
      using 'marketplace', left(p_title, 120), left(p_message, 300), p_link, 'system', p_user;
  exception when others then null;   -- a notice must never undo the money
  end;
end $fn$;

create or replace function public.qb_mk_my_seller() returns public.mk_sellers language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into s from public.mk_sellers where user_id = auth.uid();
  if s.id is null then raise exception 'QB_NOT_A_SELLER' using errcode = '42501'; end if;
  return s;
end $fn$;
revoke all on function public.qb_mk_num(text, numeric), public.qb_mk_is_staff(text), public.qb_mk_split(bigint), public.qb_mk_due_at(timestamptz), public.qb_mk_notify(uuid, text, text, text), public.qb_mk_my_seller() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Seller
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_seller_get() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into s from public.mk_sellers where user_id = auth.uid();
  if s.id is null then return null; end if;
  return jsonb_build_object('id', s.id, 'display_name', s.display_name, 'school_name', s.school_name, 'phone', s.phone, 'payout_method', s.payout_method, 'payout_network', s.payout_network,
    'payout_account_masked', repeat('*', greatest(length(s.payout_account) - 4, 0)) || right(s.payout_account, 4), 'payout_account_name', s.payout_account_name, 'status', s.status, 'review_note', s.review_note,
    'terms_accepted', s.terms_accepted_at is not null, 'enabled', quizbox_core.flag('flags.marketplace'));
end $fn$;

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

-- Send a set for review. The seller must be verified; the set needs enough questions; questions identical to another seller's are counted so the reviewer can see it.
create or replace function public.qb_mk_item_submit(p_item uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; it public.mk_items; dup integer;
begin
  s := public.qb_mk_my_seller();
  if s.status <> 'verified' then raise exception 'QB_SELLER_NOT_VERIFIED' using errcode = '55000'; end if;
  select * into it from public.mk_items where id = p_item and seller_id = s.id for update;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if it.status not in ('draft', 'rejected', 'unlisted') then raise exception 'QB_ITEM_LOCKED' using errcode = '55000'; end if;
  if it.question_count < public.qb_mk_num('marketplace.min_questions', 10) then raise exception 'QB_TOO_FEW_QUESTIONS' using errcode = '22023'; end if;
  select count(*) into dup from public.mk_questions q where q.item_id = it.id and exists (select 1 from public.mk_questions o join public.mk_items oi on oi.id = o.item_id where o.fingerprint = q.fingerprint and oi.seller_id <> s.id);
  update public.mk_items set status = 'submitted', dup_matches = dup, review_note = '', updated_at = now() where id = it.id;
  return jsonb_build_object('ok', true, 'status', 'submitted', 'duplicates', dup);
end $fn$;

create or replace function public.qb_mk_item_unlist(p_item uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  update public.mk_items set status = 'unlisted', updated_at = now() where id = p_item and seller_id = s.id and status in ('approved', 'submitted');
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
end $fn$;

create or replace function public.qb_mk_my_item(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers; it public.mk_items;
begin
  s := public.qb_mk_my_seller();
  select * into it from public.mk_items where id = p_item and seller_id = s.id;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return to_jsonb(it) || jsonb_build_object('questions', coalesce((select jsonb_agg(jsonb_build_object('question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;

-- The seller's items, each with its sales: how many, the gross price, and the teacher's share.
create or replace function public.qb_mk_my_items() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'slug', i.slug, 'title', i.title, 'subject', i.subject, 'grade', i.grade, 'term', i.term, 'school_name', i.school_name, 'price_minor', i.price_minor, 'status', i.status,
      'review_note', i.review_note, 'question_count', i.question_count, 'updated_at', i.updated_at,
      'sales', (select count(*) from public.mk_purchases p where p.item_id = i.id and p.status = 'active'),
      'gross_minor', coalesce((select sum(p.price_minor) from public.mk_purchases p where p.item_id = i.id and p.status = 'active'), 0),
      'share_minor', coalesce((select sum(p.seller_share_minor) from public.mk_purchases p where p.item_id = i.id and p.status = 'active'), 0)) order by i.updated_at desc)
    from public.mk_items i where i.seller_id = s.id), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_my_sales(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  return coalesce((select jsonb_agg(x order by x ->> 'purchased_at' desc) from (
    select jsonb_build_object('item', p.item_title, 'school', p.item_school, 'subject', p.item_subject, 'price_minor', p.price_minor, 'share_minor', p.seller_share_minor, 'fee_minor', p.platform_fee_minor,
      'status', p.status, 'purchased_at', p.purchased_at) as x
    from public.mk_purchases p where p.seller_id = s.id order by p.purchased_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) y), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_seller_summary() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers; v_avail bigint; v_hold bigint; v_req bigint; v_paid bigint;
begin
  s := public.qb_mk_my_seller();
  select coalesce(sum(amount_minor) filter (where available_at <= now()), 0), coalesce(sum(amount_minor) filter (where available_at > now()), 0) into v_avail, v_hold from public.mk_ledger where seller_id = s.id;
  select coalesce(sum(amount_minor) filter (where status = 'requested'), 0), coalesce(sum(amount_minor) filter (where status = 'paid'), 0) into v_req, v_paid from public.mk_payouts where seller_id = s.id;
  return jsonb_build_object('status', s.status,
    'available_minor', v_avail, 'in_hold_minor', v_hold, 'requested_minor', v_req, 'paid_minor', v_paid,
    'sales', (select count(*) from public.mk_purchases where seller_id = s.id and status = 'active'),
    'gross_minor', coalesce((select sum(price_minor) from public.mk_purchases where seller_id = s.id and status = 'active'), 0),
    'share_minor', coalesce((select sum(seller_share_minor) from public.mk_purchases where seller_id = s.id and status = 'active'), 0),
    'fee_minor', coalesce((select sum(platform_fee_minor) from public.mk_purchases where seller_id = s.id and status = 'active'), 0),
    'share_percent', public.qb_mk_num('marketplace.seller_share_percent', 60), 'hold_days', public.qb_mk_num('marketplace.hold_days', 7), 'min_payout_minor', public.qb_mk_num('marketplace.min_payout_minor', 2000));
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Payouts: quote (what the teacher will approve), request, cancel
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_quote_for(p_seller uuid) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'amount_minor', coalesce(sum(l.amount_minor), 0),
    'sales_count', count(*) filter (where l.kind = 'sale'),
    'gross_minor', coalesce(sum(p.price_minor) filter (where l.kind = 'sale'), 0),
    'platform_fee_minor', coalesce(sum(p.platform_fee_minor) filter (where l.kind = 'sale'), 0),
    'refunds_minor', coalesce(-sum(l.amount_minor) filter (where l.kind = 'reversal'), 0),
    'adjustments_minor', coalesce(sum(l.amount_minor) filter (where l.kind = 'adjustment'), 0),
    'share_percent', public.qb_mk_num('marketplace.seller_share_percent', 60))
  from public.mk_ledger l left join public.mk_purchases p on p.id = l.purchase_id
  where l.seller_id = p_seller and l.payout_id is null and l.kind in ('sale', 'reversal', 'adjustment') and l.available_at <= now();
$fn$;
revoke all on function public.qb_mk_quote_for(uuid) from public, anon, authenticated;

create or replace function public.qb_mk_payout_quote() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers; q jsonb;
begin
  s := public.qb_mk_my_seller();
  q := public.qb_mk_quote_for(s.id);
  return q || jsonb_build_object('min_payout_minor', public.qb_mk_num('marketplace.min_payout_minor', 2000), 'can_request', s.status = 'verified' and (q ->> 'amount_minor')::bigint >= public.qb_mk_num('marketplace.min_payout_minor', 2000),
    'destination', jsonb_build_object('method', s.payout_method, 'network', s.payout_network, 'account_masked', repeat('*', greatest(length(s.payout_account) - 4, 0)) || right(s.payout_account, 4), 'name', s.payout_account_name));
end $fn$;

-- The teacher approves the quote they were shown: if it has changed since (a new sale became available, a refund arrived), the request is refused and they look again. The included entries are tied to the payout
-- and the amount is reserved, so it cannot be requested twice.
create or replace function public.qb_mk_payout_request(p_expected bigint) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; q jsonb; v_amount bigint; po public.mk_payouts;
begin
  s := public.qb_mk_my_seller();
  perform 1 from public.mk_sellers where id = s.id for update;
  if s.status <> 'verified' then raise exception 'QB_SELLER_NOT_VERIFIED' using errcode = '55000'; end if;
  if exists (select 1 from public.mk_payouts where seller_id = s.id and status = 'requested') then raise exception 'QB_PAYOUT_ALREADY_REQUESTED' using errcode = '55000'; end if;
  q := public.qb_mk_quote_for(s.id); v_amount := (q ->> 'amount_minor')::bigint;
  if v_amount < public.qb_mk_num('marketplace.min_payout_minor', 2000) then raise exception 'QB_PAYOUT_BELOW_MINIMUM' using errcode = '22023'; end if;
  if p_expected is distinct from v_amount then raise exception 'QB_QUOTE_CHANGED' using errcode = '55000'; end if;
  insert into public.mk_payouts(seller_id, amount_minor, gross_minor, platform_fee_minor, refunds_minor, sales_count, destination, due_at)
  values (s.id, v_amount, (q ->> 'gross_minor')::bigint, (q ->> 'platform_fee_minor')::bigint, (q ->> 'refunds_minor')::bigint, (q ->> 'sales_count')::integer,
          jsonb_build_object('method', s.payout_method, 'network', s.payout_network, 'account', s.payout_account, 'name', s.payout_account_name, 'phone', s.phone), public.qb_mk_due_at(now())) returning * into po;
  update public.mk_ledger set payout_id = po.id where seller_id = s.id and payout_id is null and kind in ('sale', 'reversal', 'adjustment') and available_at <= now();
  insert into public.mk_ledger(seller_id, kind, amount_minor, payout_id, note) values (s.id, 'payout_reserved', -v_amount, po.id, 'Payout requested');
  perform quizbox_core.audit('marketplace.payout_request', 'mk_payouts', po.id, jsonb_build_object('amount_minor', v_amount));
  return jsonb_build_object('ok', true, 'payout', po.id, 'amount_minor', v_amount, 'due_at', po.due_at);
end $fn$;

-- Returns a payout's money to the seller's balance (rejected or cancelled): the included entries become available to include again.
create or replace function public.qb_mk_payout_release(p_payout uuid, p_status text, p_note text, p_actor uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare po public.mk_payouts;
begin
  select * into po from public.mk_payouts where id = p_payout for update;
  if po.id is null or po.status <> 'requested' then raise exception 'QB_PAYOUT_NOT_OPEN' using errcode = '55000'; end if;
  update public.mk_ledger set payout_id = null where payout_id = po.id and kind in ('sale', 'reversal', 'adjustment');
  insert into public.mk_ledger(seller_id, kind, amount_minor, payout_id, note) values (po.seller_id, 'payout_released', po.amount_minor, po.id, left(coalesce(p_note, ''), 300));
  update public.mk_payouts set status = p_status, decided_note = left(coalesce(p_note, ''), 500), paid_by = p_actor where id = po.id;
end $fn$;
revoke all on function public.qb_mk_payout_release(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.qb_mk_payout_cancel(p_payout uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  if not exists (select 1 from public.mk_payouts where id = p_payout and seller_id = s.id) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_mk_payout_release(p_payout, 'cancelled', 'Cancelled by the seller', auth.uid());
end $fn$;

create or replace function public.qb_mk_my_payouts() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount_minor', p.amount_minor, 'gross_minor', p.gross_minor, 'platform_fee_minor', p.platform_fee_minor, 'refunds_minor', p.refunds_minor, 'sales_count', p.sales_count,
      'status', p.status, 'requested_at', p.requested_at, 'due_at', p.due_at, 'paid_at', p.paid_at, 'transfer_ref', p.transfer_ref, 'note', p.decided_note) order by p.requested_at desc)
    from public.mk_payouts p where p.seller_id = s.id), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Buyer
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_catalog(p_q text default null, p_subject text default null, p_grade text default null, p_school text default null, p_limit integer default 48, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare q text := nullif(btrim(regexp_replace(replace(coalesce(p_q, ''), chr(92), ''), '[%_]', '', 'g')), '');
begin
  if not quizbox_core.flag('flags.marketplace') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'purchases')::int desc, x ->> 'title') from (
    select jsonb_build_object('slug', i.slug, 'title', i.title, 'subject', i.subject, 'grade', i.grade, 'term', i.term, 'school', i.school_name, 'price_minor', i.price_minor, 'questions', i.question_count,
           'seller', s.display_name, 'purchases', i.purchases_count, 'summary', left(i.description, 160)) as x
      from public.mk_items i join public.mk_sellers s on s.id = i.seller_id
     where i.status = 'approved' and s.status = 'verified'
       and (p_subject is null or i.subject = p_subject) and (p_grade is null or i.grade = p_grade) and (p_school is null or i.school_name = p_school)
       and (q is null or i.title ilike '%' || q || '%' or i.subject ilike '%' || q || '%' or i.school_name ilike '%' || q || '%' or i.description ilike '%' || q || '%')
     order by i.purchases_count desc, i.title limit least(greatest(coalesce(p_limit, 48), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) y), '[]'::jsonb);
end $fn$;

-- One listing: everything a buyer needs to decide (the source line is subject, school, class and term) plus three sample question stems, without answers.
create or replace function public.qb_mk_item_public(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers; pur public.mk_purchases;
begin
  if not quizbox_core.flag('flags.marketplace') then return null; end if;
  select * into it from public.mk_items where slug = lower(btrim(coalesce(p_slug, ''))) and status = 'approved';
  if it.id is null then return null; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  if s.status <> 'verified' then return null; end if;
  if auth.uid() is not null then select * into pur from public.mk_purchases where item_id = it.id and buyer_user_id = auth.uid() and status = 'active' and expires_at > now() order by expires_at desc limit 1; end if;
  return jsonb_build_object('id', it.id, 'slug', it.slug, 'title', it.title, 'description', it.description, 'subject', it.subject, 'grade', it.grade, 'term', it.term, 'school', it.school_name,
    'price_minor', it.price_minor, 'questions', it.question_count, 'seller', s.display_name, 'purchases', it.purchases_count, 'access_days', public.qb_mk_num('marketplace.access_days', 90),
    'samples', coalesce((select jsonb_agg(q.question_text order by q.position) from (select question_text, position from public.mk_questions where item_id = it.id order by position limit 3) q), '[]'::jsonb),
    'mine', case when auth.uid() is not null and s.user_id = auth.uid() then true else false end,
    'owned_until', pur.expires_at);
end $fn$;

-- Before the checkout: may this signed-in person buy this set? Returns what the checkout needs. A seller cannot buy their own set; a child cannot pay; a set still in the 90 days is not sold again.
create or replace function public.qb_mk_prepare_purchase(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not quizbox_core.flag('flags.marketplace') then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into it from public.mk_items where id = p_item and status = 'approved';
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  if s.status <> 'verified' then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if s.user_id = auth.uid() then raise exception 'QB_OWN_ITEM' using errcode = '55000'; end if;
  if exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.is_minor) then raise exception 'QB_MINOR_CANNOT_PAY' using errcode = '55000'; end if;
  if exists (select 1 from public.mk_purchases where item_id = it.id and buyer_user_id = auth.uid() and status = 'active' and expires_at > now()) then raise exception 'QB_ALREADY_OWNED' using errcode = '55000'; end if;
  return jsonb_build_object('item_id', it.id, 'title', it.title, 'subject', it.subject, 'school', it.school_name, 'grade', it.grade, 'seller', s.display_name, 'price_minor', it.price_minor, 'seller_id', s.id);
end $fn$;

create or replace function public.qb_mk_my_purchases() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', p.item_id, 'slug', i.slug, 'title', p.item_title, 'subject', p.item_subject, 'school', p.item_school, 'grade', p.item_grade, 'price_minor', p.price_minor,
      'purchased_at', p.purchased_at, 'expires_at', p.expires_at, 'active', p.status = 'active' and p.expires_at > now(), 'days_left', greatest(0, ceil(extract(epoch from (p.expires_at - now())) / 86400))::int, 'status', p.status) order by p.purchased_at desc)
    from public.mk_purchases p join public.mk_items i on i.id = p.item_id where p.buyer_user_id = auth.uid()), '[]'::jsonb);
end $fn$;

-- The questions, with answers, for someone who may have them: a buyer inside the 90 days, the seller, or reviewing staff.
create or replace function public.qb_mk_open(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers; v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into it from public.mk_items where id = p_item;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  select max(expires_at) into v_until from public.mk_purchases where item_id = it.id and buyer_user_id = auth.uid() and status = 'active' and expires_at > now();
  if v_until is null and s.user_id <> auth.uid() and not public.qb_mk_is_staff('review') then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  return jsonb_build_object('title', it.title, 'subject', it.subject, 'school', it.school_name, 'grade', it.grade, 'term', it.term, 'expires_at', v_until,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;

create or replace function public.qb_mk_record_attempt(p_item uuid, p_correct integer, p_total integer) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.mk_purchases where item_id = p_item and buyer_user_id = auth.uid() and status = 'active' and expires_at > now()) then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  if p_total is null or p_total < 1 or p_correct is null or p_correct < 0 or p_correct > p_total then raise exception 'QB_INVALID_ATTEMPT' using errcode = '22023'; end if;
  insert into public.mk_attempts(item_id, user_id, correct, total) values (p_item, auth.uid(), p_correct, p_total);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Payment: the checkout records the cart on the payment, then settlement records the sale (server only)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_set_payment_item(p_reference text, p_item uuid, p_price_minor bigint) returns void language plpgsql security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers;
begin
  select * into it from public.mk_items where id = p_item; select * into s from public.mk_sellers where id = it.seller_id;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_price_minor is distinct from it.price_minor::bigint then raise exception 'QB_PRICE_CHANGED' using errcode = '55000'; end if;
  update public.payment_intents set metadata = metadata || jsonb_build_object('purpose', 'marketplace', 'item_id', it.id, 'price_minor', p_price_minor, 'item_title', it.title, 'item_subject', it.subject, 'item_school', it.school_name,
    'item_grade', it.grade, 'seller_id', s.id, 'seller', s.display_name)
   where reference = p_reference and status in ('initiated', 'pending', 'awaiting_approval', 'processing');
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
end $fn$;

create or replace function public.qb_mk_fulfil_purchase(p_reference text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare i public.payment_intents; it public.mk_items; s public.mk_sellers; pur public.mk_purchases; v_price bigint; v_split bigint[]; v_hold numeric := public.qb_mk_num('marketplace.hold_days', 7);
begin
  select * into i from public.payment_intents where reference = p_reference for update;
  if i.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if i.metadata ->> 'purpose' is distinct from 'marketplace' then return jsonb_build_object('outcome', 'not_marketplace'); end if;
  if i.status <> 'successful' or i.credited_tx_id is null then return jsonb_build_object('outcome', 'not_settled'); end if;
  select * into pur from public.mk_purchases where payment_reference = p_reference;
  if pur.id is not null then return jsonb_build_object('outcome', 'already_fulfilled', 'purchase', pur.id); end if;
  v_price := (i.metadata ->> 'price_minor')::bigint;
  if v_price is null or v_price <> i.amount_minor then return jsonb_build_object('outcome', 'amount_mismatch'); end if;
  select * into it from public.mk_items where id = (i.metadata ->> 'item_id')::uuid;
  select * into s from public.mk_sellers where id = it.seller_id;
  if it.id is null or s.id is null then return jsonb_build_object('outcome', 'item_missing'); end if;
  perform public.qb_coin_spend(i.beneficiary_user_id, i.coins, 'marketplace', p_reference, 'mkbuy-' || p_reference);
  v_split := public.qb_mk_split(v_price);
  insert into public.mk_purchases(item_id, seller_id, buyer_user_id, payment_reference, item_title, item_subject, item_school, item_grade, price_minor, seller_share_minor, platform_fee_minor, expires_at)
  values (it.id, s.id, i.beneficiary_user_id, p_reference, it.title, it.subject, it.school_name, it.grade, v_price, v_split[1], v_split[2], now() + make_interval(days => public.qb_mk_num('marketplace.access_days', 90)::int)) returning * into pur;
  insert into public.mk_ledger(seller_id, kind, amount_minor, purchase_id, available_at, note) values (s.id, 'sale', v_split[1], pur.id, now() + make_interval(days => v_hold::int), 'Sale of ' || left(it.title, 120));
  update public.mk_items set purchases_count = purchases_count + 1 where id = it.id;
  perform public.qb_mk_notify(s.user_id, 'You made a sale', 'Someone bought "' || left(it.title, 100) || '". Your share is GHS ' || (v_split[1] / 100.0)::numeric(12, 2)::text || '.', '/seller');
  perform public.qb_mk_notify(i.beneficiary_user_id, 'Your question set is ready', '"' || left(it.title, 100) || '" is yours for ' || public.qb_mk_num('marketplace.access_days', 90)::int::text || ' days.', '/marketplace/mine');
  return jsonb_build_object('outcome', 'fulfilled', 'purchase', pur.id, 'seller_share_minor', v_split[1], 'platform_fee_minor', v_split[2]);
end $fn$;

-- A refund ends the buyer's access and takes the teacher's share back (together with the original sale if it is still being held; as a debit on the balance if it was already available or paid out).
create or replace function public.qb_mk_reverse_core(p_reference text, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare pur public.mk_purchases; sale public.mk_ledger;
begin
  select * into pur from public.mk_purchases where payment_reference = p_reference for update;
  if pur.id is null then return jsonb_build_object('outcome', 'not_marketplace'); end if;
  if pur.status = 'reversed' then return jsonb_build_object('outcome', 'already_reversed'); end if;
  select * into sale from public.mk_ledger where purchase_id = pur.id and kind = 'sale';
  update public.mk_purchases set status = 'reversed', reversed_at = now(), reversal_reason = left(coalesce(p_reason, 'refunded'), 300) where id = pur.id;
  insert into public.mk_ledger(seller_id, kind, amount_minor, purchase_id, available_at, note)
  values (pur.seller_id, 'reversal', -pur.seller_share_minor, pur.id, greatest(now(), coalesce(sale.available_at, now())), 'Refund of ' || left(pur.item_title, 120));
  update public.mk_items set purchases_count = greatest(purchases_count - 1, 0) where id = pur.item_id;
  perform public.qb_mk_notify((select user_id from public.mk_sellers where id = pur.seller_id), 'A sale was refunded', '"' || left(pur.item_title, 100) || '" was refunded, so your share for it was taken back.', '/seller');
  return jsonb_build_object('outcome', 'reversed', 'purchase', pur.id);
end $fn$;
revoke all on function public.qb_mk_reverse_core(text, text) from public, anon, authenticated;
create or replace function public.qb_mk_reverse_purchase(p_reference text, p_reason text default 'refunded') returns jsonb language sql security definer set search_path = '' as $fn$ select public.qb_mk_reverse_core(p_reference, p_reason); $fn$;
create or replace function public.qb_mk_admin_reverse(p_reference text, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r jsonb;
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  r := public.qb_mk_reverse_core(btrim(p_reference), p_reason);
  if r ->> 'outcome' = 'not_marketplace' then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('marketplace.reverse', 'mk_purchases', (r ->> 'purchase')::uuid, jsonb_build_object('reference', p_reference));
  return r;
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_admin_items(p_status text default 'submitted') returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'slug', i.slug, 'title', i.title, 'subject', i.subject, 'grade', i.grade, 'term', i.term, 'school', i.school_name, 'price_minor', i.price_minor, 'status', i.status,
      'questions', i.question_count, 'duplicates', i.dup_matches, 'seller', s.display_name, 'seller_status', s.status, 'purchases', i.purchases_count, 'updated_at', i.updated_at) order by i.updated_at desc)
    from public.mk_items i join public.mk_sellers s on s.id = i.seller_id where p_status is null or p_status = '' or i.status = p_status), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_admin_item(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items;
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into it from public.mk_items where id = p_id;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return to_jsonb(it) || jsonb_build_object('seller', (select jsonb_build_object('name', s.display_name, 'school', s.school_name, 'status', s.status) from public.mk_sellers s where s.id = it.seller_id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation,
        'duplicate', exists (select 1 from public.mk_questions o join public.mk_items oi on oi.id = o.item_id where o.fingerprint = q.fingerprint and oi.seller_id <> it.seller_id)) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;

create or replace function public.qb_mk_admin_review(p_item uuid, p_decision text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers;
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'QB_INVALID_DECISION' using errcode = '22023'; end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  select * into it from public.mk_items where id = p_item for update;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if it.status <> 'submitted' then raise exception 'QB_NOT_SUBMITTED' using errcode = '55000'; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  if p_decision = 'approve' and s.status <> 'verified' then raise exception 'QB_SELLER_NOT_VERIFIED' using errcode = '55000'; end if;
  update public.mk_items set status = case when p_decision = 'approve' then 'approved' else 'rejected' end, review_note = left(coalesce(p_note, ''), 500), reviewed_by = auth.uid(), reviewed_at = now(),
         approved_at = case when p_decision = 'approve' then now() else approved_at end, updated_at = now() where id = it.id;
  perform quizbox_core.audit('marketplace.review', 'mk_items', it.id, jsonb_build_object('decision', p_decision));
  perform public.qb_mk_notify(s.user_id, case when p_decision = 'approve' then 'Your question set is on sale' else 'Your question set needs changes' end, '"' || left(it.title, 100) || '"' || case when p_decision = 'approve' then ' was approved.' else ': ' || left(coalesce(p_note, ''), 150) end, '/seller/items');
  return jsonb_build_object('ok', true, 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end $fn$;

create or replace function public.qb_mk_admin_sellers(p_status text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'school', s.school_name, 'phone', s.phone, 'status', s.status, 'review_note', s.review_note, 'method', s.payout_method, 'network', s.payout_network,
      'account_masked', repeat('*', greatest(length(s.payout_account) - 4, 0)) || right(s.payout_account, 4), 'account_name', s.payout_account_name, 'email', p.email, 'items', (select count(*) from public.mk_items i where i.seller_id = s.id), 'created_at', s.created_at) order by s.created_at desc)
    from public.mk_sellers s join public.profiles p on p.id = s.user_id where p_status is null or p_status = '' or s.status = p_status), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_admin_seller_set(p_seller uuid, p_status text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('pending', 'verified', 'suspended') then raise exception 'QB_INVALID_DECISION' using errcode = '22023'; end if;
  if p_status <> 'verified' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  update public.mk_sellers set status = p_status, review_note = left(coalesce(p_note, ''), 500), verified_by = case when p_status = 'verified' then auth.uid() end, verified_at = case when p_status = 'verified' then now() end, updated_at = now()
   where id = p_seller returning * into s;
  if s.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_status = 'suspended' then update public.mk_items set status = 'unlisted', updated_at = now() where seller_id = s.id and status in ('approved', 'submitted'); end if;
  perform quizbox_core.audit('marketplace.seller', 'mk_sellers', s.id, jsonb_build_object('status', p_status));
  perform public.qb_mk_notify(s.user_id, case when p_status = 'verified' then 'You can now sell question sets' else 'Your seller account changed' end, case when p_status = 'verified' then 'Your seller account is verified.' else left(coalesce(p_note, ''), 200) end, '/seller');
  return jsonb_build_object('ok', true, 'status', p_status);
end $fn$;

-- Finance: the payout queue, with the destination in full (the only place it is shown), and marking a payout paid or rejecting it.
create or replace function public.qb_mk_admin_payouts(p_status text default 'requested') returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'seller', s.display_name, 'school', s.school_name, 'email', pr.email, 'amount_minor', p.amount_minor, 'gross_minor', p.gross_minor, 'platform_fee_minor', p.platform_fee_minor,
      'refunds_minor', p.refunds_minor, 'sales_count', p.sales_count, 'status', p.status, 'requested_at', p.requested_at, 'due_at', p.due_at, 'overdue', p.status = 'requested' and p.due_at < now(), 'paid_at', p.paid_at, 'transfer_ref', p.transfer_ref,
      'destination', p.destination, 'note', p.decided_note) order by p.due_at)
    from public.mk_payouts p join public.mk_sellers s on s.id = p.seller_id join public.profiles pr on pr.id = s.user_id where p_status is null or p_status = '' or p.status = p_status), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_admin_payout_set(p_payout uuid, p_action text, p_ref text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare po public.mk_payouts; s public.mk_sellers;
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into po from public.mk_payouts where id = p_payout for update;
  if po.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if po.status <> 'requested' then raise exception 'QB_PAYOUT_NOT_OPEN' using errcode = '55000'; end if;
  select * into s from public.mk_sellers where id = po.seller_id;
  if p_action = 'paid' then
    if length(btrim(coalesce(p_ref, ''))) < 4 then raise exception 'QB_REFERENCE_REQUIRED' using errcode = '22023'; end if;
    update public.mk_payouts set status = 'paid', paid_at = now(), paid_by = auth.uid(), transfer_ref = left(btrim(p_ref), 80), decided_note = left(coalesce(p_note, ''), 500) where id = po.id;
    perform public.qb_mk_notify(s.user_id, 'Your payout was sent', 'GHS ' || (po.amount_minor / 100.0)::numeric(12, 2)::text || ' was sent to your ' || (po.destination ->> 'network') || ' account. Reference ' || left(btrim(p_ref), 40) || '.', '/seller');
  elsif p_action = 'reject' then
    if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
    perform public.qb_mk_payout_release(po.id, 'rejected', p_note, auth.uid());
    perform public.qb_mk_notify(s.user_id, 'Your payout request was not paid', left(p_note, 200) || ' Your money is back in your balance.', '/seller');
  else raise exception 'QB_INVALID_DECISION' using errcode = '22023'; end if;
  perform quizbox_core.audit('marketplace.payout', 'mk_payouts', po.id, jsonb_build_object('action', p_action, 'amount_minor', po.amount_minor));
  return jsonb_build_object('ok', true, 'status', p_action);
end $fn$;

-- The merchant account at a glance: what was paid in, what QuizBox keeps, what is owed to teachers, what has been paid out.
create or replace function public.qb_mk_admin_summary() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'gross_minor', coalesce((select sum(price_minor) from public.mk_purchases where status = 'active'), 0),
    'platform_fee_minor', coalesce((select sum(platform_fee_minor) from public.mk_purchases where status = 'active'), 0),
    'seller_share_minor', coalesce((select sum(seller_share_minor) from public.mk_purchases where status = 'active'), 0),
    'sales_count', (select count(*) from public.mk_purchases where status = 'active'),
    'refunded_minor', coalesce((select sum(price_minor) from public.mk_purchases where status = 'reversed'), 0), 'refunded_count', (select count(*) from public.mk_purchases where status = 'reversed'),
    'owed_to_sellers_minor', coalesce((select sum(amount_minor) from public.mk_ledger), 0) + coalesce((select sum(amount_minor) from public.mk_payouts where status = 'requested'), 0),
    'payouts_requested_minor', coalesce((select sum(amount_minor) from public.mk_payouts where status = 'requested'), 0), 'payouts_requested_count', (select count(*) from public.mk_payouts where status = 'requested'),
    'payouts_overdue_count', (select count(*) from public.mk_payouts where status = 'requested' and due_at < now()),
    'paid_out_minor', coalesce((select sum(amount_minor) from public.mk_payouts where status = 'paid'), 0),
    'items', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.mk_items group by status) x), '{}'::jsonb),
    'sellers', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.mk_sellers group by status) x), '{}'::jsonb));
end $fn$;

revoke all on function public.qb_mk_seller_get(), public.qb_mk_seller_save(text, text, text, text, text, text, text, boolean), public.qb_mk_item_save(uuid, text, text, text, text, text, text, integer), public.qb_mk_item_questions_set(uuid, jsonb),
  public.qb_mk_item_submit(uuid), public.qb_mk_item_unlist(uuid), public.qb_mk_my_item(uuid), public.qb_mk_my_items(), public.qb_mk_my_sales(integer), public.qb_mk_seller_summary(), public.qb_mk_payout_quote(), public.qb_mk_payout_request(bigint),
  public.qb_mk_payout_cancel(uuid), public.qb_mk_my_payouts(), public.qb_mk_catalog(text, text, text, text, integer, integer), public.qb_mk_item_public(text), public.qb_mk_prepare_purchase(uuid), public.qb_mk_my_purchases(), public.qb_mk_open(uuid),
  public.qb_mk_record_attempt(uuid, integer, integer), public.qb_mk_set_payment_item(text, uuid, bigint), public.qb_mk_fulfil_purchase(text), public.qb_mk_reverse_purchase(text, text), public.qb_mk_admin_reverse(text, text),
  public.qb_mk_admin_items(text), public.qb_mk_admin_item(uuid), public.qb_mk_admin_review(uuid, text, text), public.qb_mk_admin_sellers(text), public.qb_mk_admin_seller_set(uuid, text, text), public.qb_mk_admin_payouts(text),
  public.qb_mk_admin_payout_set(uuid, text, text, text), public.qb_mk_admin_summary() from public, anon, authenticated;
grant execute on function public.qb_mk_seller_get(), public.qb_mk_seller_save(text, text, text, text, text, text, text, boolean), public.qb_mk_item_save(uuid, text, text, text, text, text, text, integer), public.qb_mk_item_questions_set(uuid, jsonb),
  public.qb_mk_item_submit(uuid), public.qb_mk_item_unlist(uuid), public.qb_mk_my_item(uuid), public.qb_mk_my_items(), public.qb_mk_my_sales(integer), public.qb_mk_seller_summary(), public.qb_mk_payout_quote(), public.qb_mk_payout_request(bigint),
  public.qb_mk_payout_cancel(uuid), public.qb_mk_my_payouts(), public.qb_mk_prepare_purchase(uuid), public.qb_mk_my_purchases(), public.qb_mk_open(uuid), public.qb_mk_record_attempt(uuid, integer, integer), public.qb_mk_admin_reverse(text, text),
  public.qb_mk_admin_items(text), public.qb_mk_admin_item(uuid), public.qb_mk_admin_review(uuid, text, text), public.qb_mk_admin_sellers(text), public.qb_mk_admin_seller_set(uuid, text, text), public.qb_mk_admin_payouts(text),
  public.qb_mk_admin_payout_set(uuid, text, text, text), public.qb_mk_admin_summary() to authenticated;
grant execute on function public.qb_mk_catalog(text, text, text, text, integer, integer), public.qb_mk_item_public(text) to anon, authenticated, service_role;
grant execute on function public.qb_mk_set_payment_item(text, uuid, bigint), public.qb_mk_fulfil_purchase(text), public.qb_mk_reverse_purchase(text, text) to service_role;

-- So pages can say "not open yet" instead of showing an empty shelf.
create or replace function public.qb_mk_enabled() returns boolean language sql stable security definer set search_path = '' as $fn$ select quizbox_core.flag('flags.marketplace'); $fn$;
revoke all on function public.qb_mk_enabled() from public;
grant execute on function public.qb_mk_enabled() to anon, authenticated, service_role;

commit;
notify pgrst, 'reload schema';
