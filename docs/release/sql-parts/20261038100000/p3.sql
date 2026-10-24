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
