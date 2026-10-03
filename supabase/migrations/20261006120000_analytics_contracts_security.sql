-- Security and data-integrity fix for 20261006110000_analytics_contracts_final.
-- That migration shipped SECURITY DEFINER functions executable by anon, an unenforced (stubbed) student
-- authorization check, a fabricated "First Competition" achievement for every caller, and zero-filled sponsor
-- analytics. Signatures and result shapes are unchanged so the UI keeps working; results now come from the
-- competition engine (registrations, participations, official results, leaderboard) and access is enforced.
begin;

-- Sponsor analytics are visible to the sponsor owner, active organization members and Super Admins only.
create or replace function quizbox_ops.sponsor_analytics_allowed(p_sponsor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and p_sponsor is not null and (quizbox_sme.has_capability('super_admin')
  or exists(select 1 from public.sponsor_profiles s where s.id=p_sponsor and s.user_id=auth.uid())
  or exists(select 1 from quizbox_competition.organization_members m where m.sponsor_id=p_sponsor and m.user_id=auth.uid() and m.active));
$$;
create or replace function quizbox_ops.analytics_sponsor(p_sponsor uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare v uuid:=coalesce(p_sponsor,(select id from public.sponsor_profiles where user_id=auth.uid() order by created_at limit 1),
 (select sponsor_id from quizbox_competition.organization_members where user_id=auth.uid() and active order by created_at limit 1));
begin
 if not quizbox_ops.sponsor_analytics_allowed(v) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return v;
end $$;
-- A learner's competition analytics are visible to that learner and to Super Admins only.
create or replace function quizbox_ops.analytics_student(p_student uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare v uuid:=coalesce(p_student,auth.uid());
begin
 if auth.uid() is null or (v<>auth.uid() and not quizbox_sme.has_capability('super_admin')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return v;
end $$;

-- Achievements are earned only from official results; a learner with no results has none.
create or replace function public.qb_student_achievements(p_student_id uuid default auth.uid()) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s uuid:=quizbox_ops.analytics_student(p_student_id);
begin
 return coalesce((select jsonb_agg(a.item order by a.earned) from (
  select min(r.submitted_at) earned,jsonb_build_object('id',md5(s::text||':FIRST_COMPETITION')::uuid,'code','FIRST_COMPETITION','title','First Competition','type','PARTICIPATION','tier','BRONZE','earned_at',min(r.submitted_at)) item
   from quizbox_competition.official_results r where r.participant_id=s having count(*)>0
  union all select min(r.submitted_at),jsonb_build_object('id',md5(s::text||':TOP_3')::uuid,'code','TOP_3','title','Top 3 Finish','type','PLACEMENT','tier','SILVER','earned_at',min(r.submitted_at))
   from quizbox_competition.official_results r join quizbox_competition.leaderboard l on l.competition_id=r.competition_id and l.participant_id=r.participant_id where r.participant_id=s and l.rank<=3 having count(*)>0
  union all select min(r.submitted_at),jsonb_build_object('id',md5(s::text||':WINNER')::uuid,'code','WINNER','title','Competition Winner','type','PLACEMENT','tier','GOLD','earned_at',min(r.submitted_at))
   from quizbox_competition.official_results r join quizbox_competition.leaderboard l on l.competition_id=r.competition_id and l.participant_id=r.participant_id where r.participant_id=s and l.rank=1 having count(*)>0
  union all select min(r.submitted_at),jsonb_build_object('id',md5(s::text||':PERFECT_SCORE')::uuid,'code','PERFECT_SCORE','title','Perfect Score','type','MASTERY','tier','GOLD','earned_at',min(r.submitted_at))
   from quizbox_competition.official_results r where r.participant_id=s and r.percentage>=100 having count(*)>0) a),'[]');
end $$;

create or replace function public.qb_student_competition_analytics(p_student_id uuid default auth.uid()) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s uuid:=quizbox_ops.analytics_student(p_student_id); latest record;
begin
 select r.competition_id,r.percentage,l.rank into latest from quizbox_competition.official_results r
  left join quizbox_competition.leaderboard l on l.competition_id=r.competition_id and l.participant_id=r.participant_id
  where r.participant_id=s order by r.submitted_at desc limit 1;
 return jsonb_build_object(
  'competitions_entered',(select count(distinct competition_id) from quizbox_competition.registrations where participant_id=s and eligible),
  'competitions_completed',(select count(distinct competition_id) from quizbox_competition.official_results where participant_id=s),
  'latest_score',coalesce(round(latest.percentage,1),0),
  'best_score',coalesce((select round(max(percentage),1) from quizbox_competition.official_results where participant_id=s),0),
  'current_rank',latest.rank,
  'top_3_finishes',(select count(*) from quizbox_competition.leaderboard where participant_id=s and rank<=3),
  'wins',(select count(*) from quizbox_competition.leaderboard where participant_id=s and rank=1),
  'achievements',public.qb_student_achievements(s),
  'participation_trend',coalesce((select jsonb_agg(jsonb_build_object('name',to_char(x.m,'Mon YYYY'),'score',round(x.avg_pct,1),'count',x.n) order by x.m)
    from (select date_trunc('month',submitted_at) m,avg(percentage) avg_pct,count(*) n from quizbox_competition.official_results
     where participant_id=s and submitted_at>=date_trunc('month',now())-interval '5 months' group by 1) x),'[]'));
end $$;

create or replace function public.qb_sponsor_participation_funnel(p_sponsor_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=quizbox_ops.analytics_sponsor(p_sponsor_id); registered integer; started integer; completed integer;
begin
 select count(*) into registered from quizbox_competition.registrations g join quizbox_competition.drafts d on d.competition_id=g.competition_id where d.sponsor_id=v and g.eligible;
 select count(distinct (p.competition_id,p.participant_id)) into started from quizbox_competition.participations p join quizbox_competition.drafts d on d.competition_id=p.competition_id where d.sponsor_id=v;
 select count(distinct (r.competition_id,r.participant_id)) into completed from quizbox_competition.official_results r join quizbox_competition.drafts d on d.competition_id=r.competition_id where d.sponsor_id=v;
 return jsonb_build_object('registrations',registered,'started',started,'completed',completed,
  'drop_off_rate',case when registered>0 then round(100.0*(registered-least(completed,registered))/registered,1) else 0 end);
end $$;

create or replace function public.qb_sponsor_score_distribution(p_sponsor_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=quizbox_ops.analytics_sponsor(p_sponsor_id);
begin
 if not exists(select 1 from quizbox_competition.official_results r join quizbox_competition.drafts d on d.competition_id=r.competition_id where d.sponsor_id=v) then return '[]'::jsonb; end if;
 return (select jsonb_agg(jsonb_build_object('label',b.label,'value',coalesce(x.n,0)) order by b.lo) from
  (values (0,'0–19%'),(20,'20–39%'),(40,'40–59%'),(60,'60–79%'),(80,'80–100%')) b(lo,label)
  left join (select least(floor(coalesce(r.percentage,0)/20)*20,80)::integer lo,count(*) n from quizbox_competition.official_results r join quizbox_competition.drafts d on d.competition_id=r.competition_id where d.sponsor_id=v group by 1) x on x.lo=b.lo);
end $$;

create or replace function public.qb_sponsor_demographics(p_sponsor_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=quizbox_ops.analytics_sponsor(p_sponsor_id);
begin
 return jsonb_build_object(
  'markets',coalesce((select jsonb_agg(jsonb_build_object('label',x.label,'value',x.n) order by x.n desc,x.label) from (select coalesce(m.name,'Unassigned') label,count(*) n
    from quizbox_competition.registrations g join quizbox_competition.drafts d on d.competition_id=g.competition_id left join public.markets m on m.id=g.market_id where d.sponsor_id=v and g.eligible group by 1) x),'[]'),
  'institutions',coalesce((select jsonb_agg(jsonb_build_object('label',x.label,'value',x.n) order by x.n desc,x.label) from (select i.name label,count(*) n
    from quizbox_competition.registrations g join quizbox_competition.drafts d on d.competition_id=g.competition_id join public.institutions i on i.id=g.institution_id where d.sponsor_id=v and g.eligible group by 1) x),'[]'));
end $$;

-- Hardest questions first: correctness across official (submitted) attempts on the sponsor's own competitions.
create or replace function public.qb_sponsor_question_performance(p_sponsor_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=quizbox_ops.analytics_sponsor(p_sponsor_id);
begin
 return coalesce((select jsonb_agg(jsonb_build_object('question_id',x.question_id,'label',left(regexp_replace(coalesce(q.question_text,'Question'),'\s+',' ','g'),80),'difficulty',coalesce(q.difficulty_label,'-'),'attempts',x.n,'percentage',x.pct) order by x.pct,x.n desc)
  from (select resp.question_id,count(*) n,round(100.0*count(*) filter(where resp.is_correct)/count(*),1) pct
   from quizbox_competition.official_results r join quizbox_competition.drafts d on d.competition_id=r.competition_id join public.responses resp on resp.attempt_id=r.attempt_id
   where d.sponsor_id=v group by resp.question_id order by 3,2 desc limit 20) x join public.questions q on q.id=x.question_id),'[]');
end $$;

revoke all on function quizbox_ops.sponsor_analytics_allowed(uuid),quizbox_ops.analytics_sponsor(uuid),quizbox_ops.analytics_student(uuid) from public,anon,authenticated;
revoke all on function public.qb_student_competition_analytics(uuid),public.qb_student_achievements(uuid),public.qb_sponsor_participation_funnel(uuid),
 public.qb_sponsor_score_distribution(uuid),public.qb_sponsor_demographics(uuid),public.qb_sponsor_question_performance(uuid) from public,anon;
grant execute on function public.qb_student_competition_analytics(uuid),public.qb_student_achievements(uuid),public.qb_sponsor_participation_funnel(uuid),
 public.qb_sponsor_score_distribution(uuid),public.qb_sponsor_demographics(uuid),public.qb_sponsor_question_performance(uuid) to authenticated;

commit;
