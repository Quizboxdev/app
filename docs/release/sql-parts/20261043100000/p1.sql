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
