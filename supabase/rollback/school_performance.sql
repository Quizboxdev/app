-- Rollback for 20261008100000_school_performance.
-- Restores public.qb_school() to the exact definition shipped in 20261004120000_competition_school_admin_ops.sql
-- (original 'overview' shape without teacher_user_id/summary, no 'performance' action, original 'history' query)
-- and drops the one helper that migration introduced, quizbox_ops.school_performance(uuid).
-- Nothing else is touched: that migration changed no tables, policies, grants or other functions, so
-- quizbox_ops.school_admin(uuid), the school tables and every existing grant stay exactly as they were.
-- The function holds no data of its own, so rolling back loses nothing.
begin;

create or replace function public.qb_school(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare inst uuid:=nullif(p_data->>'institution_id','')::uuid; cls public.classes; target public.classes; m public.class_memberships; teacher uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_action='my_schools' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'role',im.role)) from public.institutions i join public.institution_memberships im on im.institution_id=i.id
   where im.user_id=auth.uid() and im.role::text in ('admin','owner') and im.status::text='active'),'[]');
 end if;
 if p_action in ('assign_teacher','archive_class','transfer_student') then
  select * into cls from public.classes where id=(p_data->>'class_id')::uuid for update; inst:=cls.institution_id;
 end if;
 if inst is null or not quizbox_ops.school_admin(inst) then raise exception 'QB_SCHOOL_ADMIN_REQUIRED' using errcode='42501'; end if;
 if p_action='overview' then
  return jsonb_build_object('institution',(select name from public.institutions where id=inst),
   'teachers',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.full_name,'role',im.role)) from public.institution_memberships im join public.profiles p on p.id=im.user_id where im.institution_id=inst and im.status::text='active' and im.role::text in ('teacher','admin','owner')),'[]'),
   'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.class_name,'grade',coalesce(c.grade_code,c.grade::text),'status',c.status,'teacher',(select full_name from public.profiles where id=c.teacher_user_id),
     'students',(select count(*) from public.class_memberships x where x.class_id=c.id and x.status::text='active')) order by c.status,c.class_name) from public.classes c where c.institution_id=inst),'[]'));
 elsif p_action='assign_teacher' then
  teacher:=(p_data->>'teacher_user_id')::uuid;
  if not exists(select 1 from public.institution_memberships where institution_id=inst and user_id=teacher and status::text='active' and role::text in ('teacher','admin','owner')) then raise exception 'QB_TEACHER_NOT_IN_SCHOOL'; end if;
  update public.classes set teacher_user_id=teacher,primary_teacher_id=coalesce((select id from public.teacher_profiles where user_id=teacher limit 1),primary_teacher_id) where id=cls.id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_CLASS_TEACHER_REASSIGNED','classes',cls.id,'pass',jsonb_build_object('from',cls.teacher_user_id,'to',teacher));
  return jsonb_build_object('class_id',cls.id,'teacher_user_id',teacher);
 elsif p_action='archive_class' then
  update public.classes set status='archived' where id=cls.id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_CLASS_ARCHIVED','classes',cls.id,'pass','{}');
  return jsonb_build_object('class_id',cls.id,'status','archived');
 elsif p_action='transfer_student' then
  select * into m from public.class_memberships where id=(p_data->>'membership_id')::uuid and class_id=cls.id and status::text='active' for update;
  select * into target from public.classes where id=(p_data->>'to_class_id')::uuid;
  if m.id is null or target.id is null or target.institution_id is distinct from inst or target.status::text<>'active' then raise exception 'QB_INVALID_TRANSFER'; end if;
  -- History is the closed membership row plus the new one; nothing is deleted.
  update public.class_memberships set status='inactive',left_at=now() where id=m.id;
  insert into public.class_memberships(id,class_id,student_id,student_user_id,student_email,student_name,grade,status,joined_at,approved_at,approved_by)
  values(gen_random_uuid(),target.id,m.student_id,m.student_user_id,m.student_email,m.student_name,m.grade,'active',now(),now(),auth.uid())
  on conflict do nothing;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_STUDENT_TRANSFERRED','class_memberships',m.id,'pass',jsonb_build_object('from_class',cls.id,'to_class',target.id));
  return jsonb_build_object('from_class',cls.id,'to_class',target.id);
 elsif p_action='history' then
  return coalesce((select jsonb_agg(jsonb_build_object('class',c.class_name,'student',x.student_name,'status',x.status,'joined_at',x.joined_at,'left_at',x.left_at) order by x.joined_at desc)
   from public.class_memberships x join public.classes c on c.id=x.class_id where c.institution_id=inst limit 200),'[]');
 end if;
 raise exception 'INVALID_SCHOOL_ACTION';
end $$;

-- Same grants the original migration set (create or replace keeps them; asserted here so the result is explicit).
revoke all on function public.qb_school(text,jsonb) from public,anon;
grant execute on function public.qb_school(text,jsonb) to authenticated;

-- The restored qb_school no longer calls the helper, so it can be dropped.
drop function if exists quizbox_ops.school_performance(uuid);

commit;
