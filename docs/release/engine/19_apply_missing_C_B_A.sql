-- APPLY, 18 October 2026: the three migrations missing in production, in order C, B, A. Each has been dry-run on production and succeeded.
-- Each is its own transaction; a failure in one leaves the earlier ones applied and this one unchanged. Safe to run again.

-- ============ C: auth failure hardening (security): 20261010110000_auth_failure_hardening.sql ============
begin;

-- Hardening of the anonymous login-failure telemetry path (review: docs/security/pre-login-functions-review.md; proposal:
-- docs/proposals/qb_auth_failure_hardening.sql). Signature, grants (anon, authenticated) and the RPC-based path are unchanged.
--
--  1. Direct table access: anon/authenticated held every table privilege on public.system_events (including TRUNCATE, which RLS does not
--     cover). Only SECURITY DEFINER functions read/write the table, so direct privileges are revoked (service_role is untouched).
--  2. Input: p_code is no longer stored as free text. Only known Supabase Auth error codes are recorded; anything else becomes AUTH_FAILED.
--  3. No global blinding: a per-source budget (10 events/minute/source) is enforced before the existing global 120/minute backstop, so one
--     caller can no longer exhaust the global cap and hide genuine failures. The source is the Cloudflare-set cf-connecting-ip (not
--     client-controllable: Cloudflare rejects a client-supplied value), falling back to the proxy-appended right-most x-forwarded-for entry.
--     Only a daily-rotating SHA-256 digest of the source is stored (pseudonymised, never the address). Residual risk: an attacker with
--     12+ distinct source addresses can still saturate the global cap.
--  4. Bounded retention: AUTH_FAILURE rows older than 30 days (and per-source budget rows older than a day) are purged in small batches,
--     opportunistically from the function itself (no scheduler dependency) and by a pg_cron job when that extension exists.
--  5. Index: the (event_type, created_at desc) index the global cap and the purge rely on is created idempotently so it is tracked.

create index if not exists system_events_type_idx on public.system_events(event_type, created_at desc);

revoke all on table public.system_events from anon, authenticated;

create table if not exists quizbox_private.auth_failure_budget (
 source text not null,
 window_start timestamptz not null,
 used integer not null default 0,
 primary key (source, window_start)
);
revoke all on table quizbox_private.auth_failure_budget from public, anon, authenticated;

create or replace function quizbox_private.purge_auth_failures(p_max_age interval default interval '30 days', p_batch integer default 500)
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 p_batch:=least(greatest(coalesce(p_batch,500),1),5000);
 delete from public.system_events where ctid in (
  select ctid from public.system_events where event_type='AUTH_FAILURE' and created_at<now()-p_max_age order by created_at limit p_batch);
 get diagnostics removed=row_count;
 delete from quizbox_private.auth_failure_budget where window_start<now()-interval '1 day';
 return removed;
end $$;
revoke all on function quizbox_private.purge_auth_failures(interval,integer) from public, anon, authenticated;

create or replace function public.qb_auth_failure(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare
 c text:=lower(btrim(coalesce(p_code,'')));
 headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 ip text;
 src text;
 win timestamptz:=date_trunc('minute',now());
 n integer;
begin
 -- bounded, opportunistic retention, run before any cap so it also happens during a flood (about 1 call in 50, one small batch)
 if random()<0.02 then perform quizbox_private.purge_auth_failures(); end if;
 ip:=nullif(btrim(headers->>'cf-connecting-ip'),'');
 if ip is null then ip:=nullif(btrim((regexp_split_to_array(coalesce(headers->>'x-forwarded-for',''),'\s*,\s*'))[array_length(regexp_split_to_array(coalesce(headers->>'x-forwarded-for',''),'\s*,\s*'),1)]),''); end if;
 src:=left(encode(extensions.digest(coalesce(ip,'unknown')||':'||current_date::text,'sha256'),'hex'),16);
 -- per-source cap first: a single source can never consume more than its share of the global cap
 insert into quizbox_private.auth_failure_budget(source,window_start,used) values(src,win,1)
  on conflict (source,window_start) do update set used=quizbox_private.auth_failure_budget.used+1 returning used into n;
 if n>10 then return; end if;
 if (select count(*) from public.system_events where event_type='AUTH_FAILURE' and created_at>now()-interval '1 minute')>=120 then return; end if;
 insert into public.system_events(event_type,entity_type,severity,details) values('AUTH_FAILURE','auth','warn',
  jsonb_build_object('code',case when c in (
   'invalid_credentials','email_not_confirmed','phone_not_confirmed','user_banned','user_not_found','over_request_rate_limit',
   'over_email_send_rate_limit','over_sms_send_rate_limit','captcha_failed','validation_failed','request_timeout','unexpected_failure',
   'session_expired','session_not_found','refresh_token_not_found','refresh_token_already_used','mfa_verification_failed',
   'mfa_challenge_expired','weak_password','signup_disabled','email_address_invalid','same_password','provider_disabled','bad_jwt'
  ) then c else 'AUTH_FAILED' end,'source',src));
end $$;

-- CREATE OR REPLACE keeps the ACL (postgres, anon, authenticated); PUBLIC remains revoked. Re-assert it defensively and idempotently.
revoke all on function public.qb_auth_failure(text) from public;
grant execute on function public.qb_auth_failure(text) to anon, authenticated;

-- Optional scheduler: when pg_cron is installed, also purge daily at 03:17 UTC. Absent or not permitted, the opportunistic purge still bounds retention.
do $cron$
begin
 if to_regnamespace('cron') is not null then
  perform cron.schedule('qb-purge-auth-failures','17 3 * * *',$job$select quizbox_private.purge_auth_failures(interval '30 days',5000)$job$);
 end if;
exception when others then
 raise notice 'pg_cron schedule skipped: %',sqlerrm;
end $cron$;

commit;

-- ============ B: school performance: 20261008100000_school_performance.sql ============
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

-- ============ A: core platform (wallets, payments, consent, settings): 20261007100000_core_platform_foundation.sql ============
-- QuizBox core platform foundation (additive only).
-- Provenance: quizbox.ransford.eddy.mensah  (internal marker, non-functional; see docs/IP_PROVENANCE.md)
--
-- Extends the existing identity model (profiles.role + user_capabilities + institution_memberships) with:
-- workspace context, generic account relationships (guardian/sponsor), configuration/feature flags,
-- Coin wallet + immutable ledger, payment intents/events, QPoints (separate from XP and Coins),
-- consent state, notification categories and sync metadata.
-- Collision-safe: public.entitlements (marketplace) and public.notification_deliveries (notification delivery) already exist on
-- hosted databases and are neither created, altered nor dropped here. Core access grants live in public.access_entitlements.
-- Nothing here drops, rewrites or backfills existing data. All client writes go through guarded RPCs.
begin;

create schema if not exists quizbox_core;
revoke all on schema quizbox_core from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Roles: widen the capability vocabulary (additive; existing values stay valid).
-- ---------------------------------------------------------------------------------------------
alter table public.user_capabilities drop constraint if exists user_capabilities_capability_check;
alter table public.user_capabilities add constraint user_capabilities_capability_check check (capability in (
 'super_admin','content_admin','sme_reviewer','senior_sme_reviewer','competition_admin','sponsor_admin','finance_admin',
 'platform_admin','content_manager','competition_manager','support_agent','school_admin','school_owner','sponsor_user','parent_guardian','senior_reviewer'));

create function quizbox_core.is_staff(p_roles text[] default array['super_admin','platform_admin']) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
  and exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active')
  and (exists(select 1 from public.profiles where id=auth.uid() and lower(role::text)='owner')
   or exists(select 1 from public.user_capabilities where user_id=auth.uid() and active and capability = any(p_roles)));
$$;

create function quizbox_core.audit(p_action text,p_entity_type text,p_entity uuid,p_details jsonb default '{}') returns void
language sql security definer set search_path='' as $$
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details)
 values(auth.uid(),p_action,p_entity_type,p_entity,'pass',coalesce(p_details,'{}'));
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Configuration / feature flags (reuse-first: one small table, scoped, defaults seeded safe).
-- ---------------------------------------------------------------------------------------------
create table public.platform_settings (
 id uuid primary key default gen_random_uuid(),
 key text not null check (key ~ '^[a-z0-9_.]+$'),
 scope_type text not null default 'global' check (scope_type in ('global','market','curriculum','institution')),
 scope_id uuid, value jsonb not null,
 description text not null default '', updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
 check ((scope_type='global') = (scope_id is null))
);
create unique index platform_settings_scope_key on public.platform_settings(key,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'));

insert into public.platform_settings(key,value,description) values
 ('flags.student_self_pay','false','Learners may fund their own wallet'),
 ('flags.paid_challenges','false','Paid competitions/challenges'),
 ('flags.offline_learning','false','Offline-eligible learning content'),
 ('flags.guardian_consent_required','false','Guardian link needs learner/guardian consent before it activates'),
 ('flags.sponsor_consent_required','true','Sponsor link needs learner (or guardian) consent before it activates'),
 ('flags.buy_coins_enabled','false','Coin purchase intents may be created'),
 ('reward_rules','{}','Map rule_key -> {"xp":n,"qpoints":n,"enabled":bool}; empty means nothing is awarded'),
 ('payment_fees','{}','Fee configuration by provider/method; interpreted by the payment adapter'),
 ('payments.providers','[]','Enabled payment provider codes; empty means no provider can be used'),
 ('coins.spend_order','["promotional","purchased"]','Order in which Coin buckets are consumed by spend'),
 ('coins.unit_price_minor','{}','Minor currency units charged per Coin, e.g. {"GHS":100} (reference convention 1 Coin = GH¢1)'),
 ('assessment_review_policy','{"default":"after_submit"}','Default review/result-release policy'),
 ('safety.consent_pending_blocked_features','["public_challenges","public_leaderboards","chat","sponsored_prizes","public_discoverability"]','Features blocked while consent is pending or withdrawn'),
 ('proficiency.bands','{"source":"Ghana CCP","bands":[{"code":"highly_proficient","label":"Highly Proficient","min":80},{"code":"proficient","label":"Proficient","min":68},{"code":"approaching_proficiency","label":"Approaching Proficiency","min":54},{"code":"developing","label":"Developing","min":40},{"code":"emerging","label":"Emerging","min":0}]}','Percentage bands, lowest band min must be 0; override per curriculum scope');

create function quizbox_core.setting(p_key text,p_scope_type text default 'global',p_scope uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select value from public.platform_settings where key=p_key and scope_type=p_scope_type and scope_id is not distinct from p_scope),
  (select value from public.platform_settings where key=p_key and scope_type='global'));
$$;
create function quizbox_core.flag(p_key text,p_scope_type text default 'global',p_scope uuid default null) returns boolean
language sql stable security definer set search_path='' as $$ select coalesce(quizbox_core.setting(p_key,p_scope_type,p_scope)='true'::jsonb,false); $$;

create function public.qb_setting_set(p_key text,p_value jsonb,p_scope_type text default 'global',p_scope uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.platform_settings;
begin
 if not quizbox_core.is_staff() then raise exception 'QB_FORBIDDEN'; end if;
 if p_value is null then raise exception 'QB_INVALID_SETTING'; end if;
 insert into public.platform_settings(key,scope_type,scope_id,value,updated_by) values(p_key,p_scope_type,p_scope,p_value,auth.uid())
 on conflict(key,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'))
 do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now() returning * into r;
 perform quizbox_core.audit('setting.set','platform_settings',r.id,jsonb_build_object('key',p_key,'scope_type',p_scope_type));
 return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Account relationships (guardian, sponsor, future institutional) - one extensible model.
--    source_user = guardian/sponsor, target_user = ward/student.
-- ---------------------------------------------------------------------------------------------
create table public.account_relationships (
 id uuid primary key default gen_random_uuid(),
 source_user_id uuid not null references public.profiles(id) on delete cascade,
 target_user_id uuid not null references public.profiles(id) on delete cascade,
 relationship_type text not null check (relationship_type in ('guardian','sponsor','institutional')),
 status text not null default 'requested' check (status in ('requested','pending_verification','active','suspended','revoked')),
 can_fund boolean not null default false, can_view_progress boolean not null default false, can_manage_account boolean not null default false,
 consent_status text not null default 'pending' check (consent_status in ('not_required','pending','granted','withdrawn')),
 verified_by uuid references public.profiles(id), verified_at timestamptz,
 valid_from timestamptz not null default now(), valid_until timestamptz,
 created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (source_user_id <> target_user_id), check (valid_until is null or valid_until > valid_from),
 check (status <> 'active' or verified_by is not null)
);
create unique index account_relationships_live on public.account_relationships(source_user_id,target_user_id,relationship_type) where status <> 'revoked';
create index account_relationships_target on public.account_relationships(target_user_id,status);

-- True only for an active, in-window, consented relationship that carries the permission.
create function quizbox_core.relationship_allows(p_source uuid,p_target uuid,p_perm text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_perm in ('can_fund','can_view_progress','can_manage_account') and exists(
  select 1 from public.account_relationships r
  where r.source_user_id=p_source and r.target_user_id=p_target and r.status='active'
   and r.valid_from<=now() and (r.valid_until is null or r.valid_until>now())
   and r.consent_status in ('granted','not_required')
   and case p_perm when 'can_fund' then r.can_fund when 'can_view_progress' then r.can_view_progress else r.can_manage_account end);
$$;
create function public.qb_relationship_allows(p_target uuid,p_perm text) returns boolean
language sql stable security definer set search_path='' as $$ select quizbox_core.relationship_allows(auth.uid(),p_target,p_perm); $$;

create function public.qb_relationship_request(p_target uuid,p_type text,p_can_fund boolean default false,p_can_view_progress boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.account_relationships;
begin
 if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED'; end if;
 if p_type not in ('guardian','sponsor') then raise exception 'QB_INVALID_RELATIONSHIP_TYPE'; end if;
 if p_target=auth.uid() or not exists(select 1 from public.profiles where id=p_target) then raise exception 'QB_INVALID_TARGET'; end if;
 -- Requests never self-grant account management; staff verification decides the final flags.
 insert into public.account_relationships(source_user_id,target_user_id,relationship_type,status,can_fund,can_view_progress,consent_status,created_by)
 values(auth.uid(),p_target,p_type,'pending_verification',p_can_fund,p_can_view_progress,'pending',auth.uid()) returning * into r;
 perform quizbox_core.audit('relationship.request','account_relationships',r.id,jsonb_build_object('type',p_type));
 return to_jsonb(r);
end $$;

-- Actions: verify (staff; may set final flags), consent/withdraw (target), suspend/revoke (staff, or either party for revoke), reinstate (staff).
create function public.qb_relationship_decide(p_id uuid,p_action text,p_flags jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.account_relationships; staff boolean:=quizbox_core.is_staff(array['super_admin','platform_admin','support_agent']); need_consent boolean;
begin
 select * into r from public.account_relationships where id=p_id for update;
 if not found then raise exception 'QB_NOT_FOUND'; end if;
 if auth.uid() is null or not (staff or auth.uid() in (r.source_user_id,r.target_user_id)) then raise exception 'QB_FORBIDDEN'; end if;
 if p_action='verify' then
  if not staff then raise exception 'QB_FORBIDDEN'; end if;
  if r.status not in ('requested','pending_verification') then raise exception 'QB_INVALID_TRANSITION'; end if;
  need_consent:=quizbox_core.flag('flags.'||r.relationship_type||'_consent_required');
  if need_consent and r.consent_status<>'granted' then raise exception 'QB_CONSENT_REQUIRED'; end if;
  update public.account_relationships set status='active',verified_by=auth.uid(),verified_at=now(),
   can_fund=coalesce((p_flags->>'can_fund')::boolean,can_fund),can_view_progress=coalesce((p_flags->>'can_view_progress')::boolean,can_view_progress),
   can_manage_account=coalesce((p_flags->>'can_manage_account')::boolean,false),
   consent_status=case when need_consent then consent_status else case when consent_status='pending' then 'not_required' else consent_status end end,
   updated_at=now() where id=p_id returning * into r;
 elsif p_action='consent' then
  if auth.uid()<>r.target_user_id and not staff then raise exception 'QB_FORBIDDEN'; end if;
  if r.status='revoked' then raise exception 'QB_INVALID_TRANSITION'; end if;
  update public.account_relationships set consent_status='granted',updated_at=now() where id=p_id returning * into r;
 elsif p_action='withdraw' then
  if auth.uid()<>r.target_user_id and not staff then raise exception 'QB_FORBIDDEN'; end if;
  update public.account_relationships set consent_status='withdrawn',status=case when status='active' then 'suspended' else status end,updated_at=now() where id=p_id returning * into r;
 elsif p_action='suspend' then
  if not staff then raise exception 'QB_FORBIDDEN'; end if;
  update public.account_relationships set status='suspended',updated_at=now() where id=p_id and status='active' returning * into r;
  if not found then raise exception 'QB_INVALID_TRANSITION'; end if;
 elsif p_action='reinstate' then
  if not staff then raise exception 'QB_FORBIDDEN'; end if;
  update public.account_relationships set status='active',updated_at=now() where id=p_id and status='suspended' returning * into r;
  if not found then raise exception 'QB_INVALID_TRANSITION'; end if;
 elsif p_action='revoke' then
  update public.account_relationships set status='revoked',updated_at=now() where id=p_id and status<>'revoked' returning * into r;
  if not found then raise exception 'QB_INVALID_TRANSITION'; end if;
 else raise exception 'QB_INVALID_ACTION'; end if;
 perform quizbox_core.audit('relationship.'||p_action,'account_relationships',r.id,jsonb_build_object('type',r.relationship_type,'status',r.status));
 return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Roles, workspace context and role/workspace switching.
-- ---------------------------------------------------------------------------------------------
create table public.user_workspace_context (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 active_role text, active_institution_id uuid references public.institutions(id) on delete set null,
 last_app text, updated_at timestamptz not null default now()
);

create function quizbox_core.held_roles(p_user uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct x order by x),'{}') from (
  select case lower(role::text) when 'student' then 'student' when 'teacher' then 'teacher' when 'admin' then 'platform_admin'
    when 'owner' then 'super_admin' when 'sponsor' then 'sponsor_user' when 'support' then 'support_agent' end x
   from public.profiles where id=p_user and lower(status::text)='active'
  union select case capability when 'sme_reviewer' then 'sme_reviewer' when 'senior_sme_reviewer' then 'senior_reviewer' when 'content_admin' then 'content_manager'
    when 'competition_admin' then 'competition_manager' when 'sponsor_admin' then 'sponsor_admin' else capability end
   from public.user_capabilities c where user_id=p_user and active and exists(select 1 from public.profiles where id=p_user and lower(status::text)='active')
  union select case m.role::text when 'student' then 'student' when 'teacher' then 'teacher' when 'admin' then 'school_admin' when 'owner' then 'school_owner' end
   from public.institution_memberships m where m.user_id=p_user and m.status::text='active'
  union select 'parent_guardian' from public.account_relationships where source_user_id=p_user and relationship_type='guardian' and status='active'
  union select 'sponsor_user' from public.account_relationships where source_user_id=p_user and relationship_type='sponsor' and status='active'
 ) s where x is not null;
$$;

create function public.qb_my_roles() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'roles',to_jsonb(quizbox_core.held_roles(auth.uid())),
  'institutions',coalesce((select jsonb_agg(jsonb_build_object('institution_id',m.institution_id,'name',i.name,'role',m.role)) from public.institution_memberships m join public.institutions i on i.id=m.institution_id where m.user_id=auth.uid() and m.status::text='active'),'[]'),
  'context',coalesce((select to_jsonb(c) from public.user_workspace_context c where c.user_id=auth.uid()),'{}'),
  'onboarding_completed',(select onboarding_completed_at is not null from public.profiles where id=auth.uid()));
$$;

create function public.qb_switch_workspace(p_role text,p_institution uuid default null,p_app text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.user_workspace_context;
begin
 if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED'; end if;
 if not (p_role = any(quizbox_core.held_roles(auth.uid()))) then raise exception 'QB_ROLE_NOT_HELD'; end if;
 if p_institution is not null and not exists(select 1 from public.institution_memberships m where m.institution_id=p_institution and m.user_id=auth.uid() and m.status::text='active') then
  raise exception 'QB_NOT_A_MEMBER'; end if;
 insert into public.user_workspace_context(user_id,active_role,active_institution_id,last_app) values(auth.uid(),p_role,p_institution,left(p_app,60))
 on conflict(user_id) do update set active_role=excluded.active_role,active_institution_id=excluded.active_institution_id,last_app=coalesce(excluded.last_app,public.user_workspace_context.last_app),updated_at=now()
 returning * into c;
 return to_jsonb(c);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Wallet + immutable Coin ledger (Coins are platform-use units, never QPoints, never withdrawable cash).
-- ---------------------------------------------------------------------------------------------
create table public.wallets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references public.profiles(id) on delete restrict,
 purchased_balance bigint not null default 0 check (purchased_balance>=0),
 promotional_balance bigint not null default 0 check (promotional_balance>=0),
 status text not null default 'active' check (status in ('active','frozen')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.coin_transactions (
 id uuid primary key default gen_random_uuid(),
 wallet_id uuid not null references public.wallets(id) on delete restrict,
 bucket text not null check (bucket in ('purchased','promotional')),
 kind text not null check (kind in ('purchase_credit','promo_grant','spend','refund','reversal','manual_adjustment','expiry')),
 amount bigint not null check (amount<>0), balance_after bigint not null check (balance_after>=0),
 payment_intent_id uuid, idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
 actor_id uuid references public.profiles(id), reason text not null default '', metadata jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index coin_transactions_wallet on public.coin_transactions(wallet_id,created_at desc);
create table public.access_entitlements (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null, source text not null default 'coin_spend', source_ref text,
 valid_from timestamptz not null default now(), valid_until timestamptz,
 status text not null default 'active' check (status in ('active','expired','revoked')), metadata jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index access_entitlements_user on public.access_entitlements(user_id,status);
create unique index access_entitlements_source_ref on public.access_entitlements(user_id,source,source_ref) where source_ref is not null;

create function quizbox_core.immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'QB_IMMUTABLE_HISTORY'; end $$;
create trigger coin_transactions_immutable before update or delete on public.coin_transactions for each row execute function quizbox_core.immutable();

create function quizbox_core.ensure_wallet(p_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 insert into public.wallets(user_id) values(p_user) on conflict(user_id) do nothing;
 select id into w from public.wallets where user_id=p_user;
 return w;
end $$;

-- The only function that changes a balance. Replays of the same idempotency key return the original row.
create function quizbox_core.post_coin(p_wallet uuid,p_bucket text,p_amount bigint,p_kind text,p_idem text,p_intent uuid default null,p_reason text default '',p_actor uuid default null,p_metadata jsonb default '{}') returns public.coin_transactions
language plpgsql security definer set search_path='' as $$
declare t public.coin_transactions; w public.wallets; nb bigint;
begin
 select * into t from public.coin_transactions where idempotency_key=p_idem;
 if found then
  if t.wallet_id<>p_wallet or t.amount<>p_amount or t.bucket<>p_bucket then raise exception 'QB_IDEMPOTENCY_CONFLICT'; end if;
  return t;
 end if;
 select * into w from public.wallets where id=p_wallet for update;
 if not found then raise exception 'QB_WALLET_NOT_FOUND'; end if;
 if w.status<>'active' and p_kind not in ('reversal','refund') then raise exception 'QB_WALLET_FROZEN'; end if;
 if p_bucket='purchased' then update public.wallets set purchased_balance=purchased_balance+p_amount,updated_at=now() where id=p_wallet returning purchased_balance into nb;
 else update public.wallets set promotional_balance=promotional_balance+p_amount,updated_at=now() where id=p_wallet returning promotional_balance into nb; end if;
 insert into public.coin_transactions(wallet_id,bucket,kind,amount,balance_after,payment_intent_id,idempotency_key,actor_id,reason,metadata)
 values(p_wallet,p_bucket,p_kind,p_amount,nb,p_intent,p_idem,p_actor,left(p_reason,300),coalesce(p_metadata,'{}')) returning * into t;
 return t;
exception when check_violation then raise exception 'QB_INSUFFICIENT_BALANCE';
end $$;

create function public.qb_wallet_adjust(p_user uuid,p_bucket text,p_amount bigint,p_reason text,p_idem text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.coin_transactions;
begin
 if not quizbox_core.is_staff(array['super_admin','finance_admin']) then raise exception 'QB_FORBIDDEN'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'QB_REASON_REQUIRED'; end if;
 t:=quizbox_core.post_coin(quizbox_core.ensure_wallet(p_user),p_bucket,p_amount,'manual_adjustment',p_idem,null,p_reason,auth.uid());
 perform quizbox_core.audit('wallet.adjust','coin_transactions',t.id,jsonb_build_object('user',p_user,'bucket',p_bucket,'amount',p_amount));
 return to_jsonb(t);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5b. Coin spend primitive. Server-authorised only (service_role): the caller decides price/order, the ledger enforces integrity.
--     One atomic transaction; configured bucket order (promotional first by default); idempotent; never overdraws;
--     optional entitlement keyed by order reference (an order reference can be fulfilled once).
-- ---------------------------------------------------------------------------------------------
create function public.qb_coin_spend(p_user uuid,p_amount bigint,p_purpose text,p_ref text,p_idem text,p_entitlement jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.wallets; bucket text; part bigint; remaining bigint:=p_amount; t public.coin_transactions; spent jsonb:='{}'; ent uuid; prior record;
begin
 if p_amount is null or p_amount<=0 then raise exception 'QB_INVALID_AMOUNT'; end if;
 if length(trim(coalesce(p_purpose,'')))<3 or length(trim(coalesce(p_ref,'')))<1 or length(coalesce(p_idem,'')) not between 8 and 190 then raise exception 'QB_INVALID_SPEND'; end if;
 -- Entitlement input is validated up front (before any lock or write) so malformed input fails with a controlled QB_ code, never a raw Postgres error.
 if p_entitlement is not null then
  if jsonb_typeof(p_entitlement)<>'object' then raise exception 'QB_INVALID_ENTITLEMENT'; end if;
  if coalesce(jsonb_typeof(p_entitlement->'kind'),'')<>'string' or length(trim(coalesce(p_entitlement->>'kind','')))=0 then raise exception 'QB_INVALID_ENTITLEMENT_KIND'; end if;
  if jsonb_typeof(p_entitlement->'valid_until') is not null and jsonb_typeof(p_entitlement->'valid_until')<>'null' then
   if jsonb_typeof(p_entitlement->'valid_until')<>'string' then raise exception 'QB_INVALID_ENTITLEMENT_VALID_UNTIL'; end if;
   if length(trim(p_entitlement->>'valid_until'))>0 then
    begin perform (p_entitlement->>'valid_until')::timestamptz;
    exception when others then raise exception 'QB_INVALID_ENTITLEMENT_VALID_UNTIL'; end;
   end if;
  end if;
  if jsonb_typeof(p_entitlement->'metadata') is not null and jsonb_typeof(p_entitlement->'metadata') not in ('object','null') then raise exception 'QB_INVALID_ENTITLEMENT_METADATA'; end if;
 end if;
 select * into w from public.wallets where user_id=p_user for update;
 if not found then raise exception 'QB_INSUFFICIENT_BALANCE'; end if;
 -- Replay: same key returns the original outcome; a different amount under the same key is a conflict.
 select coalesce(sum(-amount),0) as total,count(*) as n into prior from public.coin_transactions where wallet_id=w.id and kind='spend' and idempotency_key like p_idem||':%';
 if prior.n>0 then
  if prior.total<>p_amount then raise exception 'QB_IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('spent',p_amount,'duplicate',true,'entitlement_id',(select id from public.access_entitlements where user_id=p_user and source='coin_spend' and source_ref=p_ref));
 end if;
 if w.purchased_balance+w.promotional_balance<p_amount then raise exception 'QB_INSUFFICIENT_BALANCE'; end if;
 for bucket in select jsonb_array_elements_text(coalesce(quizbox_core.setting('coins.spend_order'),'["promotional","purchased"]'::jsonb)) loop
  exit when remaining=0;
  continue when bucket not in ('purchased','promotional');
  part:=least(remaining,case bucket when 'purchased' then w.purchased_balance else w.promotional_balance end);
  if part>0 then
   t:=quizbox_core.post_coin(w.id,bucket,-part,'spend',p_idem||':'||bucket,null,p_purpose,auth.uid(),jsonb_build_object('ref',p_ref));
   spent:=spent||jsonb_build_object(bucket,part); remaining:=remaining-part;
  end if;
 end loop;
 if remaining<>0 then raise exception 'QB_INSUFFICIENT_BALANCE'; end if;
 if p_entitlement is not null then
  begin
   insert into public.access_entitlements(user_id,kind,source,source_ref,valid_until,metadata)
   values(p_user,p_entitlement->>'kind','coin_spend',p_ref,nullif(p_entitlement->>'valid_until','')::timestamptz,case when jsonb_typeof(p_entitlement->'metadata')='object' then p_entitlement->'metadata' else '{}'::jsonb end) returning id into ent;
  exception when unique_violation then raise exception 'QB_ORDER_ALREADY_FULFILLED'; end;
 end if;
 perform quizbox_core.audit('coins.spend','coin_transactions',t.id,jsonb_build_object('user',p_user,'amount',p_amount,'purpose',p_purpose,'ref',p_ref,'split',spent));
 return jsonb_build_object('spent',p_amount,'split',spent,'duplicate',false,'entitlement_id',ent);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5c. Learner progress visibility for non-owners: one predicate, reused by the existing progress RPCs.
--     Owner, Super Admin, or an active, in-window, consented relationship whose can_view_progress is true.
--     can_fund never implies visibility. Withdrawn learner consent blocks relationship-based access.
--     Teacher/school visibility keeps flowing through the existing class/tenant RPCs (qb_teacher_insights, gradebook).
-- ---------------------------------------------------------------------------------------------
create function quizbox_core.can_view_progress(p_viewer uuid,p_learner uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin -- plpgsql: learner_consent is created later in this migration
 return p_viewer is not null and p_learner is not null and (
  p_viewer=p_learner
  or quizbox_sme.has_capability('super_admin')
  or (quizbox_core.relationship_allows(p_viewer,p_learner,'can_view_progress')
      and coalesce((select status from public.learner_consent where user_id=p_learner),'not_required')<>'withdrawn'));
end $$;
-- Existing choke point for p_student_id RPCs (qb_student_achievements, qb_student_competition_analytics): extended, not duplicated.
create or replace function quizbox_ops.analytics_student(p_student uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare v uuid:=coalesce(p_student,auth.uid());
begin
 if auth.uid() is null or not quizbox_core.can_view_progress(auth.uid(),v) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return v;
end $$;
-- Student insights gains an optional learner id (default: self) behind the same predicate. Zero-argument callers are unchanged.
drop function public.qb_student_insights();
create function public.qb_student_insights(p_student_id uuid default auth.uid()) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not quizbox_core.can_view_progress(auth.uid(),coalesce(p_student_id,auth.uid())) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return quizbox_ops.student_insights(coalesce(p_student_id,auth.uid()));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Payments: intent -> provider -> verified event -> settlement -> wallet credit. Payer may differ from beneficiary.
-- ---------------------------------------------------------------------------------------------
create table public.payment_intents (
 id uuid primary key default gen_random_uuid(),
 reference text not null unique default 'QB-'||replace(gen_random_uuid()::text,'-',''),
 idempotency_key text not null check (length(idempotency_key) between 8 and 200),
 payer_user_id uuid not null references public.profiles(id), beneficiary_user_id uuid not null references public.profiles(id),
 provider text not null, method text not null check (method in ('mobile_money','card','bank_transfer')),
 currency_code text not null references public.currencies(code), amount_minor bigint not null check (amount_minor>0), coins bigint not null check (coins>0),
 fee_minor bigint not null default 0 check (fee_minor>=0),
 status text not null default 'initiated' check (status in ('initiated','pending','awaiting_approval','processing','successful','failed','cancelled','expired','reversed','refunded')),
 provider_reference text, failure_reason text, credited_tx_id uuid references public.coin_transactions(id),
 reconciliation_status text not null default 'unreconciled' check (reconciliation_status in ('unreconciled','matched','mismatch','manual_review','resolved')),
 expires_at timestamptz, settled_at timestamptz, metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(payer_user_id,idempotency_key)
);
create unique index payment_intents_provider_ref on public.payment_intents(provider,provider_reference) where provider_reference is not null;
create index payment_intents_beneficiary on public.payment_intents(beneficiary_user_id,created_at desc);
create index payment_intents_recon on public.payment_intents(reconciliation_status) where reconciliation_status in ('mismatch','manual_review');
create table public.payment_events (
 id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null, reference text,
 reported_status text not null, signature_verified boolean not null, payload jsonb not null default '{}',
 outcome text not null default 'received', received_at timestamptz not null default now(),
 unique(provider,provider_event_id)
);
create index payment_events_reference on public.payment_events(reference);

create function public.qb_payment_intent_create(p_beneficiary uuid,p_coins bigint,p_currency text,p_provider text,p_method text,p_idem text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare unit bigint; i public.payment_intents; payer uuid:=auth.uid();
begin
 if payer is null then raise exception 'QB_AUTH_REQUIRED'; end if;
 if not quizbox_core.flag('flags.buy_coins_enabled') then raise exception 'QB_FEATURE_DISABLED'; end if;
 if p_provider is null or not (quizbox_core.setting('payments.providers') ? p_provider) then raise exception 'QB_PROVIDER_NOT_ENABLED'; end if;
 if p_coins is null or p_coins<=0 then raise exception 'QB_INVALID_AMOUNT'; end if;
 if payer=p_beneficiary then
  if not quizbox_core.flag('flags.student_self_pay') then raise exception 'QB_SELF_PAY_DISABLED'; end if;
 elsif not quizbox_core.relationship_allows(payer,p_beneficiary,'can_fund') then raise exception 'QB_FUNDING_NOT_PERMITTED'; end if;
 if not exists(select 1 from public.profiles where id=p_beneficiary and lower(status::text)='active') then raise exception 'QB_INVALID_BENEFICIARY'; end if;
 unit:=(quizbox_core.setting('coins.unit_price_minor')->>p_currency)::bigint;
 if unit is null or unit<=0 then raise exception 'QB_PRICING_NOT_CONFIGURED'; end if;
 select * into i from public.payment_intents where payer_user_id=payer and idempotency_key=p_idem;
 if found then
  if i.beneficiary_user_id<>p_beneficiary or i.coins<>p_coins or i.currency_code<>p_currency or i.provider<>p_provider then raise exception 'QB_IDEMPOTENCY_CONFLICT'; end if;
  return to_jsonb(i);
 end if;
 insert into public.payment_intents(idempotency_key,payer_user_id,beneficiary_user_id,provider,method,currency_code,amount_minor,coins,expires_at)
 values(p_idem,payer,p_beneficiary,p_provider,p_method,p_currency,p_coins*unit,p_coins,now()+interval '30 minutes') returning * into i;
 perform quizbox_core.audit('payment.intent','payment_intents',i.id,jsonb_build_object('beneficiary',p_beneficiary,'coins',p_coins));
 return to_jsonb(i);
end $$;

-- Server-only. The caller (webhook handler) must already have verified the provider signature / re-queried the provider.
-- Frontend redirects are never an input here. Duplicate events and duplicate settlement are no-ops.
create function public.qb_payment_apply_event(p_provider text,p_event_id text,p_reference text,p_status text,p_provider_reference text,p_amount_minor bigint,p_currency text,p_verified boolean,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.payment_intents; ev uuid; tx public.coin_transactions; v_out text;
begin
 if p_status not in ('pending','awaiting_approval','processing','successful','failed','cancelled','expired','reversed','refunded') then raise exception 'QB_INVALID_STATUS'; end if;
 insert into public.payment_events(provider,provider_event_id,reference,reported_status,signature_verified,payload)
 values(p_provider,p_event_id,p_reference,p_status,coalesce(p_verified,false),coalesce(p_payload,'{}')) on conflict(provider,provider_event_id) do nothing returning id into ev;
 if ev is null then return jsonb_build_object('outcome','duplicate_event'); end if;
 if not coalesce(p_verified,false) then
  update public.payment_events set outcome='rejected_unverified' where id=ev; return jsonb_build_object('outcome','rejected_unverified');
 end if;
 select * into i from public.payment_intents where reference=p_reference and provider=p_provider for update;
 if not found then update public.payment_events set outcome='unknown_reference' where id=ev; return jsonb_build_object('outcome','unknown_reference'); end if;

 if p_status='successful' then
  if i.credited_tx_id is not null then v_out:='already_settled';
  elsif p_amount_minor is distinct from i.amount_minor or p_currency is distinct from i.currency_code then
   update public.payment_intents set reconciliation_status='mismatch',updated_at=now() where id=i.id; v_out:='amount_mismatch';
  elsif i.status in ('reversed','refunded') then v_out:='ignored_after_reversal';
  else
   tx:=quizbox_core.post_coin(quizbox_core.ensure_wallet(i.beneficiary_user_id),'purchased',i.coins,'purchase_credit','payment:'||i.id,i.id,'Coin purchase '||i.reference);
   update public.payment_intents set status='successful',provider_reference=coalesce(p_provider_reference,provider_reference),credited_tx_id=tx.id,settled_at=now(),
    reconciliation_status=case when status in ('failed','cancelled','expired') then 'manual_review' else 'matched' end,updated_at=now() where id=i.id;
   perform quizbox_core.audit('payment.credit','payment_intents',i.id,jsonb_build_object('coins',i.coins,'beneficiary',i.beneficiary_user_id));
   v_out:='credited';
  end if;
 elsif p_status in ('reversed','refunded') then
  if i.credited_tx_id is null or i.status in ('reversed','refunded') then v_out:='ignored';
  else
   begin
    perform quizbox_core.post_coin(quizbox_core.ensure_wallet(i.beneficiary_user_id),'purchased',-i.coins,case p_status when 'refunded' then 'refund' else 'reversal' end,p_status||':'||i.id,i.id,'Payment '||p_status||' '||i.reference);
    update public.payment_intents set status=p_status,updated_at=now() where id=i.id;
    perform quizbox_core.audit('payment.'||p_status,'payment_intents',i.id,jsonb_build_object('coins',i.coins));
    v_out:=p_status;
   exception when others then
    if sqlerrm like '%QB_INSUFFICIENT_BALANCE%' then update public.payment_intents set reconciliation_status='manual_review',updated_at=now() where id=i.id; v_out:='insufficient_balance_manual_review';
    else raise; end if;
   end;
  end if;
 else
  -- Non-final/failed progress never moves a settled intent backwards.
  if i.status in ('successful','reversed','refunded') then v_out:='ignored_after_settlement';
  else update public.payment_intents set status=p_status,provider_reference=coalesce(p_provider_reference,provider_reference),updated_at=now() where id=i.id; v_out:='status_updated'; end if;
 end if;
 update public.payment_events set outcome=v_out where id=ev;
 return jsonb_build_object('outcome',v_out);
end $$;

create function public.qb_payment_reconcile(p_intent uuid,p_status text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.payment_intents;
begin
 if not quizbox_core.is_staff(array['super_admin','finance_admin']) then raise exception 'QB_FORBIDDEN'; end if;
 if p_status not in ('matched','mismatch','manual_review','resolved') or length(trim(coalesce(p_note,'')))<5 then raise exception 'QB_INVALID_RECONCILIATION'; end if;
 update public.payment_intents set reconciliation_status=p_status,updated_at=now() where id=p_intent returning * into i;
 if not found then raise exception 'QB_NOT_FOUND'; end if;
 perform quizbox_core.audit('payment.reconcile','payment_intents',i.id,jsonb_build_object('status',p_status,'note',left(p_note,300)));
 return to_jsonb(i);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. QPoints, badges and streaks. XP stays in xp_transactions; Coins never merge with QPoints.
-- ---------------------------------------------------------------------------------------------
create table public.qpoint_transactions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete restrict,
 amount integer not null check (amount<>0), rule_key text not null, idempotency_key text not null unique,
 metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index qpoint_transactions_user on public.qpoint_transactions(user_id,created_at desc);
create trigger qpoint_transactions_immutable before update or delete on public.qpoint_transactions for each row execute function quizbox_core.immutable();
create view public.qpoint_balances with (security_invoker=true) as select user_id,sum(amount)::bigint as balance from public.qpoint_transactions group by user_id;
create table public.badge_definitions (code text primary key check (code ~ '^[a-z0-9_]+$'),name text not null,description text not null default '',criteria jsonb not null default '{}',active boolean not null default true);
create table public.user_badges (user_id uuid not null references public.profiles(id) on delete cascade,badge_code text not null references public.badge_definitions(code),awarded_at timestamptz not null default now(),source jsonb not null default '{}',primary key(user_id,badge_code));
create table public.user_streaks (user_id uuid primary key references public.profiles(id) on delete cascade,current_streak integer not null default 0 check (current_streak>=0),longest_streak integer not null default 0 check (longest_streak>=0),last_activity_date date,updated_at timestamptz not null default now());

-- Amount comes only from the reward_rules setting; an absent/disabled rule awards nothing.
create function public.qb_qpoints_award(p_user uuid,p_rule text,p_idem text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rule jsonb:=quizbox_core.setting('reward_rules')->p_rule; amt integer; t public.qpoint_transactions;
begin
 if rule is null or coalesce((rule->>'enabled')::boolean,true) is false then return jsonb_build_object('awarded',0); end if;
 amt:=coalesce((rule->>'qpoints')::integer,0);
 if amt<=0 then return jsonb_build_object('awarded',0); end if;
 insert into public.qpoint_transactions(user_id,amount,rule_key,idempotency_key) values(p_user,amt,p_rule,p_idem) on conflict(idempotency_key) do nothing returning * into t;
 return jsonb_build_object('awarded',case when t.id is null then 0 else amt end,'duplicate',t.id is null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Consent / safety state (policy-driven, no global age threshold).
-- ---------------------------------------------------------------------------------------------
create table public.learner_consent (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 status text not null default 'not_required' check (status in ('not_required','pending','granted','withdrawn')),
 policy_ref text, decided_by uuid references public.profiles(id), decided_at timestamptz, updated_at timestamptz not null default now()
);
create function public.qb_consent_set(p_user uuid,p_status text,p_policy_ref text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.learner_consent;
begin
 if p_status not in ('not_required','pending','granted','withdrawn') then raise exception 'QB_INVALID_STATUS'; end if;
 if not (quizbox_core.is_staff(array['super_admin','platform_admin','support_agent'])
  or (exists(select 1 from public.account_relationships r where r.source_user_id=auth.uid() and r.target_user_id=p_user and r.relationship_type='guardian' and r.status='active'))) then raise exception 'QB_FORBIDDEN'; end if;
 insert into public.learner_consent(user_id,status,policy_ref,decided_by,decided_at) values(p_user,p_status,p_policy_ref,auth.uid(),now())
 on conflict(user_id) do update set status=excluded.status,policy_ref=excluded.policy_ref,decided_by=excluded.decided_by,decided_at=excluded.decided_at,updated_at=now() returning * into c;
 perform quizbox_core.audit('consent.set','learner_consent',null,jsonb_build_object('user',p_user,'status',p_status));
 return to_jsonb(c);
end $$;
create function public.qb_feature_allowed(p_feature text) returns boolean language sql stable security definer set search_path='' as $$
 select not (coalesce((select status from public.learner_consent where user_id=auth.uid()),'not_required') in ('pending','withdrawn')
  and quizbox_core.setting('safety.consent_pending_blocked_features') ? p_feature);
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. Notification category (existing public.notification_deliveries is reused as-is) and offline/sync metadata.
-- ---------------------------------------------------------------------------------------------
alter table public.notifications add column if not exists category text not null default 'system'
 check (category in ('assignment','assessment','class','guardian','sponsor','payment','reward','content_review','school_notice','system'));

alter table public.attempts add column if not exists sync_status text not null default 'synced' check (sync_status in ('saved','saving','offline','waiting_to_sync','synchronising','synced','failed'));
alter table public.attempts add column if not exists client_updated_at timestamptz;
alter table public.responses add column if not exists sync_status text not null default 'synced' check (sync_status in ('saved','saving','offline','waiting_to_sync','synchronising','synced','failed'));

-- ---------------------------------------------------------------------------------------------
-- 10. Grants / RLS: fail closed. Clients read their own rows; every write is an RPC above.
-- ---------------------------------------------------------------------------------------------
do $$ declare t text; own text; begin
 foreach t in array array['platform_settings','account_relationships','user_workspace_context','wallets','coin_transactions','access_entitlements','payment_intents','payment_events',
  'qpoint_transactions','badge_definitions','user_badges','user_streaks','learner_consent'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  own:=case t
   when 'platform_settings' then 'true' when 'badge_definitions' then 'active'
   when 'account_relationships' then 'source_user_id=auth.uid() or target_user_id=auth.uid()'
   when 'wallets' then 'user_id=auth.uid()'
   when 'coin_transactions' then 'exists(select 1 from public.wallets w where w.id=wallet_id and w.user_id=auth.uid())'
   when 'payment_intents' then 'payer_user_id=auth.uid() or beneficiary_user_id=auth.uid()'
   when 'payment_events' then 'false'
   else 'user_id=auth.uid()' end;
  execute format('create policy core_read on public.%I for select to authenticated using (%s or quizbox_core.is_staff(array[''super_admin'',''platform_admin'',''finance_admin'',''support_agent'']))',t,own);
 end loop;
end $$;
-- A payer sees the intent they funded, never the beneficiary's wallet; payment_events rows are staff-only via RLS.
grant select on public.qpoint_balances to authenticated;
grant usage on schema quizbox_core to authenticated;
revoke execute on all functions in schema quizbox_core from public,anon,authenticated;
grant execute on function quizbox_core.is_staff(text[]) to authenticated;
grant execute on function quizbox_core.can_view_progress(uuid,uuid) to authenticated;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('qb_setting_set','qb_relationship_allows','qb_relationship_request','qb_relationship_decide','qb_my_roles','qb_switch_workspace',
   'qb_wallet_adjust','qb_coin_spend','qb_student_insights','qb_payment_intent_create','qb_payment_apply_event','qb_payment_reconcile','qb_qpoints_award','qb_consent_set','qb_feature_allowed') loop
  execute format('revoke execute on function %s from public,anon,authenticated',f.sig);
  if f.proname in ('qb_payment_apply_event','qb_qpoints_award','qb_coin_spend') then
   if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',f.sig); end if;
  else execute format('grant execute on function %s to authenticated',f.sig); end if;
 end loop;
end $$;

commit;

