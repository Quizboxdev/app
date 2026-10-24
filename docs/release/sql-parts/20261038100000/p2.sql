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
