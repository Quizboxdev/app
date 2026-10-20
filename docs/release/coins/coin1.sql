-- Coin products (phase 1 of the Coin price ladder). 1 Coin = GHS 1.00 (100 pesewas), fixed in the database: a row's price must equal coins x 100.
-- Adds the Coin amount, the number of days, and which school levels a row is shown to. Replaces the starter learner plans with the single ladder that is the same for
-- every level: Weekly 5 Coins (7 days), Monthly 10 (30 days), 90 days 25 (90 days, also called Term), Yearly 90 (365 days). Seat bundles for quizzes: 1 Coin per participant.
-- Buy Coins is a product with no fixed amount (the buyer types how many Coins; the server prices it).
-- Additive and idempotent. Rollback: supabase/rollback/coin_products.sql.

alter table public.price_list
  add column if not exists coins integer check (coins is null or coins between 1 and 100000),
  add column if not exists days integer check (days is null or days between 1 and 731),
  add column if not exists levels text[] not null default '{}' check (levels <@ array['PRIMARY','JHS','SHS','ADULT']::text[]);

do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'price_list_coins_fixed_price') then
    alter table public.price_list add constraint price_list_coins_fixed_price check (coins is null or price_minor is null or price_minor = coins * 100);
  end if;
end $do$;

-- The ladder replaces the older starter learner plans, which are switched off (never deleted).
update public.price_list set active = false where code in ('learner_monthly', 'learner_term');

insert into public.price_list(code, kind, name, audience, description, includes, period, coins, days, price_minor, levels, active, highlight, sort_order) values
  ('plan_weekly',  'plan', 'Weekly', 'learner', 'A week of full practice.', '["Unlimited self-built practice","All subjects for your grade"]', 'month', 5, 7, 500, '{PRIMARY,JHS,SHS}', true, false, 10),
  ('plan_monthly', 'plan', 'Monthly', 'learner', 'A month of full practice.', '["Unlimited self-built practice","All subjects for your grade","Progress and mastery tracking"]', 'month', 10, 30, 1000, '{PRIMARY,JHS,SHS}', true, false, 20),
  ('plan_term',    'plan', 'Term (90 days)', 'learner', 'The best value for a full term.', '["Everything in Monthly","Best value for a full school term"]', 'term', 25, 90, 2500, '{PRIMARY,JHS,SHS}', true, true, 30),
  ('plan_yearly',  'plan', 'Yearly', 'learner', 'A whole year of practice.', '["Everything in Term","One payment for the whole year"]', 'year', 90, 365, 9000, '{PRIMARY,JHS,SHS}', true, false, 40),
  ('seats_10',   'bundle', 'Class bundle: up to 10 participants', 'host', 'For a quiz with up to 10 people.', '["Up to 10 participants","Full access for the quiz period (up to 90 days)"]', 'once', 10, null, 1000, '{}', true, false, 110),
  ('seats_20',   'bundle', 'Class bundle: up to 20 participants', 'host', 'For a quiz with up to 20 people.', '["Up to 20 participants","Full access for the quiz period (up to 90 days)"]', 'once', 20, null, 2000, '{}', true, false, 120),
  ('seats_50',   'bundle', 'Class bundle: up to 50 participants', 'host', 'For a class-sized quiz.', '["Up to 50 participants","Full access for the quiz period (up to 90 days)"]', 'once', 50, null, 5000, '{}', true, true, 130),
  ('seats_100',  'bundle', 'Bundle: up to 100 participants', 'host', 'For a school year group.', '["Up to 100 participants","Full access for the quiz period (up to 90 days)"]', 'once', 100, null, 10000, '{}', true, false, 140),
  ('seats_200',  'bundle', 'Bundle: up to 200 participants', 'host', 'For a whole stage of a school.', '["Up to 200 participants","Full access for the quiz period (up to 90 days)"]', 'once', 200, null, 20000, '{}', true, false, 150),
  ('seats_500',  'bundle', 'Bundle: up to 500 participants', 'host', 'For a large campaign.', '["Up to 500 participants","Full access for the quiz period (up to 90 days)"]', 'once', 500, null, 50000, '{}', true, false, 160),
  ('seats_1000', 'bundle', 'Bundle: up to 1000 participants', 'host', 'For a large public campaign.', '["Up to 1000 participants","Full access for the quiz period (up to 90 days)"]', 'once', 1000, null, 100000, '{}', true, false, 170)
on conflict (code) do nothing;

-- What visitors see now includes the Coin amount, the days and the levels, so the pricing page can build its segments from one source.
create or replace function public.qb_price_list() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'kind', p.kind, 'name', p.name, 'audience', p.audience, 'description', p.description, 'includes', p.includes, 'period', p.period,
         'coins', p.coins, 'days', p.days, 'levels', to_jsonb(p.levels), 'price_minor', p.price_minor, 'currency', p.currency, 'highlight', p.highlight,
         'checkout_url', case when p.price_minor is not null and p.price_minor > 0 then p.checkout_url end) order by p.sort_order, p.name), '[]'::jsonb)
    from public.price_list p where p.active and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now());
$fn$;

-- Saving a row: Coins and days may be set; the cedi price follows the Coins (coins x 100 pesewas), so the two can never disagree.
