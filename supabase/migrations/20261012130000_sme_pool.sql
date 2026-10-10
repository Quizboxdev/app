begin;

-- SME review pool (tracker R1-R3). Loaded questions wait in 'review'. A verified SME opens the pool, sees what their domains cover and the fee
-- per review, and clicks Pick: the existing review assignment is created for them, so one SME holds a question at a time. Nothing here
-- widens authorization: the same domain_matches rule as admin assignment applies, plus the SPONSOR specialization for sponsor-origin questions.
-- Pick size, daily cap, open-queue cap and release hours are admin settings (platform_settings), never fixed in code.

alter table public.sme_review_assignments add column if not exists picked_from_pool boolean not null default false;
create index if not exists sme_assignments_pool_open on public.sme_review_assignments(assigned_at) where picked_from_pool and review_completed_at is null;

insert into public.platform_settings(key,value,description)
select v.key,v.value,v.description from (values
 ('sme_pool.pick_size','25'::jsonb,'Most questions an SME can pick in one click'),
 ('sme_pool.daily_cap','100'::jsonb,'Most questions an SME can pick in one day'),
 ('sme_pool.max_open','50'::jsonb,'Most picked questions an SME can hold unfinished at once'),
 ('sme_pool.release_hours','24'::jsonb,'Hours before a picked, unfinished question returns to the pool (no pay)')
) v(key,value,description)
where not exists(select 1 from public.platform_settings s where s.key=v.key and s.scope_type='global');

create function quizbox_sme.pool_number(p_key text,p_default integer) returns integer language sql stable security definer set search_path='' as $$
 select coalesce((select (s.v #>> '{}')::numeric::integer from (select quizbox_core.setting(p_key) as v) s
  where jsonb_typeof(s.v)='number' and (s.v #>> '{}')::numeric between 1 and 100000),p_default);
$$;

-- Start of the reviewer's day in their market's time zone (UTC when they have no market).
create function quizbox_sme.pool_day_start(p_reviewer uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select date_trunc('day',now() at time zone z.tz) at time zone z.tz
 from (select coalesce((select m.timezone from public.sme_domain_assignments d join public.markets m on m.id=d.market_id where d.reviewer_id=p_reviewer and d.active order by d.created_at,d.id limit 1),'UTC') as tz) z;
$$;

create function quizbox_sme.safe_policy(p_market uuid,p_tenant uuid,p_tier text,p_subject text,p_level text) returns uuid
language plpgsql stable security definer set search_path='' as $$
begin return quizbox_sme.resolve_policy(p_market,p_tenant,null,p_tier,p_subject,p_level,now());
exception when others then return null; end $$;

-- Questions this reviewer could pick now. Same rules the scheduler applies: in review, no open or current primary assignment, never
-- reviewed or returned by this reviewer for this version, active market. Sponsor-origin questions need the SPONSOR specialization.
-- p_payable_only hides questions with no resolvable fee, so an SME is never asked to do unpaid work.
create function quizbox_sme.pool_candidates(p_reviewer uuid,p_subject text,p_grade text,p_limit integer,p_payable_only boolean)
returns table(question_id uuid,question_version integer,domain_id uuid,market_id uuid,tenant_id uuid,subject_code text,grade_code text,education_level text,sponsor boolean,policy_version_id uuid)
language sql stable security definer set search_path='' as $$
 select q.id,q.version,dm.id,c.market_id,q.tenant_id,q.subject_code,coalesce(q.canonical_grade_code,q.grade::text),n.education_level,q.content_origin<>'CURRICULUM',pv.id
 from public.questions q
 left join public.curriculum_nodes n on n.id=q.curriculum_node_id
 left join public.curricula c on c.id=n.curriculum_id
 cross join lateral (select d.id from public.sme_domain_assignments d
   where d.reviewer_id=p_reviewer and quizbox_sme.domain_matches(d.id,q.id,p_reviewer,c.market_id,false,false)
   and (q.content_origin='CURRICULUM' or d.specialization='SPONSOR') order by d.created_at,d.id limit 1) dm
 cross join lateral (select quizbox_sme.safe_policy(c.market_id,q.tenant_id,(select s.reviewer_tier from public.sme_profiles s where s.user_id=p_reviewer),q.subject_code,n.education_level) as id) pv
 where q.validation_status='review' and q.status::text<>'archived' and coalesce(q.source_type,'') not like 'DEV_%'
  and (c.market_id is null or exists(select 1 from public.markets k join public.countries co on co.id=k.country_id join public.currencies u on u.code=k.default_currency_code where k.id=c.market_id and k.active and co.active and u.active))
  and (p_subject is null or q.subject_code=p_subject) and (p_grade is null or coalesce(q.canonical_grade_code,q.grade::text)=p_grade)
  and (not p_payable_only or pv.id is not null)
  and not exists(select 1 from public.sme_review_assignments w where w.question_id=q.id and w.review_kind='primary' and (w.review_completed_at is null or (w.question_version=q.version and w.released_at is null)))
  and not exists(select 1 from public.sme_review_assignments w where w.question_id=q.id and w.question_version=q.version and w.reviewer_id=p_reviewer and w.review_kind='primary')
 order by q.curriculum_node_id,q.created_at,q.id
 limit greatest(p_limit,0);
$$;

-- Picked work that was not finished in time goes back to the pool. Closing it without a review event means nothing becomes payable.
create function quizbox_sme.pool_release_stale() returns integer language plpgsql security definer set search_path='' as $$
declare hours integer:=quizbox_sme.pool_number('sme_pool.release_hours',24); n integer;
begin
 with u as (
  update public.sme_review_assignments a set review_completed_at=now(),released_at=now(),released_by=null,
   release_reason='Returned automatically: not finished within '||hours||' hours'
  where a.picked_from_pool and a.review_completed_at is null and a.assigned_at<now()-make_interval(hours=>hours)
  returning a.id,a.question_id,a.reviewer_id)
 insert into quizbox_factory.assignment_events(assignment_id,question_id,reviewer_id,action,actor_id,details)
 select u.id,u.question_id,u.reviewer_id,'RELEASED',u.reviewer_id,jsonb_build_object('reason','auto','hours',hours) from u;
 get diagnostics n=row_count;
 return n;
end $$;

create function quizbox_sme.pool_require_reviewer() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.sme_profiles s join public.profiles u on u.id=s.user_id
  where s.user_id=auth.uid() and s.active and s.reviewer_status='verified' and lower(u.status::text)='active') then raise exception 'QB_SME_PROFILE_REQUIRED' using errcode='42501'; end if;
 return auth.uid();
end $$;

-- R1: what I can pick, my fee, today's numbers, and the work I hold.
create function public.qb_sme_pool() returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=quizbox_sme.pool_require_reviewer(); day_start timestamptz:=quizbox_sme.pool_day_start(auth.uid());
 s_pick integer:=quizbox_sme.pool_number('sme_pool.pick_size',25); s_cap integer:=quizbox_sme.pool_number('sme_pool.daily_cap',100);
 s_open integer:=quizbox_sme.pool_number('sme_pool.max_open',50); s_hours integer:=quizbox_sme.pool_number('sme_pool.release_hours',24);
 picked integer; done integer; open_n integer; groups jsonb; mine jsonb; total integer; unpaid integer;
begin
 perform quizbox_sme.pool_release_stale();
 select count(*) into picked from public.sme_review_assignments where reviewer_id=me and assigned_at>=day_start and released_at is null;
 select count(*) into done from public.sme_review_events where reviewer_id=me and review_completed_at>=day_start;
 select count(*) into open_n from public.sme_review_assignments where reviewer_id=me and review_completed_at is null;
 with c as (select * from quizbox_sme.pool_candidates(me,null,null,5000,false)),
  g as (select c.subject_code,c.grade_code,c.education_level,c.sponsor,c.policy_version_id,count(*)::integer n from c group by 1,2,3,4,5)
 select coalesce(jsonb_agg(jsonb_build_object('subject',g.subject_code,'grade',g.grade_code,'level',g.education_level,'sponsor',g.sponsor,'count',g.n,
   'fee',case when v.id is null then null else jsonb_build_object('currency',v.currency_code,'review',v.base_review_fee,'approve',v.approve_fee,'revision',v.revision_fee,'reject',v.reject_fee) end)
   order by g.subject_code,g.grade_code),'[]'),coalesce(sum(g.n),0),coalesce(sum(g.n) filter(where v.id is null),0)
 into groups,total,unpaid from g left join public.compensation_policy_versions v on v.id=g.policy_version_id;
 select coalesce(jsonb_agg(m.j order by m.at,m.id),'[]') into mine from (
  select a.id,a.assigned_at as at,jsonb_build_object('assignment_id',a.id,'question_id',a.question_id,'subject',q.subject_code,'grade',coalesce(q.canonical_grade_code,q.grade::text),
   'topic',(select t.title from public.question_topic_links l join public.curriculum_topics t on t.id=l.topic_id where l.question_id=q.id limit 1),
   'assigned_at',a.assigned_at,'return_at',case when a.picked_from_pool then a.assigned_at+make_interval(hours=>s_hours) end,'started',a.review_started_at is not null,'from_pool',a.picked_from_pool) j
  from public.sme_review_assignments a join public.questions q on q.id=a.question_id
  where a.reviewer_id=me and a.review_completed_at is null order by a.assigned_at,a.id limit 200) m;
 return jsonb_build_object(
  'settings',jsonb_build_object('pick_size',s_pick,'daily_cap',s_cap,'max_open',s_open,'release_hours',s_hours),
  'today',jsonb_build_object('picked',picked,'completed',done,'open',open_n,'remaining_today',greatest(s_cap-picked,0),'room_to_hold',greatest(s_open-open_n,0),
   'earned',quizbox_factory.reviewer_money(me,array['pending_qa','payable','held','paid'],day_start)),
  'available',jsonb_build_object('total',total,'without_fee',unpaid,'capped',total>=5000,'groups',groups),
  'mine',mine);
end $$;

-- R2: claim up to N questions. The fee policy version is pinned on each assignment now, so a later fee change never alters it.
create function public.qb_sme_pick(p_count integer default null,p_subject text default null,p_grade text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=quizbox_sme.pool_require_reviewer(); day_start timestamptz:=quizbox_sme.pool_day_start(auth.uid());
 s_pick integer:=quizbox_sme.pool_number('sme_pool.pick_size',25); s_cap integer:=quizbox_sme.pool_number('sme_pool.daily_cap',100); s_open integer:=quizbox_sme.pool_number('sme_pool.max_open',50);
 picked_today integer; open_n integer; n integer; c record; locked uuid; a uuid; ids uuid[]:='{}'; contended integer:=0; reason text;
begin
 if p_count is not null and p_count<1 then raise exception 'QB_PICK_COUNT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtext('quizbox_sme.pick:'||me::text));
 perform quizbox_sme.pool_release_stale();
 select count(*) into picked_today from public.sme_review_assignments where reviewer_id=me and assigned_at>=day_start and released_at is null;
 select count(*) into open_n from public.sme_review_assignments where reviewer_id=me and review_completed_at is null;
 n:=least(coalesce(p_count,s_pick),s_pick,s_cap-picked_today,s_open-open_n);
 if n<=0 then
  reason:=case when s_cap-picked_today<=0 then 'DAILY_CAP_REACHED' else 'OPEN_QUEUE_FULL' end;
  return jsonb_build_object('picked',0,'assignment_ids','[]'::jsonb,'reason',reason,'remaining_today',greatest(s_cap-picked_today,0),'room_to_hold',greatest(s_open-open_n,0));
 end if;
 for c in select * from quizbox_sme.pool_candidates(me,p_subject,p_grade,n*3+10,true) loop
  exit when cardinality(ids)>=n;
  begin
   select id into locked from public.questions where id=c.question_id and validation_status='review' for update skip locked;
   if locked is null then contended:=contended+1; continue; end if;
   insert into public.sme_review_assignments(question_id,question_version,reviewer_id,domain_assignment_id,market_id,tenant_id,compensation_policy_version_id,review_kind,assigned_by,picked_from_pool)
   values(c.question_id,c.question_version,me,c.domain_id,c.market_id,c.tenant_id,c.policy_version_id,'primary',me,true) returning id into a;
   insert into quizbox_factory.assignment_events(assignment_id,question_id,reviewer_id,action,actor_id,details)
   values(a,c.question_id,me,'ASSIGNED',me,jsonb_build_object('mode','POOL_PICK'));
   ids:=ids||a;
  exception when unique_violation then contended:=contended+1;
  end;
 end loop;
 reason:=case when cardinality(ids)=0 then 'POOL_EMPTY' end;
 return jsonb_build_object('picked',cardinality(ids),'assignment_ids',to_jsonb(ids),'reason',reason,'contended',contended,
  'remaining_today',greatest(s_cap-picked_today-cardinality(ids),0),'room_to_hold',greatest(s_open-open_n-cardinality(ids),0));
end $$;

-- R3: return unfinished work to the pool. No review event exists, so nothing becomes payable.
create function public.qb_sme_release(p_assignment uuid,p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.sme_review_assignments; note text:=left(coalesce(nullif(trim(p_reason),''),'Returned to the pool'),300);
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into w from public.sme_review_assignments where id=p_assignment for update;
 if w.id is null or (w.reviewer_id<>auth.uid() and not quizbox_sme.has_capability('content_admin')) then raise exception 'QB_REVIEW_ACCESS_DENIED' using errcode='42501'; end if;
 if w.review_completed_at is not null then raise exception 'QB_ASSIGNMENT_NOT_OUTSTANDING'; end if;
 update public.sme_review_assignments set review_completed_at=now(),released_at=now(),released_by=auth.uid(),release_reason=note where id=w.id;
 insert into quizbox_factory.assignment_events(assignment_id,question_id,reviewer_id,action,actor_id,details)
 values(w.id,w.question_id,w.reviewer_id,'RELEASED',auth.uid(),jsonb_build_object('reason',note));
 return jsonb_build_object('released',w.id,'question_id',w.question_id);
end $$;

-- Admin sweep of every stale pick (the pool and pick calls also run it, so no scheduler is needed).
create function public.qb_sme_pool_sweep() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not quizbox_sme.has_capability('content_admin') then raise exception 'QB_SME_ASSIGNMENT_DENIED' using errcode='42501'; end if;
 return jsonb_build_object('released',quizbox_sme.pool_release_stale());
end $$;

-- A self-pick is not news to the SME who just clicked it: do not send one "Review assigned" notification per picked question.
do $do$
begin
 if to_regprocedure('quizbox_ops.on_review_assignment()') is not null then
  execute $f$create or replace function quizbox_ops.on_review_assignment() returns trigger language plpgsql security definer set search_path='' as $b$
begin
 if new.assigned_by is not distinct from new.reviewer_id then return null; end if;
 perform quizbox_ops.notify(new.reviewer_id,'REVIEW_ASSIGNED',case when new.review_kind='senior' then 'Senior QA review assigned' else 'Review assigned' end,'New review work is waiting in your queue.','/review','sme_review_assignments',new.id,new.market_id);
 return null;
exception when others then return null;
end $b$$f$;
 end if;
end $do$;

revoke all on function quizbox_sme.pool_number(text,integer),quizbox_sme.pool_day_start(uuid),quizbox_sme.safe_policy(uuid,uuid,text,text,text),
 quizbox_sme.pool_candidates(uuid,text,text,integer,boolean),quizbox_sme.pool_release_stale(),quizbox_sme.pool_require_reviewer() from public,anon,authenticated;
revoke all on function public.qb_sme_pool(),public.qb_sme_pick(integer,text,text),public.qb_sme_release(uuid,text),public.qb_sme_pool_sweep() from public,anon;
grant execute on function public.qb_sme_pool(),public.qb_sme_pick(integer,text,text),public.qb_sme_release(uuid,text),public.qb_sme_pool_sweep() to authenticated;

commit;
