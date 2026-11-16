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
