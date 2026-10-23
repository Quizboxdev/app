-- The Help centre: guides for learners, teachers, schools and sponsors (never administrator workflows), managed in Admin, searchable, with "was this helpful" and view counts.
--   help_articles  slug, title, summary, body (simple formatting), category, who it is for (audiences), draft or published, counters, and a full-text search column
-- Everyone (visitors too) can read published articles and search them; only support staff (owner, admin, super admin, support) write. The tables are closed to every browser; everything goes through the
-- functions below. Counters are written by the server only. Additive and idempotent. Rollback: supabase/rollback/help_centre.sql.

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  title text not null check (length(btrim(title)) between 3 and 120),
  summary text not null check (length(btrim(summary)) between 10 and 240),
  body text not null check (length(body) between 50 and 60000),
  category text not null check (category in ('getting-started', 'practise', 'classes', 'assignments', 'challenges', 'payments', 'account', 'safety')),
  audiences text[] not null default array['everyone'] check (cardinality(audiences) >= 1 and audiences <@ array['everyone', 'student', 'teacher', 'school', 'sponsor']::text[]),
  sort_order integer not null default 100,
  state text not null default 'draft' check (state in ('draft', 'published')),
  views integer not null default 0 check (views >= 0), helpful_yes integer not null default 0 check (helpful_yes >= 0), helpful_no integer not null default 0 check (helpful_no >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz,
  search tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, ''))) stored
);
create index if not exists help_articles_search on public.help_articles using gin (search);
create index if not exists help_articles_list on public.help_articles (state, category, sort_order);
alter table public.help_articles enable row level security;
revoke all on public.help_articles from anon, authenticated;

-- Reading. A person's role picks which guides they see first (their own plus the ones for everyone); a visitor with no role sees all published guides.
create or replace function public.qb_help_list(p_audience text default null) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('slug', a.slug, 'title', a.title, 'summary', a.summary, 'category', a.category, 'audiences', a.audiences, 'views', a.views) order by a.sort_order, a.title), '[]'::jsonb)
    from public.help_articles a
   where a.state = 'published' and (p_audience is null or p_audience not in ('student', 'teacher', 'school', 'sponsor') or 'everyone' = any (a.audiences) or p_audience = any (a.audiences));
$fn$;

create or replace function public.qb_help_get(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare a public.help_articles;
begin
  select * into a from public.help_articles where slug = lower(btrim(coalesce(p_slug, ''))) and state = 'published';
  if a.id is null then return null; end if;
  return jsonb_build_object('article', jsonb_build_object('slug', a.slug, 'title', a.title, 'summary', a.summary, 'body', a.body, 'category', a.category, 'audiences', a.audiences, 'updated_at', a.updated_at),
    'related', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'title', r.title, 'summary', r.summary) order by r.sort_order, r.title)
                           from (select * from public.help_articles x where x.state = 'published' and x.category = a.category and x.id <> a.id order by x.sort_order, x.title limit 4) r), '[]'::jsonb));
end $fn$;

-- Search: matches words in the title, summary and steps (stemmed, so "sharing" finds "share"), and also any part of a title or summary so a half-typed word still finds something.
create or replace function public.qb_help_search(p_query text, p_audience text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare q text := btrim(regexp_replace(replace(coalesce(p_query, ''), chr(92), ''), '[%_]', '', 'g')); tsq tsquery;
begin
  if length(q) < 2 or length(q) > 100 then return '[]'::jsonb; end if;
  tsq := websearch_to_tsquery('english', q);
  return coalesce((select jsonb_agg(jsonb_build_object('slug', m.slug, 'title', m.title, 'summary', m.summary, 'category', m.category) order by m.score desc, m.title) from (
    select a.slug, a.title, a.summary, a.category,
           (case when a.title ilike '%' || q || '%' then 2 else 0 end) + (case when a.summary ilike '%' || q || '%' then 1 else 0 end) + ts_rank(a.search, tsq) as score
      from public.help_articles a
     where a.state = 'published' and (p_audience is null or p_audience not in ('student', 'teacher', 'school', 'sponsor') or 'everyone' = any (a.audiences) or p_audience = any (a.audiences))
       and (a.search @@ tsq or a.title ilike '%' || q || '%' or a.summary ilike '%' || q || '%')
     order by 5 desc limit 20) m), '[]'::jsonb);
end $fn$;

-- Counters: written by the server after it has limited each device (one view or vote per article per device per hour).
create or replace function public.qb_help_track(p_slug text, p_event text) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if p_event not in ('view', 'yes', 'no') then raise exception 'QB_HELP_INVALID' using errcode = '22023'; end if;
  update public.help_articles set views = views + (case when p_event = 'view' then 1 else 0 end), helpful_yes = helpful_yes + (case when p_event = 'yes' then 1 else 0 end),
         helpful_no = helpful_no + (case when p_event = 'no' then 1 else 0 end) where slug = lower(btrim(coalesce(p_slug, ''))) and state = 'published';
end $fn$;

-- Management: support staff only (the same people who answer support requests).
create or replace function public.qb_help_admin_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'slug', a.slug, 'title', a.title, 'category', a.category, 'audiences', a.audiences, 'state', a.state, 'sort_order', a.sort_order,
      'views', a.views, 'helpful_yes', a.helpful_yes, 'helpful_no', a.helpful_no, 'updated_at', a.updated_at) order by a.category, a.sort_order, a.title) from public.help_articles a), '[]'::jsonb);
end $fn$;

create or replace function public.qb_help_admin_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare a public.help_articles;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into a from public.help_articles where id = p_id;
  if a.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return to_jsonb(a) - 'search' - 'updated_by';
end $fn$;

