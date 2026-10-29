-- Support requests: signed-in people and visitors ask for help, staff answer, files can be attached. (Separate from the older public.support_tickets table, which is left as it is.)
--   support_requests          one row per request: reference (QB-T-...), who, category, subject, status, priority, assignee
--   support_request_messages  the conversation; staff can add internal notes the person never sees
--   support_request_files     attachments (images and PDF, 5 MB each) kept in the private bucket "support-files"; people open them only through a short-lived link the server issues
-- A person sees only their own requests; staff (owner, admin, super admin, support) see all. Everything goes through the checked functions below; the tables are closed to every browser.
-- Visitors (the public contact form) come in through the server only. Additive and idempotent. Rollback: supabase/rollback/support_requests.sql.


create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('QB-T-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  requester_user_id uuid references public.profiles(id) on delete set null,
  requester_name text not null check (length(btrim(requester_name)) between 1 and 120),
  requester_email text not null check (length(requester_email) <= 200 and requester_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  category text not null check (category in ('account', 'payment', 'class', 'challenge', 'content', 'other')),
  subject text not null check (length(btrim(subject)) between 3 and 150),
  status text not null default 'open' check (status in ('open', 'waiting_for_user', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assigned_to uuid references public.profiles(id) on delete set null,
  context text not null default '' check (length(context) <= 300),
  source text not null default 'app' check (source in ('app', 'contact_form')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_message_at timestamptz not null default now(), resolved_at timestamptz
);
create index if not exists support_requests_user on public.support_requests(requester_user_id, last_message_at desc);
create index if not exists support_requests_queue on public.support_requests(status, last_message_at desc);

create table if not exists public.support_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete set null,
  author_kind text not null check (author_kind in ('requester', 'staff')),
  body text not null check (length(btrim(body)) between 1 and 5000),
  internal boolean not null default false check (not internal or author_kind = 'staff'),
  created_at timestamptz not null default now()
);
create index if not exists support_request_messages_request on public.support_request_messages(request_id, created_at);

create table if not exists public.support_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete cascade,
  message_id uuid references public.support_request_messages(id) on delete set null,
  storage_path text not null unique check (length(storage_path) between 10 and 300),
  file_name text not null check (length(file_name) between 1 and 200),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  uploaded_by_kind text not null check (uploaded_by_kind in ('requester', 'staff')),
  created_at timestamptz not null default now()
);
create index if not exists support_request_files_request on public.support_request_files(request_id);

alter table public.support_requests enable row level security;
alter table public.support_request_messages enable row level security;
alter table public.support_request_files enable row level security;
revoke all on public.support_requests, public.support_request_messages, public.support_request_files from anon, authenticated;

-- The private bucket (where the storage service exists; skipped quietly elsewhere).
do $do$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('support-files', 'support-files', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  end if;
end $do$;

-- Who counts as support staff: an owner or admin, or someone with the super admin or support capability.
create or replace function public.qb_support_is_staff() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active' and upper(p.role::text) in ('ADMIN', 'OWNER'))
    or quizbox_core.is_staff(array['super_admin', 'sme_support']));
$fn$;

create or replace function public.qb_support_category_ok(p text) returns boolean language sql immutable set search_path = '' as $fn$
  select p in ('account', 'payment', 'class', 'challenge', 'content', 'other');
$fn$;

-- A signed-in person opens a request. At most 10 an hour.
create or replace function public.qb_support_create(p_category text, p_subject text, p_message text, p_context text default '') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare p public.profiles; r public.support_requests;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not public.qb_support_category_ok(p_category) or length(btrim(coalesce(p_subject, ''))) not between 3 and 150 or length(btrim(coalesce(p_message, ''))) not between 10 and 5000 then
    raise exception 'QB_SUPPORT_INVALID' using errcode = '22023';
  end if;
  if not quizbox_private.consume_intake_budget('support:' || auth.uid()::text, 10, 3600) then raise exception 'QB_RATE_LIMITED' using errcode = '53400'; end if;
  select * into p from public.profiles where id = auth.uid();
  insert into public.support_requests(requester_user_id, requester_name, requester_email, category, subject, context, source)
  values (auth.uid(), left(coalesce(nullif(btrim(p.full_name), ''), 'QuizBox user'), 120), coalesce(nullif(btrim(p.email), ''), 'unknown@invalid.example'), p_category, btrim(p_subject), left(coalesce(p_context, ''), 300), 'app') returning * into r;
  insert into public.support_request_messages(request_id, author_user_id, author_kind, body) values (r.id, auth.uid(), 'requester', btrim(p_message));
  return jsonb_build_object('id', r.id, 'reference', r.reference);
end $fn$;
