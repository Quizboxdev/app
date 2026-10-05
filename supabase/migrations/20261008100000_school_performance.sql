-- School performance contract: read-only, institution-scoped aggregates for school admins/owners.
-- Extends qb_school() with action 'performance' and adds stable ids / server-side counts to 'overview'.
-- No RLS policy is changed and no table grant is added: teacher-owner and student-self policies stay as they are.
-- The aggregate runs inside a SECURITY DEFINER helper that is not callable by clients; qb_school() authorises first.
begin;

create or replace function quizbox_ops.school_performance(p_inst uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with cls as (
   select c.id,c.class_name,coalesce(c.grade_code,c.grade::text) grade from public.classes c where c.institution_id=p_inst and lower(c.status::text)='active'),
 roster as (
   select distinct m.class_id,m.student_user_id from public.class_memberships m join cls on cls.id=m.class_id
   where lower(m.status::text)='active' and m.student_user_id is not null),
 -- Same semantics as the Teacher class analytics: one latest FINAL grade per rostered learner and class.
 latest as (
   select distinct on (g.class_id,g.student_user_id) g.class_id,g.student_user_id,g.percentage,g.graded_at
   from public.gradebook g join roster r on r.class_id=g.class_id and r.student_user_id=g.student_user_id
   where lower(g.status::text)='final' order by g.class_id,g.student_user_id,g.graded_at desc,g.id),
 learner_latest as (select distinct on (student_user_id) student_user_id,percentage from latest order by student_user_id,graded_at desc),
 grade_roster as (select distinct cls.grade,r.student_user_id from roster r join cls on cls.id=r.class_id),
 grade_latest as (
   select distinct on (cls.grade,l.student_user_id) cls.grade,l.student_user_id,l.percentage
   from latest l join cls on cls.id=l.class_id order by cls.grade,l.student_user_id,l.graded_at desc),
 asg as (select a.id,a.due_at from public.assignments a join cls on cls.id=a.class_id where upper(a.status::text)='PUBLISHED'),
 -- Completion is measured on assignments whose due date has passed, so a just-published assignment never reads as 0%.
 due_targets as (
   select t.assignment_id,m.student_user_id from public.assignment_targets t
   join asg on asg.id=t.assignment_id and asg.due_at is not null and asg.due_at<=now()
   join public.class_memberships m on m.id=t.membership_id
   where upper(t.status::text)='ACTIVE' and m.student_user_id is not null),
 due_done as (
   select count(*) n from due_targets d where exists(select 1 from public.gradebook g where g.assignment_id=d.assignment_id and g.student_user_id=d.student_user_id and lower(g.status::text)='final')),
 subj as (
   select distinct on (a.subject_name,g.student_user_id) a.subject_name subject,g.student_user_id,g.percentage
   from public.gradebook g join public.assignments a on a.id=g.assignment_id join roster r on r.class_id=g.class_id and r.student_user_id=g.student_user_id
   where lower(g.status::text)='final' order by a.subject_name,g.student_user_id,g.graded_at desc,g.id),
 ind as (
   select n.id node_id,n.code,coalesce(n.title,n.code) label,count(distinct e.student_user_id)::int assessed_count,count(*)::int response_count,count(*) filter (where e.is_correct)::int correct_count
   from public.learning_events e join roster r on r.class_id=e.class_id and r.student_user_id=e.student_user_id
   join public.curriculum_nodes n on n.id=e.curriculum_node_id where e.is_correct is not null group by n.id,n.code,n.title having count(*)>=5)
 select jsonb_build_object(
  'summary',jsonb_build_object(
    'learner_count',(select count(distinct student_user_id) from roster),
    'assessed_learner_count',(select count(*) from learner_latest),
    'average_score',(select round(avg(percentage),1) from learner_latest),
    'assignment_completion_rate',(select case when count(*)=0 then null else round(100.0*(select n from due_done)/count(*),1) end from due_targets),
    'due_target_count',(select count(*) from due_targets),
    'active_assignment_count',(select count(*) from asg where due_at is null or due_at>now())),
  'by_grade',coalesce((select jsonb_agg(x order by x->>'grade') from (
    select jsonb_build_object('grade',gr.grade,'learner_count',count(distinct gr.student_user_id),'assessed_count',count(distinct gl.student_user_id),
      'average_score',round(avg(gl.percentage),1),'completion_rate',round(100.0*count(distinct gl.student_user_id)/nullif(count(distinct gr.student_user_id),0),1)) x
    from grade_roster gr left join grade_latest gl on gl.grade is not distinct from gr.grade and gl.student_user_id=gr.student_user_id group by gr.grade) q),'[]'),
  'by_class',coalesce((select jsonb_agg(x order by x->>'class_name') from (
    select jsonb_build_object('class_id',cls.id,'class_name',cls.class_name,'grade',cls.grade,'learner_count',count(r.student_user_id),'assessed_count',count(l.student_user_id),
      'average_score',round(avg(l.percentage),1),'completion_rate',round(100.0*count(l.student_user_id)/nullif(count(r.student_user_id),0),1)) x
    from cls left join roster r on r.class_id=cls.id left join latest l on l.class_id=r.class_id and l.student_user_id=r.student_user_id group by cls.id,cls.class_name,cls.grade) q),'[]'),
  'by_subject',coalesce((select jsonb_agg(jsonb_build_object('subject',subject,'assessed_count',n,'average_score',avg_score) order by subject) from (
    select subject,count(*)::int n,round(avg(percentage),1) avg_score from subj group by subject) q),'[]'),
  'weak_indicators',coalesce((select jsonb_agg(jsonb_build_object('node_id',node_id,'code',code,'label',label,'assessed_count',assessed_count,'response_count',response_count,
      'average_score',round(100.0*correct_count/response_count,1),'low_evidence',(assessed_count<5 or response_count<20)) order by 100.0*correct_count/response_count,response_count desc) from (
    select * from ind order by 100.0*correct_count/response_count limit 8) q),'[]'));
$$;
revoke all on function quizbox_ops.school_performance(uuid) from public,anon,authenticated;

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
   'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.class_name,'grade',coalesce(c.grade_code,c.grade::text),'status',c.status,'teacher_user_id',c.teacher_user_id,'teacher',(select full_name from public.profiles where id=c.teacher_user_id),
     'students',(select count(*) from public.class_memberships x where x.class_id=c.id and x.status::text='active')) order by c.status,c.class_name) from public.classes c where c.institution_id=inst),'[]'),
   -- Server-side counts so the client never infers them from the capped history feed.
   'summary',jsonb_build_object(
     'unique_learners',(select count(distinct x.student_user_id) from public.class_memberships x join public.classes c on c.id=x.class_id where c.institution_id=inst and lower(c.status::text)='active' and x.status::text='active'),
     'joined_last_30d',(select count(*) from public.class_memberships x join public.classes c on c.id=x.class_id where c.institution_id=inst and x.joined_at>=now()-interval '30 days')));
 elsif p_action='performance' then
  return quizbox_ops.school_performance(inst);
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
  -- The limit must sit inside the subquery: on the aggregate itself it capped nothing and returned every membership row.
  return coalesce((select jsonb_agg(jsonb_build_object('class',h.class_name,'student',h.student_name,'status',h.status,'joined_at',h.joined_at,'left_at',h.left_at) order by h.joined_at desc)
   from (select c.class_name,x.student_name,x.status,x.joined_at,x.left_at from public.class_memberships x join public.classes c on c.id=x.class_id where c.institution_id=inst order by x.joined_at desc limit 200) h),'[]');
 end if;
 raise exception 'INVALID_SCHOOL_ACTION';
end $$;
revoke all on function public.qb_school(text,jsonb) from public,anon;
grant execute on function public.qb_school(text,jsonb) to authenticated;

commit;
