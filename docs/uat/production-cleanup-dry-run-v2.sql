-- ============================================================================================================================
-- PRODUCTION TEST-TREE CLEANUP -- DRY RUN v2  (fmgccmqxfjppqydkhaiu)           READ ONLY: changes nothing.
-- v1 was blocked by test Competition/SME/Sponsor history. v2 computes, from the LIVE foreign-key catalog, the largest set of TEST-ONLY rows that can
-- be deleted without touching a genuine row and without touching immutable history, and the minimum footprint that must stay.
--
-- How the closure is computed (all in temp tables; the database is switched to READ ONLY before the engine runs):
--   1. SEEDS: removable test users (admin.test excluded), fixture classes/assignments/assessments/questions, QB_TEST tenants, is_test markets.
--   2. EXPANSION: add child rows (via every foreign key whose parent is already in the set) in the listed Competition/SME/Sponsor/Content tables, but ONLY
--      rows that are owned by test users: every user-reference column on the row is NULL or a removable user, and a row with no user reference is added
--      only if every listed parent it points to is also in the set. A row that any genuine user touches is never added.
--   3. PRUNING (to a fixed point): a row leaves the set if ANY row that stays still references it, whatever the FK action. Rows that stay include:
--      immutable history (never deletable), rows of tables outside the listed scope, and genuine rows. Retention propagates up the foreign keys, so the
--      parents of a retained immutable row are retained too: that is the minimum footprint. Identity rows (auth.*, profiles, student/teacher profiles)
--      of a retained account stay with it.
--   Immutable (delete-guarded in the live catalog, never deleted, never disabled): found from pg_trigger at run time and listed in the output.
-- Run in the Supabase SQL editor as one execution; the last statement returns one table. Nothing is committed (read-only transaction).
-- ============================================================================================================================
begin;
set local statement_timeout = '300s';

-- >>> SETS BEGIN (identical text in the dry-run script)
create temp table s_users_rm as
  select u.id, u.email from auth.users u
  where (u.email ~ '^(student2?|teacher|sponsor|seller)\.test@quizbox\.local$' or lower(u.email) like '%@e2e.quizbox.invalid')
    and lower(u.email) <> 'admin.test@quizbox.local';
create temp table s_users_all as   -- evidence definition: removable users plus the kept admin
  select id, email from s_users_rm
  union select u.id, u.email from auth.users u where lower(u.email) = 'admin.test@quizbox.local';
create temp table s_q_fx as
  select id from public.questions
  where source_type::text in ('DEV_ACCEPTANCE_FIXTURE', 'DEV_FACTORY_PILOT', 'TESTLAND_FIXTURE') or subject_code = 'QBTEST';
create temp table s_c_fx as
  select id from public.classes
  where class_name ~* 'acceptance|DEV_ACCEPTANCE_FIXTURE' or teacher_user_id in (select id from s_users_rm);
create temp table s_a_fx as
  select id, assessment_id from public.assignments
  where title ~* 'acceptance|DEV_FACTORY_PILOT' or class_id in (select id from s_c_fx) or teacher_user_id in (select id from s_users_rm);
create temp table s_as_fx as   -- fixture assessments: only fixture assignments, no genuine attempts, only fixture questions, never competition records
  select a.id from public.assessments a
  where (a.id in (select assessment_id from s_a_fx) or a.owner_user_id in (select id from s_users_rm))
    and a.competition_snapshot_id is null
    and not exists (select 1 from quizbox_competition.snapshots s where s.assessment_id = a.id)
    and not exists (select 1 from public.assignments x where x.assessment_id = a.id and x.id not in (select id from s_a_fx))
    and not exists (select 1 from public.attempts t where t.assessment_id = a.id and t.student_user_id not in (select id from s_users_rm))
    and not exists (select 1 from public.assessment_questions aq where aq.assessment_id = a.id and aq.question_id not in (select id from s_q_fx));
create temp table s_at_fx as
  select id from public.attempts
  where assessment_id in (select id from s_as_fx) or assignment_id in (select id from s_a_fx)
     or student_user_id in (select id from s_users_rm) or class_id in (select id from s_c_fx);
create temp table s_ev_class as   -- the evidence definitions (inventory script), including admin.test
  select id from public.classes
  where class_name ~* 'acceptance|DEV_ACCEPTANCE_FIXTURE' or teacher_user_id in (select id from s_users_all);
create temp table s_ev_asg as
  select id from public.assignments
  where title ~* 'acceptance|DEV_FACTORY_PILOT' or class_id in (select id from s_ev_class) or teacher_user_id in (select id from s_users_all);
create temp table s_tenants_fx as select id from public.tenants where code ~ '^QB_TEST';
create temp table s_markets_fx as select id from public.markets where is_test;
-- <<< SETS END

-- looser seed for assessments: the engine's own pruning protects anything genuine (v1 required fixture-only content up front)
create temp table s_as_seed as
  select a.id from public.assessments a
  where a.id in (select assessment_id from s_a_fx) or a.owner_user_id in (select id from s_users_rm);

create temp table _log (seq serial primary key, phase text, step text, action text, rows bigint, note text);
create temp table _allow (t oid primary key, name text not null, guarded boolean not null default false);
create temp table _rowguard (t oid not null, pred text not null);
create temp table _edge (ch oid not null, pa oid not null, act "char" not null, ccols text[] not null, pcols text[] not null);
create temp table _c (t oid not null, tid tid not null, primary key (t, tid));            -- proposed for deletion
create temp table _seen (t oid not null, tid tid not null, guarded boolean not null, primary key (t, tid));   -- test-owned rows ever found (incl. immutable)
create temp table _ret (t oid not null, tid tid not null, reason text not null, primary key (t, tid));        -- retained, with the root blocker
create temp table _setnull_ok (t oid primary key);   -- telemetry/audit tables whose ON DELETE SET NULL link to a user does NOT keep that user (rows survive, actor becomes NULL)
create temp table _owner (ch oid not null, pa oid not null);   -- for rows with no user reference: which parent(s) own the row (others are reference data)

-- ------------------------------------------------------------ scope of tables the cleanup may ever delete from
insert into _allow(t, name)
select c.oid, n.nspname || '.' || c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and (n.nspname in ('auth', 'quizbox_competition') or (n.nspname = 'public' and c.relname = any (array[
  'profiles','teacher_profiles','student_profiles','user_capabilities','user_market_memberships','tenant_memberships','institution_memberships','tenants','markets',
  'classes','class_memberships','assignments','assignment_targets','assignment_question_versions','assessments','assessment_questions','attempts','responses',
  'assessment_results','gradebook','learning_events','xp_transactions','mastery_records','notifications','questions','question_versions','question_banks',
  'question_bank_items','question_bank_versions','competitions','competition_appeals','competition_institutions','competition_leaderboard',
  'competition_match_participants','competition_matches','competition_officials','competition_participants','competition_results','competition_rounds',
  'competition_sponsors','competition_stages','competition_team_members','competition_teams','compensation_policies','compensation_policy_versions',
  'content_contexts','legacy_content_attributions','reviewer_earning_states','reviewer_earnings','sme_review_events','sme_profiles','sme_domain_assignments',
  'sme_review_assignments','sme_payout_batches','sme_payout_items','source_documents','sponsor_profiles','sponsorships','sponsorship_targets',
  'market_change_requests','marketplace_sellers'])));

-- immutable history: any table whose DELETE is guarded by an immutability trigger in the live catalog (never deleted, never disabled)
update _allow a set guarded = true where exists (
  select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
  where t.tgrelid = a.t and not t.tgisinternal and (t.tgtype & 1) > 0 and (t.tgtype & 2) > 0 and (t.tgtype & 8) > 0
    and pn.nspname || '.' || p.proname in ('quizbox_sme.immutable', 'quizbox_competition.reject_mutation'));
-- row-level immutability (competition delivery/snapshot records)
insert into _rowguard select 'public.assessments'::regclass::oid, 'c.competition_snapshot_id is not null' where to_regclass('public.assessments') is not null;
insert into _rowguard select 'public.assessment_questions'::regclass::oid,
  'exists (select 1 from quizbox_competition.snapshots g where g.assessment_id = c.assessment_id)' where to_regclass('public.assessment_questions') is not null;

insert into _edge
select k.conrelid, k.confrelid, k.confdeltype,
  (select array_agg(a.attname::text order by u.ord) from unnest(k.conkey) with ordinality u(attnum, ord) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum),
  (select array_agg(a.attname::text order by u.ord) from unnest(k.confkey) with ordinality u(attnum, ord) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.attnum)
from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_namespace cn on cn.oid = cl.relnamespace
where k.contype = 'f' and k.confrelid in (select t from _allow) and cn.nspname not in ('pg_catalog', 'information_schema');

-- DECISION POINT (edit or empty this list before running if you do not accept it): these tables are designed to outlive a user. Their rows are NOT deleted
-- and NOT blocked on; only the actor/user column is set to NULL by the existing ON DELETE SET NULL foreign key. The output reports how many rows that touches.
insert into _setnull_ok select to_regclass(x)::oid from unnest(array['public.audit_logs', 'public.analytics_events', 'public.admin_actions']) x where to_regclass(x) is not null;

-- ownership of rows that carry no user reference: the container parent owns the row; other parents are reference data (e.g. a response is owned by its attempt, not by the question)
insert into _owner
select c::regclass::oid, p::regclass::oid from (values
  ('public.responses','public.attempts'),('public.assessment_questions','public.assessments'),('public.assignment_targets','public.assignments'),
  ('public.assignment_question_versions','public.assignments'),('public.question_versions','public.questions'),
  ('public.competition_stages','public.competitions'),('public.competition_rounds','public.competition_stages'),('public.competition_matches','public.competition_rounds'),
  ('public.competition_match_participants','public.competition_matches'),('public.competition_results','public.competitions'),('public.competition_leaderboard','public.competitions'),
  ('public.competition_participants','public.competitions'),('public.competition_participants','public.student_profiles'),('public.competition_teams','public.competitions'),
  ('public.competition_team_members','public.competition_teams'),('public.competition_sponsors','public.competitions'),('public.competition_appeals','public.competitions'),
  ('public.competition_institutions','public.competitions'),('public.sme_domain_assignments','public.sme_profiles'),('public.sme_payout_items','public.sme_payout_batches'),
  ('public.sponsorship_targets','public.sponsorships'),('public.sponsorships','public.sponsor_profiles'),('public.compensation_policies','public.sponsor_profiles'),
  ('public.compensation_policy_versions','public.compensation_policies'),('quizbox_competition.sponsor_organizations','public.sponsor_profiles'),
  ('quizbox_competition.generation_jobs','quizbox_competition.drafts'),('quizbox_competition.documents','quizbox_competition.drafts'),
  ('quizbox_competition.candidates','quizbox_competition.drafts'),('quizbox_competition.bank_items','quizbox_competition.drafts'),
  ('quizbox_competition.drafts','public.competitions'),('quizbox_competition.leaderboard','quizbox_competition.drafts')) v(c, p)
where to_regclass(c) is not null and to_regclass(p) is not null;

-- ------------------------------------------------------------ engine helpers
create function pg_temp.cols(alias text, cols text[]) returns text language sql immutable as
$f$ select string_agg(alias || '.' || quote_ident(x), ', ') from unnest(cols) x $f$;

create function pg_temp.join_eq(ca text, cc text[], pa text, pc text[]) returns text language sql immutable as
$f$ select '(' || pg_temp.cols(ca, cc) || ') = (' || pg_temp.cols(pa, pc) || ')' $f$;

create function pg_temp.rowguard(ch oid) returns text language sql as
$f$ select coalesce(string_agg('not (' || pred || ')', ' and '), 'true') from _rowguard where t = ch $f$;

-- ownership predicate for a child row (alias c): all user references null/removable, and, when the row has no user reference, all listed parents already in the set
create function pg_temp.own_pred(ch oid) returns text language plpgsql as $f$
declare users text[]; allusers text; hasowner text; parents text;
  usertbls oid[] := array['auth.users'::regclass::oid, 'public.profiles'::regclass::oid];
begin
  select array_agg(e.ccols[1]) into users from _edge e where e.ch = own_pred.ch and e.pa = any (usertbls) and array_length(e.ccols, 1) = 1;
  select coalesce(string_agg(format('(c.%1$I is null or c.%1$I in (select id from s_users_rm))', u), ' and '), 'true'),
         coalesce(string_agg(format('c.%I is not null', u), ' or '), 'false')
    into allusers, hasowner from unnest(coalesce(users, '{}'::text[])) u;
  select coalesce(string_agg(format('((%s) or exists (select 1 from _c x where x.t = %s and x.tid = (select p2.ctid from %s p2 where %s limit 1)))',
           (select string_agg('c.' || quote_ident(x) || ' is null', ' or ') from unnest(e.ccols) x), e.pa, e.pa::regclass, pg_temp.join_eq('c', e.ccols, 'p2', e.pcols)), ' and '), 'true')
    into parents from _edge e where e.ch = own_pred.ch and e.pa in (select t from _allow) and not (e.pa = any (usertbls))
      and (e.pa in (select o.pa from _owner o where o.ch = own_pred.ch) or not exists (select 1 from _owner o where o.ch = own_pred.ch));
  return format('(%s) and ((%s) or (%s))', allusers, hasowner, parents);
end $f$;

create function pg_temp.seed(tbl regclass, cond text) returns void language plpgsql as $f$
begin
  if tbl is null then return; end if;
  execute format('insert into _c select %s, c.ctid from %s c where (%s) and %s on conflict do nothing', tbl::oid, tbl, cond, pg_temp.rowguard(tbl::oid));
  insert into _seen select t, tid, false from _c on conflict do nothing;
end $f$;

create function pg_temp.expand() returns void language plpgsql as $f$
declare e record; n bigint; added bigint; it int := 0;
begin
  loop
    it := it + 1; added := 0;
    for e in select ed.*, a.guarded from _edge ed join _allow a on a.t = ed.ch loop
      if e.guarded then
        execute format($q$ with cand as (select c.ctid tid from %1$s c where exists (select 1 from %2$s p join _c pc on pc.t = %3$s and pc.tid = p.ctid where %4$s) and %5$s),
          s as (insert into _seen select %6$s, tid, true from cand on conflict do nothing returning 1) select count(*) from s $q$,
          e.ch::regclass, e.pa::regclass, e.pa, pg_temp.join_eq('c', e.ccols, 'p', e.pcols), pg_temp.own_pred(e.ch), e.ch) into n;
      else
        execute format($q$ with cand as (select c.ctid tid from %1$s c where exists (select 1 from %2$s p join _c pc on pc.t = %3$s and pc.tid = p.ctid where %4$s) and %5$s and %7$s),
          i as (insert into _c select %6$s, tid from cand on conflict do nothing returning 1),
          s as (insert into _seen select %6$s, tid, false from cand on conflict do nothing returning 1) select (select count(*) from i) $q$,
          e.ch::regclass, e.pa::regclass, e.pa, pg_temp.join_eq('c', e.ccols, 'p', e.pcols), pg_temp.own_pred(e.ch), e.ch, pg_temp.rowguard(e.ch)) into n;
      end if;
      added := added + coalesce(n, 0);
    end loop;
    exit when added = 0 or it >= 40;
  end loop;
end $f$;

create function pg_temp.prune() returns void language plpgsql as $f$
declare e record; n bigint; changed bigint; it int := 0; ident oid[]; kind text;
begin
  select array_agg(c.oid) into ident from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'auth' or (ns.nspname = 'public' and c.relname in ('profiles', 'student_profiles', 'teacher_profiles'));
  loop
    it := it + 1; changed := 0;
    -- (1) any child row that stays blocks its parent (every FK action: cascade/set-null would otherwise delete or alter a row that must stay)
    for e in select ed.*, ac.guarded as ch_guarded, (ac.t is not null) as ch_allowed from _edge ed left join _allow ac on ac.t = ed.ch where not (ed.act = 'n' and ed.ch in (select t from _setnull_ok)) loop
      kind := case when e.ch_guarded then ' (immutable history)' when not e.ch_allowed then ' (table outside the cleanup scope)' else ' (row that stays: genuine, or it belongs to a retained parent)' end;
      execute format($q$ with doomed as (
          select pc.tid ptid, b.ctid ctid_child from _c pc join %2$s p on p.ctid = pc.tid
          cross join lateral (select c.ctid from %1$s c where %3$s and not exists (select 1 from _c x where x.t = %4$s and x.tid = c.ctid) limit 1) b
          where pc.t = %5$s),
        del as (delete from _c using doomed d where _c.t = %5$s and _c.tid = d.ptid returning _c.tid),
        ins as (insert into _ret select %5$s, d.ptid, coalesce((select r.reason from _ret r where r.t = %4$s and r.tid = d.ctid_child), %6$L) from doomed d on conflict do nothing returning 1)
        select count(*) from del $q$,
        e.ch::regclass, e.pa::regclass, pg_temp.join_eq('c', e.ccols, 'p', e.pcols), e.ch, e.pa, e.ch::regclass::text || kind) into n;
      changed := changed + coalesce(n, 0);
    end loop;
    -- (2) identity rows travel with their account: if the parent account row stays, its profile/auth children stay
    for e in select ed.* from _edge ed where ed.act = 'c' and ed.ch = any (ident) loop
      execute format($q$ with doomed as (
          select c.ctid tid from %1$s c join _c cc on cc.t = %3$s and cc.tid = c.ctid
          where exists (select 1 from %2$s p where %4$s and not exists (select 1 from _c x where x.t = %5$s and x.tid = p.ctid))),
        del as (delete from _c using doomed d where _c.t = %3$s and _c.tid = d.tid returning _c.tid),
        ins as (insert into _ret select %3$s, d.tid, 'identity of a retained account' from doomed d on conflict do nothing returning 1)
        select count(*) from del $q$,
        e.ch::regclass, e.pa::regclass, e.ch, pg_temp.join_eq('c', e.ccols, 'p', e.pcols), e.pa) into n;
      changed := changed + coalesce(n, 0);
    end loop;
    exit when changed = 0 or it >= 80;
  end loop;
  insert into _log(phase, step, action, rows) values ('engine', 'pruning passes', 'count', it);
end $f$;

create function pg_temp.cnt(p text, l text, q text) returns void language plpgsql as $f$
declare n bigint;
begin execute q into n; insert into _log(phase, step, action, rows) values (p, l, 'count', n); end $f$;

create function pg_temp.verify() returns bigint language plpgsql as $f$
declare e record; n bigint; total bigint := 0;
begin
  for e in select * from _edge where not (act = 'n' and ch in (select t from _setnull_ok)) loop
    execute format($q$ select count(*) from _c pc join %2$s p on p.ctid = pc.tid where pc.t = %4$s and exists (
        select 1 from %1$s c where %3$s and not exists (select 1 from _c x where x.t = %5$s and x.tid = c.ctid)) $q$,
      e.ch::regclass, e.pa::regclass, pg_temp.join_eq('c', e.ccols, 'p', e.pcols), e.pa, e.ch) into n;
    total := total + n;
  end loop;
  return total;
end $f$;

-- report holders are created empty now and filled after the engine runs (CREATE TABLE AS is not allowed once the transaction is read-only)
create temp table _tbl (t oid, name text, guarded boolean, grp text, seen bigint, seen_guarded bigint, del bigint, kept_imm bigint, kept_oth bigint);
create temp table _fx_att (id uuid, tid tid, comp_linked boolean);
create temp table _usr (id uuid, email text, tid tid, reason text, deletable boolean);
create temp table _qs (id uuid, deletable boolean, reason text);
create temp table _nul (tbl text, col text, rows bigint);

create function pg_temp.nulled() returns void language plpgsql as $f$
declare e record; n bigint;
begin
  for e in select ed.* from _edge ed where ed.act = 'n' and ed.ch in (select t from _setnull_ok) loop
    execute format($q$ select count(*) from %1$s c where exists (select 1 from %2$s p join _c pc on pc.t = %3$s and pc.tid = p.ctid where %4$s) $q$,
      e.ch::regclass, e.pa::regclass, e.pa, pg_temp.join_eq('c', e.ccols, 'p', e.pcols)) into n;
    insert into _nul values (e.ch::regclass::text, array_to_string(e.ccols, ','), n);
  end loop;
end $f$;

set transaction read only;   -- from here on the database itself refuses any write to a real table

-- ------------------------------------------------------------ run the engine
select pg_temp.seed('auth.users',      'c.id in (select id from s_users_rm)');
select pg_temp.seed('public.classes',  'c.id in (select id from s_c_fx)');
select pg_temp.seed('public.assignments', 'c.id in (select id from s_a_fx)');
select pg_temp.seed('public.assessments', 'c.id in (select id from s_as_seed)');
select pg_temp.seed('public.questions', 'c.id in (select id from s_q_fx)');
select pg_temp.seed('public.tenants',  'c.id in (select id from s_tenants_fx)');
select pg_temp.seed('public.markets',  'c.id in (select id from s_markets_fx)');
insert into _log(phase, step, action, rows) select 'engine', 'seed rows', 'count', count(*) from _c;
select pg_temp.expand();
insert into _log(phase, step, action, rows) select 'engine', 'rows after expansion (test-owned)', 'count', count(*) from _c;
select pg_temp.prune();
insert into _log(phase, step, action, rows) select 'engine', 'rows proposed for deletion after pruning', 'count', count(*) from _c;

-- ------------------------------------------------------------ 1. scope and the genuine-link assertions (all must be 0)
select pg_temp.cnt('scope', 'removable users (admin.test excluded)', 'select count(*) from s_users_rm');
select pg_temp.cnt('scope', 'admin.test present (kept, never touched)', $q$select count(*) from auth.users where lower(email)='admin.test@quizbox.local'$q$);
select pg_temp.cnt('scope', 'fixture questions', 'select count(*) from s_q_fx');
select pg_temp.cnt('scope', 'fixture classes', 'select count(*) from s_c_fx');
select pg_temp.cnt('scope', 'fixture assignments', 'select count(*) from s_a_fx');
select pg_temp.cnt('scope', 'fixture assessments (seed: fixture assignments or removable owner)', 'select count(*) from s_as_seed');
select pg_temp.cnt('scope', 'fixture attempts', 'select count(*) from s_at_fx');
select pg_temp.cnt('scope', 'genuine users (must be unchanged)', 'select count(*) from auth.users where id not in (select id from s_users_rm)');
select pg_temp.cnt('scope', 'genuine classes (must be unchanged)', 'select count(*) from public.classes where id not in (select id from s_c_fx)');
select pg_temp.cnt('scope', 'genuine assignments (must be unchanged)', 'select count(*) from public.assignments where id not in (select id from s_a_fx)');
select pg_temp.cnt('precheck (must be 0)', 'evidence: genuine_member_in_fixture_class', $q$select count(*) from public.class_memberships m where m.class_id in (select id from s_ev_class) and m.student_user_id not in (select id from s_users_all)$q$);
select pg_temp.cnt('precheck (must be 0)', 'evidence: genuine_attempt_on_fixture_assignment', $q$select count(*) from public.attempts a where a.assignment_id in (select id from s_ev_asg) and a.student_user_id not in (select id from s_users_all)$q$);
select pg_temp.cnt('precheck (must be 0)', 'evidence: fixture_question_in_genuine_assignment', $q$select count(*) from public.assessment_questions aq join public.assignments a on a.assessment_id = aq.assessment_id where aq.question_id in (select id from s_q_fx) and a.id not in (select id from s_ev_asg)$q$);
select pg_temp.cnt('precheck (must be 0)', 'evidence: acceptance_teacher_owns_nonfixture_class', $q$select count(*) from public.classes c where c.teacher_user_id in (select id from s_users_all) and c.id not in (select id from s_ev_class)$q$);
-- direct re-verification of the fixed point: no proposed row may still be referenced by a row outside the proposed set

insert into _log(phase, step, action, rows) select 'precheck (must be 0)', 'closure self-check: proposed rows still referenced by a row that stays', 'count', pg_temp.verify();

select pg_temp.nulled();

-- ------------------------------------------------------------ 2. proposals by table, grouped (Competition / SME / Sponsor / Content / Identity / Other)
insert into _tbl
select a.t, a.name, a.guarded,
  case when a.name like 'quizbox_competition.%' or a.name like 'public.competition%' then '1 Competition'
       when a.name ~ '^public\.(sme_|reviewer_|compensation_)' then '2 SME'
       when a.name ~ '^public\.(sponsor|source_documents)' then '3 Sponsor'
       when a.name ~ '^public\.(content_contexts|legacy_content|assessment|attempts|responses|gradebook|questions|question_|learning_events|xp_|mastery|class|assignment|notifications)' then '4 Content'
       when a.name like 'auth.%' or a.name ~ '^public\.(profiles|student_profiles|teacher_profiles|user_|tenant|institution_)' then '5 Identity'
       else '6 Other' end as grp,
  (select count(*) from _seen s where s.t = a.t) as seen,
  (select count(*) from _seen s where s.t = a.t and s.guarded) as seen_guarded,
  (select count(*) from _c c where c.t = a.t) as del,
  (select count(*) from _ret r where r.t = a.t and r.reason like '%(immutable history)%') as kept_imm,
  (select count(*) from _ret r where r.t = a.t and r.reason not like '%(immutable history)%') as kept_oth
from _allow a;

-- ------------------------------------------------------------ 3. attempts / users / questions / markets / tenants
insert into _fx_att
select a.id, a.ctid, (exists (select 1 from quizbox_competition.official_results r where r.attempt_id = a.id)
                       or exists (select 1 from quizbox_competition.participations r where r.attempt_id = a.id)) as comp_linked
from public.attempts a where a.id in (select id from s_at_fx);
insert into _usr
select u.id, u.email, u.ctid, (select reason from _ret r where r.t = 'auth.users'::regclass::oid and r.tid = u.ctid) as reason,
       exists (select 1 from _c c where c.t = 'auth.users'::regclass::oid and c.tid = u.ctid) as deletable
from auth.users u where u.id in (select id from s_users_rm);
insert into _qs
select q.id, exists (select 1 from _c c where c.t = 'public.questions'::regclass::oid and c.tid = q.ctid) as deletable,
       (select reason from _ret r where r.t = 'public.questions'::regclass::oid and r.tid = q.ctid) as reason
from public.questions q where q.id in (select id from s_q_fx);

-- ------------------------------------------------------------ 4. result (single table)
select ord, section, item, outcome, detail, note from (
  select 1 as ord, seq::bigint as s, phase as section, step as item, action as outcome, rows::text as detail, coalesce(note, '') as note from _log
  union all
  select 2, row_number() over (order by grp, name), 'PROPOSAL ' || grp, name,
         'delete ' || del || ' of ' || seen,
         'test-owned rows found: ' || seen || ' | immutable (kept): ' || seen_guarded || ' | kept because an immutable row references them: ' || kept_imm || ' | kept for other reasons: ' || kept_oth,
         case when guarded then 'IMMUTABLE TABLE: never deleted' else '' end
  from _tbl where seen > 0 or del > 0
  union all
  select 3, 1, 'ATTEMPTS', 'fixture attempts in scope', (select count(*) from _fx_att)::text, '', ''
  union all select 3, 2, 'ATTEMPTS', 'would be DELETED', (select count(*) from _fx_att f where exists (select 1 from _c c where c.t = 'public.attempts'::regclass::oid and c.tid = f.tid))::text, '', ''
  union all select 3, 3, 'ATTEMPTS', 'RETAINED (referenced by immutable competition records)', (select count(*) from _fx_att f where comp_linked and not exists (select 1 from _c c where c.t = 'public.attempts'::regclass::oid and c.tid = f.tid))::text, '', 'the competition-linked attempts; they no longer block anything'
  union all select 3, 4, 'ATTEMPTS', 'RETAINED for another reason', (select count(*) from _fx_att f where not comp_linked and not exists (select 1 from _c c where c.t = 'public.attempts'::regclass::oid and c.tid = f.tid))::text, '', ''
  union all select 3, 5, 'ATTEMPTS', 'other test-owned attempts (not in the fixture set) deleted', ((select count(*) from _c c where c.t = 'public.attempts'::regclass::oid) - (select count(*) from _fx_att f where exists (select 1 from _c c where c.t = 'public.attempts'::regclass::oid and c.tid = f.tid)))::text, '', ''
  union all select 4, 1, 'USERS', 'removable users', (select count(*) from _usr)::text, '', ''
  union all select 4, 2, 'USERS', 'would be DELETED', (select count(*) from _usr where deletable)::text, '', ''
  union all select 4, 3, 'USERS', 'would be RETAINED (disabled)', (select count(*) from _usr where not deletable)::text, '', ''
  union all select 4, 10 + row_number() over (order by email), 'USER', case when deletable then 'DELETE' else 'RETAIN (disabled)' end, email, '', coalesce(reason, '') from _usr
  union all select 5, 1, 'QUESTIONS', 'fixture questions', (select count(*) from _qs)::text, '', ''
  union all select 5, 2, 'QUESTIONS', 'would be DELETED', (select count(*) from _qs where deletable)::text, '', ''
  union all select 5, 3, 'QUESTIONS', 'necessarily RETAINED (inactive historical residue)', (select count(*) from _qs where not deletable)::text, '', ''
  union all select 5, 10 + row_number() over (order by reason), 'QUESTIONS', 'retained because', coalesce(reason, ''), '', '' from (select reason, count(*) from _qs where not deletable group by reason) x
  union all select 6, 1, 'MARKETS/TENANTS', 'tenants would be deleted / retained',
         (select count(*) from public.tenants t where t.id in (select id from s_tenants_fx) and exists (select 1 from _c c where c.t = 'public.tenants'::regclass::oid and c.tid = t.ctid))::text || ' / ' ||
         (select count(*) from public.tenants t where t.id in (select id from s_tenants_fx) and not exists (select 1 from _c c where c.t = 'public.tenants'::regclass::oid and c.tid = t.ctid))::text, '', ''
  union all select 6, 2, 'MARKETS/TENANTS', 'test markets would be deleted / retained',
         (select count(*) from public.markets m where m.id in (select id from s_markets_fx) and exists (select 1 from _c c where c.t = 'public.markets'::regclass::oid and c.tid = m.ctid))::text || ' / ' ||
         (select count(*) from public.markets m where m.id in (select id from s_markets_fx) and not exists (select 1 from _c c where c.t = 'public.markets'::regclass::oid and c.tid = m.ctid))::text, '', ''
  union all
  select 7, row_number() over (order by cnt desc, reason), 'WHY ROWS STAY', reason, cnt::text, '', 'rows retained with this root blocker'
  from (select reason, count(*) cnt from _ret group by reason) w
  union all
  select 7, 1000 + row_number() over (order by tbl, col), 'AUDIT ROWS KEPT, ACTOR NULLED', tbl || '.' || col, rows::text, '', 'rows survive; only this column becomes NULL (existing ON DELETE SET NULL)' from _nul where rows > 0
  union all
  select 8, row_number() over (order by name), 'IMMUTABLE TABLES (live catalog)', name, '', '', 'delete is guarded by an immutability trigger; never deleted' from _allow where guarded
  union all
  -- AUTH REVOCATION PLAN preview (READ ONLY). The four matching conditions below are the same text as freeze_revocation() in production-cleanup-v2.sql
  -- ($1 = the retained removable test users). These counts are live authentication state: they are NOT part of the fixed cleanup-plan pins and may change.
  select 9, x.s, 'AUTH REVOCATION PLAN', x.item, x.n::text, '', x.note from (
    with ids as (select coalesce(array_agg(id), '{}'::uuid[]) a from _usr where not deletable),
    rv_sessions as (select 'auth.sessions' as tbl, c.id::text as pk, array[c.user_id::text] as owners from auth.sessions c where c.user_id = any ((select a from ids)::uuid[])),
    rv_refresh as (select 'auth.refresh_tokens' as tbl, c.id::text as pk,
                          array_remove(array[c.user_id, (select s.user_id::text from auth.sessions s where s.id = c.session_id)], null) as owners
                   from auth.refresh_tokens c
                   where c.user_id = any (select u::text from unnest((select a from ids)) u) or c.session_id in (select s.id from auth.sessions s where s.user_id = any ((select a from ids)::uuid[]))),
    rv_ott as (select 'auth.one_time_tokens' as tbl, c.id::text as pk, array[c.user_id::text] as owners from auth.one_time_tokens c where c.user_id = any ((select a from ids)::uuid[])),
    rv_mfa as (select 'auth.mfa_amr_claims' as tbl, c.id::text as pk, array[(select s.user_id::text from auth.sessions s where s.id = c.session_id)] as owners
               from auth.mfa_amr_claims c where c.session_id in (select s.id from auth.sessions s where s.user_id = any ((select a from ids)::uuid[]))),
    rv as (select * from rv_sessions union all select * from rv_refresh union all select * from rv_ott union all select * from rv_mfa)
    select 1 as s, 'auth.sessions' as item, (select count(*) from rv where tbl = 'auth.sessions') as n, 'sessions of the retained removable test users' as note
    union all select 2, 'auth.refresh_tokens', (select count(*) from rv where tbl = 'auth.refresh_tokens'), 'matched by session or by user (user_id is text, no FK)'
    union all select 3, 'auth.one_time_tokens', (select count(*) from rv where tbl = 'auth.one_time_tokens'), ''
    union all select 4, 'auth.mfa_amr_claims', (select count(*) from rv where tbl = 'auth.mfa_amr_claims'), 'claims of those sessions'
    union all select 5, 'TOTAL', (select count(*) from rv), 'separately authorised in the execute script; NOT part of the reviewed 1,154'
    union all select 6, 'revocation rows belonging to admin.test (must be 0)',
        (select count(*) from rv where (select id::text from auth.users where lower(email) = 'admin.test@quizbox.local') = any (owners)), ''
    union all select 7, 'revocation rows belonging to a genuine / non-retained user (must be 0)',
        (select count(*) from rv where exists (select 1 from unnest(owners) o where o <> all (select id::text from _usr where not deletable))), 'every owner identifiable from the row (user and session) is a retained test user'
    union all select 8, 'revocation rows referenced by an out-of-plan row (must be 0)',
        (select count(*) from auth.refresh_tokens c where c.session_id in (select s.id from auth.sessions s where s.user_id = any ((select a from ids)::uuid[]))
            and not exists (select 1 from rv_refresh r where r.pk = c.id::text))
      + (select count(*) from auth.mfa_amr_claims c where c.session_id in (select s.id from auth.sessions s where s.user_id = any ((select a from ids)::uuid[]))
            and not exists (select 1 from rv_mfa r where r.pk = c.id::text))
      + (select count(*) from pg_constraint k where k.contype = 'f'
            and k.confrelid in ('auth.sessions'::regclass::oid, 'auth.refresh_tokens'::regclass::oid, 'auth.mfa_amr_claims'::regclass::oid, 'auth.one_time_tokens'::regclass::oid)
            and k.conrelid not in ('auth.sessions'::regclass::oid, 'auth.refresh_tokens'::regclass::oid, 'auth.mfa_amr_claims'::regclass::oid, 'auth.one_time_tokens'::regclass::oid)),
        'rows of the revocation tables outside the set that reference a revoked row, plus foreign keys from tables outside the four'
  ) x
) r order by ord, s;
