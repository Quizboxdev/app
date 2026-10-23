-- Support requests: signed-in people and visitors ask for help, staff answer, files can be attached. (Separate from the older public.support_tickets table, which is left as it is.)
--   support_requests          one row per request: reference (QB-T-...), who, category, subject, status, priority, assignee
--   support_request_messages  the conversation; staff can add internal notes the person never sees
--   support_request_files     attachments (images and PDF, 5 MB each) kept in the private bucket "support-files"; people open them only through a short-lived link the server issues
-- A person sees only their own requests; staff (owner, admin, super admin, support) see all. Everything goes through the checked functions below; the tables are closed to every browser.
-- Visitors (the public contact form) come in through the server only. Additive and idempotent. Rollback: supabase/rollback/support_requests.sql.
begin;

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

-- A visitor (the contact form) opens a request. Server only. Limits: 5 an hour per device and 5 a day per email address.
create or replace function public.qb_support_create_public(p_name text, p_email text, p_category text, p_subject text, p_message text, p_client_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare r public.support_requests;
begin
  if not public.qb_support_category_ok(p_category) or length(btrim(coalesce(p_name, ''))) not between 1 and 120 or length(btrim(coalesce(p_subject, ''))) not between 3 and 150
     or length(btrim(coalesce(p_message, ''))) not between 10 and 5000 or lower(btrim(coalesce(p_email, ''))) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'QB_SUPPORT_INVALID' using errcode = '22023';
  end if;
  if not quizbox_private.consume_intake_budget('support-ip:' || left(coalesce(p_client_hash, 'none'), 64), 5, 3600)
     or not quizbox_private.consume_intake_budget('support-mail:' || lower(btrim(p_email)), 5, 86400) then raise exception 'QB_RATE_LIMITED' using errcode = '53400'; end if;
  insert into public.support_requests(requester_user_id, requester_name, requester_email, category, subject, source)
  values (null, btrim(p_name), lower(btrim(p_email)), p_category, btrim(p_subject), 'contact_form') returning * into r;
  insert into public.support_request_messages(request_id, author_kind, body) values (r.id, 'requester', btrim(p_message));
  return jsonb_build_object('id', r.id, 'reference', r.reference);
end $fn$;

create or replace function public.qb_support_my_requests() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reference', r.reference, 'subject', r.subject, 'category', r.category, 'status', r.status, 'created_at', r.created_at, 'last_message_at', r.last_message_at)
                                    order by r.last_message_at desc) from public.support_requests r where r.requester_user_id = auth.uid()), '[]'::jsonb);
end $fn$;

-- One request with its conversation and files: the person who made it, or staff (who also see internal notes).
create or replace function public.qb_support_request_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r public.support_requests; staff boolean := public.qb_support_is_staff();
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into r from public.support_requests where id = p_id;
  if r.id is null or not (staff or r.requester_user_id = auth.uid()) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('request', to_jsonb(r) - 'requester_user_id' || jsonb_build_object('mine', r.requester_user_id = auth.uid(), 'staff_view', staff),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_kind', m.author_kind, 'body', m.body, 'internal', m.internal, 'created_at', m.created_at,
          'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'mime', f.mime, 'size_bytes', f.size_bytes) order by f.created_at) from public.support_request_files f where f.message_id = m.id), '[]'::jsonb)) order by m.created_at)
        from public.support_request_messages m where m.request_id = r.id and (staff or not m.internal)), '[]'::jsonb),
    'loose_files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'mime', f.mime, 'size_bytes', f.size_bytes) order by f.created_at) from public.support_request_files f where f.request_id = r.id and f.message_id is null), '[]'::jsonb));
end $fn$;

-- The person adds to their own request. A resolved request reopens; a closed one does not. At most 30 an hour.
create or replace function public.qb_support_reply(p_id uuid, p_body text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.support_requests; m public.support_request_messages;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then raise exception 'QB_SUPPORT_INVALID' using errcode = '22023'; end if;
  select * into r from public.support_requests where id = p_id and requester_user_id = auth.uid() for update;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'closed' then raise exception 'QB_SUPPORT_CLOSED' using errcode = '55000'; end if;
  if not quizbox_private.consume_intake_budget('support-reply:' || auth.uid()::text, 30, 3600) then raise exception 'QB_RATE_LIMITED' using errcode = '53400'; end if;
  insert into public.support_request_messages(request_id, author_user_id, author_kind, body) values (r.id, auth.uid(), 'requester', btrim(p_body)) returning * into m;
  update public.support_requests set status = 'open', resolved_at = null, last_message_at = now(), updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'message', m.id);
end $fn$;

create or replace function public.qb_support_admin_list(p_status text default null, p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'last_message_at') desc) from (
    select jsonb_build_object('id', r.id, 'reference', r.reference, 'subject', r.subject, 'category', r.category, 'status', r.status, 'priority', r.priority, 'requester', r.requester_name,
      'email', r.requester_email, 'signed_in', r.requester_user_id is not null, 'source', r.source, 'assigned_to', r.assigned_to, 'created_at', r.created_at, 'last_message_at', r.last_message_at,
      'messages', (select count(*) from public.support_request_messages m where m.request_id = r.id)) as x
    from public.support_requests r where p_status is null or p_status = '' or r.status = p_status
    order by (r.status in ('resolved', 'closed')), r.last_message_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) y), '[]'::jsonb);
end $fn$;

-- Staff answer. A public answer waits for the person (status "waiting for user" unless chosen); an internal note changes nothing the person can see.
create or replace function public.qb_support_staff_reply(p_id uuid, p_body text, p_internal boolean default false, p_status text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.support_requests; m public.support_request_messages; v_status text;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 5000 or (p_status is not null and p_status not in ('open', 'waiting_for_user', 'resolved', 'closed')) then raise exception 'QB_SUPPORT_INVALID' using errcode = '22023'; end if;
  select * into r from public.support_requests where id = p_id for update;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.support_request_messages(request_id, author_user_id, author_kind, body, internal) values (r.id, auth.uid(), 'staff', btrim(p_body), coalesce(p_internal, false)) returning * into m;
  v_status := coalesce(p_status, case when coalesce(p_internal, false) then r.status else 'waiting_for_user' end);
  update public.support_requests set status = v_status, resolved_at = case when v_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end,
         assigned_to = coalesce(assigned_to, auth.uid()), last_message_at = case when coalesce(p_internal, false) then last_message_at else now() end, updated_at = now() where id = r.id;
  if not coalesce(p_internal, false) and r.requester_user_id is not null then
    begin   -- the person is told in the app; a failure here must never lose the reply
      execute 'insert into public.notifications(recipient_user_id, recipient_profile_id, recipient_email, recipient_role, type, title, message, link, category) select p.id, p.id, p.email, p.role, $1, $2, $3, $4, $5 from public.profiles p where p.id = $6'
        using 'support_reply', 'A reply to your support request', 'QuizBox support replied to ' || r.reference || '.', '/support/' || r.id::text, 'system', r.requester_user_id;
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'message', m.id, 'status', v_status, 'internal', coalesce(p_internal, false));
end $fn$;

create or replace function public.qb_support_set(p_id uuid, p_status text, p_priority text, p_assignee uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.support_requests;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('open', 'waiting_for_user', 'resolved', 'closed') or p_priority not in ('low', 'normal', 'high') then raise exception 'QB_SUPPORT_INVALID' using errcode = '22023'; end if;
  update public.support_requests set status = p_status, priority = p_priority, assigned_to = p_assignee, updated_at = now(), resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('support.set', 'support_requests', r.id, jsonb_build_object('status', p_status, 'priority', p_priority));
  return jsonb_build_object('ok', true, 'status', r.status, 'priority', r.priority);
end $fn$;

-- Delete a request and its files (the retention period in the Privacy Notice). Returns the stored file paths so the server can remove them from storage.
create or replace function public.qb_support_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.support_requests; paths jsonb;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into r from public.support_requests where id = p_id for update;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status not in ('resolved', 'closed') then raise exception 'QB_SUPPORT_NOT_RESOLVED' using errcode = '55000'; end if;
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into paths from public.support_request_files where request_id = r.id;
  delete from public.support_requests where id = r.id;
  perform quizbox_core.audit('support.delete', 'support_requests', r.id, jsonb_build_object('reference', r.reference));
  return jsonb_build_object('ok', true, 'paths', paths);
end $fn$;

-- Files. The server asks these before it stores or hands out anything.
create or replace function public.qb_support_request_authorize(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r public.support_requests; staff boolean := public.qb_support_is_staff(); n integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into r from public.support_requests where id = p_id;
  if r.id is null or not (staff or r.requester_user_id = auth.uid()) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'closed' and not staff then raise exception 'QB_SUPPORT_CLOSED' using errcode = '55000'; end if;
  select count(*) into n from public.support_request_files where request_id = r.id;
  return jsonb_build_object('request', r.id, 'kind', case when staff and r.requester_user_id is distinct from auth.uid() then 'staff' else 'requester' end, 'files', n);
end $fn$;

create or replace function public.qb_support_file_authorize(p_file uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f public.support_request_files; r public.support_requests;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into f from public.support_request_files where id = p_file;
  if f.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into r from public.support_requests where id = f.request_id;
  if not (public.qb_support_is_staff() or r.requester_user_id = auth.uid()) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', f.storage_path, 'file_name', f.file_name, 'mime', f.mime);
end $fn$;

create or replace function public.qb_support_file_add(p_request uuid, p_message uuid, p_path text, p_name text, p_mime text, p_size integer, p_kind text) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare fid uuid;
begin
  if (select count(*) from public.support_request_files where request_id = p_request) >= 10 then raise exception 'QB_SUPPORT_TOO_MANY_FILES' using errcode = '54000'; end if;
  insert into public.support_request_files(request_id, message_id, storage_path, file_name, mime, size_bytes, uploaded_by_kind)
  values (p_request, p_message, p_path, left(regexp_replace(replace(btrim(p_name), chr(92), '_'), '[/[:cntrl:]]', '_', 'g'), 200), p_mime, p_size, p_kind) returning id into fid;
  return fid;
end $fn$;

revoke all on function public.qb_support_is_staff(), public.qb_support_category_ok(text), public.qb_support_create(text, text, text, text), public.qb_support_create_public(text, text, text, text, text, text),
  public.qb_support_my_requests(), public.qb_support_request_get(uuid), public.qb_support_reply(uuid, text), public.qb_support_admin_list(text, integer), public.qb_support_staff_reply(uuid, text, boolean, text),
  public.qb_support_set(uuid, text, text, uuid), public.qb_support_delete(uuid), public.qb_support_request_authorize(uuid), public.qb_support_file_authorize(uuid),
  public.qb_support_file_add(uuid, uuid, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.qb_support_create(text, text, text, text), public.qb_support_my_requests(), public.qb_support_request_get(uuid), public.qb_support_reply(uuid, text), public.qb_support_admin_list(text, integer),
  public.qb_support_staff_reply(uuid, text, boolean, text), public.qb_support_set(uuid, text, text, uuid), public.qb_support_delete(uuid), public.qb_support_request_authorize(uuid), public.qb_support_file_authorize(uuid) to authenticated;
grant execute on function public.qb_support_create_public(text, text, text, text, text, text), public.qb_support_file_add(uuid, uuid, text, text, text, integer, text), public.qb_support_is_staff() to service_role;

commit;
notify pgrst, 'reload schema';
