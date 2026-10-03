-- Production candidates first; source=production excludes both fixture namespaces.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.qb_content_queue(jsonb,integer,integer)'::regprocedure);
 definition:=replace(definition,
  '(coalesce(p_filters->>''source'','''')='''' or q.source_type=p_filters->>''source'')',
  '(coalesce(p_filters->>''source'','''')='''' or (p_filters->>''source''=''production'' and coalesce(q.source_type,'''') not in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'')) or q.source_type=p_filters->>''source'')');
 definition:=replace(definition,'order by created_at desc,id','order by (coalesce(source_type,'''') in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'')),created_at desc,id');
 execute definition;
end $migration$;

create function public.qb_indicator_learners_page(p_class_id uuid,p_node_id uuid,p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare result jsonb;
begin
 if auth.uid() is null or not public.qb_can_manage_class(p_class_id) then raise exception 'QB_CLASS_ACCESS_DENIED'; end if;
 if p_page is null or p_page not between 1 and 100000 or p_limit is null or p_limit not between 1 and 100 then raise exception 'QB_INVALID_PAGE'; end if;
 with evidence as (
  select student_user_id,count(*) amount,avg(case when is_correct then 100 else 0 end) accuracy,
   (array_agg(case when is_correct then 100 else 0 end order by occurred_at desc,id desc))[1] latest_score,max(occurred_at) latest_at
  from public.learning_events where class_id=p_class_id and curriculum_node_id=p_node_id group by student_user_id
 ), matching as (
  select cm.student_user_id,cm.student_name,cm.student_email,e.latest_score as "latestScore",coalesce(m.mastery_score,0) as "masteryScore",
   coalesce(m.proficiency_state,'Learning') as "proficiencyState",coalesce(m.attempts_count,e.amount) as "attemptsCount",
   coalesce(m.recent_accuracy,e.accuracy) as "recentAccuracy",coalesce(m.last_practiced_at,e.latest_at) as "lastPracticedAt"
  from public.class_memberships cm join evidence e using(student_user_id)
  left join public.mastery_records m on m.student_user_id=cm.student_user_id and m.curriculum_node_id=p_node_id
  where cm.class_id=p_class_id and cm.status='active'
 )
 select jsonb_build_object('total',(select count(*) from matching),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from
  (select * from matching order by student_name nulls last,student_user_id limit p_limit offset (p_page-1)*p_limit) r),'[]'::jsonb)) into result;
 return result;
end $body$;
revoke all on function public.qb_indicator_learners_page(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.qb_indicator_learners_page(uuid,uuid,integer,integer) to authenticated,service_role;
notify pgrst,'reload schema';
