-- Family workspace, phase 5: question sets a parent buys in the Marketplace become the family's library, and the parent can give a set to the children they choose.
-- Nothing is copied: a grant is a reference to the purchase the parent already made (same licence, same 90 days), and the child plays the original set. If the purchase is reversed or expires, the child's access ends with it.
--   public.qb_family_library()                          the parent's purchased sets, with which children have each set and their best score
--   public.qb_family_grant_set(item, students)          the parent gives a purchased set to ticked children (each must be a child the parent may give work to)
--   public.qb_family_revoke_grant(item, student)        the parent takes a set back from one child
--   public.qb_family_my_sets()                          the child's sets from their family
--   public.qb_family_set_open(item)                     the child opens a set they were given (same shape as the Marketplace's own opener)
--   public.qb_family_set_record(item, correct, total)   the child's score for a set they were given
-- Off with the rest of the workspace (flags.family_workspace). Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN, QB_NOT_PURCHASED, QB_INVALID_ATTEMPT. Additive and idempotent. Rollback: supabase/rollback/family_library.sql
begin;

create table if not exists public.family_set_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.family_workspaces(id) on delete cascade,
  item_id uuid not null references public.mk_items(id) on delete cascade,
  purchase_id uuid not null references public.mk_purchases(id) on delete cascade,
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, item_id, student_user_id)
);
create index if not exists family_set_grants_student on public.family_set_grants(student_user_id);
alter table public.family_set_grants enable row level security;
revoke all on public.family_set_grants from public, anon, authenticated;

create or replace function public.qb_family_library() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', p.item_id, 'title', p.item_title, 'subject', p.item_subject, 'school', p.item_school, 'grade', p.item_grade,
      'expires_at', p.expires_at, 'active', p.status = 'active' and p.expires_at > now(),
      'children', coalesce((select jsonb_agg(jsonb_build_object('student_id', g.student_user_id, 'name', pr.full_name,
            'best', (select max(round(a.correct * 100.0 / a.total)) from public.mk_attempts a where a.item_id = p.item_id and a.user_id = g.student_user_id)) order by pr.full_name)
          from public.family_set_grants g join public.profiles pr on pr.id = g.student_user_id
          where g.workspace_id = w and g.item_id = p.item_id and quizbox_core.family_can(uid, g.student_user_id, 'view_progress')), '[]'::jsonb)) order by p.purchased_at desc)
    from public.mk_purchases p where p.buyer_user_id = uid), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_grant_set(p_item uuid, p_students uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid; pur public.mk_purchases; sid uuid; n integer := 0; parent_name text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  if p_students is null or cardinality(p_students) not between 1 and 20 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select * into pur from public.mk_purchases where item_id = p_item and buyer_user_id = uid and status = 'active' and expires_at > now() order by expires_at desc limit 1;
  if pur.id is null then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  foreach sid in array p_students loop
    if not quizbox_core.family_can(uid, sid, 'assign') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  end loop;
  select coalesce(nullif(full_name, ''), 'Your family') into parent_name from public.profiles where id = uid;
  foreach sid in array p_students loop
    if exists (select 1 from public.family_set_grants where workspace_id = w and item_id = p_item and student_user_id = sid) then
      update public.family_set_grants set purchase_id = pur.id where workspace_id = w and item_id = p_item and student_user_id = sid;
    else
      insert into public.family_set_grants(workspace_id, item_id, purchase_id, student_user_id, granted_by) values (w, p_item, pur.id, sid, uid);
      insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
      values (sid, 'student', 'family_set', 'A question set from ' || parent_name, parent_name || ' gave you "' || pur.item_title || '" to practise. Find it on your home screen.', 'mk_items', p_item);
      n := n + 1;
    end if;
  end loop;
  perform quizbox_core.audit('family.set_grant', 'mk_items', p_item, jsonb_build_object('children', n));
  return jsonb_build_object('granted', n);
end $fn$;

create or replace function public.qb_family_revoke_grant(p_item uuid, p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  delete from public.family_set_grants g using public.family_workspaces w where g.workspace_id = w.id and w.owner_user_id = uid and g.item_id = p_item and g.student_user_id = p_student;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  perform quizbox_core.audit('family.set_revoke', 'mk_items', p_item, jsonb_build_object('student', p_student));
  return jsonb_build_object('revoked', n);
end $fn$;

create or replace function public.qb_family_my_sets() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', g.item_id, 'title', p.item_title, 'subject', p.item_subject, 'grade', p.item_grade, 'from', coalesce(nullif(o.full_name, ''), 'Your family'), 'expires_at', p.expires_at,
      'best', (select max(round(a.correct * 100.0 / a.total)) from public.mk_attempts a where a.item_id = g.item_id and a.user_id = auth.uid())) order by g.created_at desc)
    from public.family_set_grants g join public.mk_purchases p on p.id = g.purchase_id join public.profiles o on o.id = g.granted_by
    where g.student_user_id = auth.uid() and p.status = 'active' and p.expires_at > now()), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_set_open(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  select max(p.expires_at) into v_until from public.family_set_grants g join public.mk_purchases p on p.id = g.purchase_id
   where g.student_user_id = auth.uid() and g.item_id = p_item and p.status = 'active' and p.expires_at > now();
  if v_until is null then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  select * into it from public.mk_items where id = p_item;
  return jsonb_build_object('title', it.title, 'subject', it.subject, 'school', it.school_name, 'grade', it.grade, 'term', it.term, 'expires_at', v_until,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;

create or replace function public.qb_family_set_record(p_item uuid, p_correct integer, p_total integer) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not exists (select 1 from public.family_set_grants g join public.mk_purchases p on p.id = g.purchase_id where g.student_user_id = auth.uid() and g.item_id = p_item and p.status = 'active' and p.expires_at > now()) then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  if p_total is null or p_total < 1 or p_correct is null or p_correct < 0 or p_correct > p_total then raise exception 'QB_INVALID_ATTEMPT' using errcode = '22023'; end if;
  insert into public.mk_attempts(item_id, user_id, correct, total) values (p_item, auth.uid(), p_correct, p_total);
end $fn$;

revoke all on function public.qb_family_library(), public.qb_family_grant_set(uuid, uuid[]), public.qb_family_revoke_grant(uuid, uuid), public.qb_family_my_sets(), public.qb_family_set_open(uuid), public.qb_family_set_record(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.qb_family_library(), public.qb_family_grant_set(uuid, uuid[]), public.qb_family_revoke_grant(uuid, uuid), public.qb_family_my_sets(), public.qb_family_set_open(uuid), public.qb_family_set_record(uuid, integer, integer) to authenticated;

commit;
notify pgrst, 'reload schema';
