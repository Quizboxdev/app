-- ============================================================================================================================
-- PRODUCTION TEST-TREE CLEANUP -- EXECUTE v2  (fmgccmqxfjppqydkhaiu)                  *** NOT YET AUTHORISED TO RUN ***
/*VARIANT_NOTE*/
-- Final review copy. Run only after: (1) the 2026-10-06 backup is confirmed, (2) docs/uat/production-cleanup-dry-run-v2.sql was re-run immediately
-- before and its numbers match the _expect table below, (3) the owner gives the go-ahead.
--
-- ONE transaction. Nothing is committed unless every assertion passes; any failure raises and the whole transaction is discarded.
-- ENGINE: the candidate/pruning logic below is NOT re-written: it is copied verbatim, by script, from the reviewed dry-run v2.
--   /*ENGINE_HASH*/
-- What this script adds to the reviewed engine: pre-flight assertions (aggregate AND per-table plan expectations), two frozen deletion sets keyed by
-- PRIMARY KEY only (CLEANUP PLAN = the reviewed 1,154 rows; AUTH REVOCATION PLAN = sessions/tokens of the retained test accounts, authorised separately and
-- never folded into the reviewed number), ordered deletion (with foreign-key cycle breaking limited to rows already in the cleanup plan), disabling of
-- retained test accounts, deactivation of retained fixture questions, and a collateral-damage guard that compares EVERY table's row count before and
-- after, allowing only (cleanup-plan deletes + revocation-plan deletes) per table.
--
-- Hard rules enforced here:
--   * every table in either frozen set must have a primary key (ctid is never used to address a destructive target); a table without one aborts the run;
--   * no trigger is disabled or altered (fingerprint of every trigger, enabled state, RLS flag and policy is compared before/after);
--   * only rows the engine proposed (the dry-run's DELETE set) are deleted; immutable tables are never in the plan (asserted);
--   * audit_logs / analytics_events / admin_actions rows are NOT deleted; their actor/user column becomes NULL through the existing ON DELETE SET NULL FK;
--   * admin.test@quizbox.local is never in the plan and its rows and references are fingerprinted before/after.
-- ============================================================================================================================
begin;
set local lock_timeout = '15s';
set local statement_timeout = '600s';

/*SETS*/

/*ENGINE_DEFS*/

-- ------------------------------------------------------------ execute-only infrastructure
create temp table _expect (k text primary key, v bigint not null);
-- >>> EDIT ONLY IF THE RE-RUN DRY-RUN SHOWS DIFFERENT, REVIEWED NUMBERS. Values below are the numbers quoted in the approval message.
insert into _expect values
  ('rows_proposed_for_deletion', 1154),
  ('removable_users', 18),
  ('removable_users_retained', 11),
  ('fixture_attempts_retained_by_competition_history', 13),
  ('fixture_questions_total', 43),
  ('fixture_questions_retained', 43);
-- Per-table CLEANUP PLAN pins: the delete count the reviewed v2 dry-run shows for EVERY table that has proposed deletions (sums to rows_proposed_for_deletion).
-- The pre-flight requires every table below to match exactly and requires that no table outside this list has a single planned deletion.
-- AUTH REVOCATION rows (sessions/tokens of retained test accounts) are NOT part of these numbers and are reported separately.
create temp table _expect_table (tbl text primary key, n bigint not null);
insert into _expect_table values
  ('public.competitions', 1),
  ('quizbox_competition.bank_items', 14),
  ('quizbox_competition.drafts', 1),
  ('quizbox_competition.leaderboard', 13),
  ('quizbox_competition.organization_members', 2),
  ('quizbox_competition.sponsor_organizations', 1),
  ('public.sme_domain_assignments', 1),
  ('public.sponsor_profiles', 1),
  ('public.assessment_questions', 106),
  ('public.assessment_results', 24),
  ('public.assessments', 60),
  ('public.assignment_question_versions', 106),
  ('public.assignment_targets', 82),
  ('public.assignments', 60),
  ('public.attempts', 61),
  ('public.class_memberships', 10),
  ('public.classes', 7),
  ('public.gradebook', 24),
  ('public.learning_events', 71),
  ('public.mastery_records', 5),
  ('public.notifications', 94),
  ('public.question_versions', 38),
  ('public.responses', 77),
  ('public.xp_transactions', 101),
  ('auth.identities', 7),
  ('auth.mfa_amr_claims', 44),
  ('auth.refresh_tokens', 44),
  ('auth.sessions', 44),
  ('auth.users', 7),
  ('public.institution_memberships', 2),
  ('public.profiles', 7),
  ('public.student_profiles', 3),
  ('public.teacher_profiles', 3),
  ('public.tenant_memberships', 9),
  ('public.user_capabilities', 2),
  ('public.user_market_memberships', 20),
  ('public.marketplace_sellers', 2);
-- <<<
-- CLEANUP PLAN: frozen by primary key (no physical row address is stored).
create temp table _plan (id bigserial primary key, t oid not null, pk jsonb not null);
create temp table _left (id bigint primary key, t oid not null, pk jsonb not null);
-- AUTH REVOCATION PLAN: rows of the RETAINED test accounts that must go so none of them can authenticate. Separately authorised deletions, frozen by
-- primary key before the 'before' snapshot, never part of the reviewed cleanup plan, counted and reported on their own.
create temp table _revoke (id bigserial primary key, t oid not null, pk jsonb not null);
create temp table _revoke_left (id bigint primary key, t oid not null, pk jsonb not null);
create temp table _err (t oid, msg text);
create temp table _cnt (phase text not null, t oid not null, tbl text not null, n bigint not null, primary key (phase, t));
create temp table _fp (phase text not null, k text not null, v text, primary key (phase, k));
create temp table _assertions (seq serial primary key, name text not null, result text not null);
create temp table _retained_users (id uuid, email text, reason text);

create function pg_temp.assert_eq(p_name text, a text, b text) returns void language plpgsql as $f$
begin
  insert into _assertions(name, result) values (p_name, case when a is not distinct from b then 'PASS (' || coalesce(a, 'null') || ')' else 'FAIL (' || coalesce(a, 'null') || ' vs ' || coalesce(b, 'null') || ')' end);
  if a is distinct from b then raise exception 'CLEANUP_ABORTED: % -> % vs %', p_name, a, b; end if;
end $f$;

create function pg_temp.pkcols(t oid) returns text[] language sql as $f$
  select array_agg(a.attname::text order by u.ord)
  from pg_index i cross join lateral unnest(i.indkey::int2[]) with ordinality u(attnum, ord)
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
  where i.indrelid = t and i.indisprimary $f$;

create function pg_temp.pkexpr(alias text, t oid) returns text language sql as $f$
  select 'jsonb_build_object(' || string_agg(quote_literal(x) || ', ' || alias || '.' || quote_ident(x), ', ') || ')' from unnest(pg_temp.pkcols(t)) x $f$;

create function pg_temp.relname(o oid) returns text language sql stable as
$f$ select format('%I.%I', n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = o $f$;

-- freeze the CLEANUP PLAN by primary key only. The engine's physical row address (ctid) is read exactly once, here, before the first DELETE, to translate the
-- engine's proposal into primary keys; nothing destructive is ever addressed by ctid, and a table without a primary key aborts the run.
create function pg_temp.freeze_plan() returns void language plpgsql as $f$
declare r record;
begin
  for r in select distinct t from _c loop
    if pg_temp.pkcols(r.t) is null then raise exception 'CLEANUP_ABORTED: planned table % has no primary key', pg_temp.relname(r.t); end if;
    execute format('insert into _plan(t, pk) select %s, %s from %s c join _c k on k.t = %s and k.tid = c.ctid',
                   r.t, pg_temp.pkexpr('c', r.t), r.t::regclass, r.t);
  end loop;
end $f$;

-- freeze the AUTH REVOCATION PLAN by primary key: every session / refresh token / MFA-session claim / one-time token of a RETAINED test account.
-- (auth.refresh_tokens.user_id is text with no foreign key, so those rows are matched by user as well as by session.)
create function pg_temp.freeze_revocation() returns void language plpgsql as $f$
declare ids uuid[]; r record; o oid;
begin
  select array_agg(id) into ids from _usr where not deletable;
  if ids is null then return; end if;
  for r in select * from (values
      (1, 'auth.refresh_tokens', 'c.user_id = any (select u::text from unnest($1) u) or c.session_id in (select s.id from auth.sessions s where s.user_id = any ($1))'),
      (2, 'auth.mfa_amr_claims', 'c.session_id in (select s.id from auth.sessions s where s.user_id = any ($1))'),
      (3, 'auth.sessions',       'c.user_id = any ($1)'),
      (4, 'auth.one_time_tokens', 'c.user_id = any ($1)')) v(ord, tbl, cond) order by ord loop
    o := to_regclass(r.tbl)::oid;
    continue when o is null;
    if pg_temp.pkcols(o) is null then raise exception 'CLEANUP_ABORTED: revocation table % has no primary key', r.tbl; end if;
    execute format('insert into _revoke(t, pk) select %s, %s from %s c where %s', o, pg_temp.pkexpr('c', o), r.tbl, r.cond) using ids;
  end loop;
end $f$;

create function pg_temp.del_row(t oid, pk jsonb) returns void language plpgsql as $f$
declare cols text[] := pg_temp.pkcols(t);
begin
  if cols is null then raise exception 'CLEANUP_ABORTED: cannot delete from % without a primary key', pg_temp.relname(t); end if;
  execute format('delete from %s c using jsonb_populate_record(null::%s, $1) j where %s', t::regclass, t::regclass,
                 (select string_agg(format('c.%1$I = j.%1$I', x), ' and ') from unnest(cols) x)) using pk;
end $f$;   -- 0 rows affected means the row already went with a parent (cascade): that is a success, verified afterwards

create function pg_temp.row_exists(t oid, pk jsonb) returns boolean language plpgsql as $f$
declare cols text[] := pg_temp.pkcols(t); n bigint;
begin
  if cols is null then raise exception 'CLEANUP_ABORTED: cannot verify % without a primary key', pg_temp.relname(t); end if;
  execute format('select count(*) from %s c join jsonb_populate_record(null::%s, $1) j on %s', t::regclass, t::regclass,
                 (select string_agg(format('c.%1$I = j.%1$I', x), ' and ') from unnest(cols) x)) into n using pk;
  return n > 0;
end $f$;

-- Foreign-key cycles (e.g. candidates <-> review assignments): only between rows that are ALREADY in the plan, null the nullable referencing columns of the
-- child so the pair can be deleted. Rows outside the plan are never touched; a non-nullable or primary-key-less edge is skipped.
create function pg_temp.break_cycles() returns bigint language plpgsql as $f$
declare e record; n bigint; total bigint := 0; nullable boolean;
begin
  for e in select * from _edge where act in ('a', 'r') and ch in (select t from _left) and pa in (select t from _left) loop
    select bool_and(not a.attnotnull) into nullable from unnest(e.ccols) x join pg_attribute a on a.attrelid = e.ch and a.attname = x;
    continue when not coalesce(nullable, false) or pg_temp.pkcols(e.ch) is null or pg_temp.pkcols(e.pa) is null;
    execute format($q$ update %1$s c set %2$s from _left lc
        where lc.t = %3$s and lc.pk = %4$s
          and exists (select 1 from %5$s p join _left lp on lp.t = %6$s and lp.pk = %7$s where %8$s) $q$,
      e.ch::regclass, (select string_agg(quote_ident(x) || ' = null', ', ') from unnest(e.ccols) x), e.ch, pg_temp.pkexpr('c', e.ch),
      e.pa::regclass, e.pa, pg_temp.pkexpr('p', e.pa), pg_temp.join_eq('c', e.ccols, 'p', e.pcols));
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $f$;

create function pg_temp.snap(p text) returns void language plpgsql as $f$
declare r record; n bigint;
begin
  for r in select c.oid, format('%I.%I', ns.nspname, c.relname) as nm from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where c.relkind = 'r' and (ns.nspname in ('public', 'auth') or ns.nspname like 'quizbox\_%') loop
    execute format('select count(*) from %s', r.nm) into n;
    insert into _cnt values (p, r.oid, r.nm, n);
  end loop;
  insert into _fp values
   (p, 'triggers', (select md5(coalesce(string_agg(c.oid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ',' order by c.oid::regclass::text, t.tgname), '')) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal)),
   (p, 'rls_flags', (select md5(coalesce(string_agg(format('%I.%I', ns.nspname, c.relname) || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity, ',' order by ns.nspname, c.relname), '')) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where c.relkind = 'r' and (ns.nspname in ('public', 'auth', 'storage') or ns.nspname like 'quizbox\_%'))),
   (p, 'policies', (select md5(coalesce(string_agg(polrelid::regclass::text || ':' || polname || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '') || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polrelid::regclass::text, polname), '')) from pg_policy)),
   (p, 'admin_test_rows', (select md5(coalesce((select to_jsonb(u)::text from auth.users u where lower(u.email) = 'admin.test@quizbox.local'), '') || coalesce((select to_jsonb(pr)::text from public.profiles pr where pr.id in (select id from auth.users where lower(email) = 'admin.test@quizbox.local')), '')))),
   (p, 'admin_test_refs', pg_temp.admin_refs()::text),
   (p, 'genuine_users', (select count(*) from auth.users where id not in (select id from s_users_rm))::text),
   (p, 'genuine_classes', (select count(*) from public.classes where id not in (select id from s_c_fx))::text),
   (p, 'genuine_assignments', (select count(*) from public.assignments where id not in (select id from s_a_fx))::text),
   (p, 'genuine_assessments', (select count(*) from public.assessments where id not in (select id from s_as_seed))::text),
   (p, 'genuine_attempts', (select count(*) from public.attempts where student_user_id not in (select id from s_users_rm) and id not in (select id from s_at_fx))::text),
   (p, 'genuine_questions', (select count(*) from public.questions where id not in (select id from s_q_fx))::text),
   (p, 'genuine_class_memberships', (select count(*) from public.class_memberships where class_id not in (select id from s_c_fx) and student_user_id not in (select id from s_users_rm))::text),
   -- market-discovery inputs (reporting only; compared in the diagnostic report, not asserted)
   (p, 'fp_markets', (select md5(coalesce(string_agg(to_jsonb(m)::text, ',' order by m.id), '')) from public.markets m)),
   (p, 'fp_countries', (select md5(coalesce(string_agg(to_jsonb(c)::text, ',' order by c.id), '')) from public.countries c)),
   (p, 'fp_feature_flags', (select md5(coalesce(string_agg(to_jsonb(f)::text, ',' order by f.id), '')) from public.feature_flags f)),
   (p, 'fp_qb_signup_markets_def', md5(pg_get_functiondef('public.qb_signup_markets()'::regprocedure)));
end $f$;

-- ------------------------------------------------------------ diagnostics (REPORTING ONLY: nothing below changes data, an assertion, or the cleanup plan)
create temp table _diag_cfg (force_rollback boolean not null);
insert into _diag_cfg values (/*FORCE_ROLLBACK*/);
create temp table _diag (id bigserial primary key, phase text not null, section text not null, detail jsonb not null);
create temp table _diag_rows (phase text not null, tbl text not null, key text not null, r jsonb not null, primary key (phase, tbl, key));
create temp table _diag_notes (id serial primary key, note text not null);

-- market-discovery state at one moment: what qb_signup_markets() returns for test markets, the rows behind it, the feature flag, every row of the three input tables
create function pg_temp.diag_snap(p text) returns void language plpgsql as $f$
declare flag_on boolean := exists (select 1 from public.feature_flags f where f.feature_code = 'TEST_MARKETS_VISIBLE' and f.enabled);
begin
  insert into _diag(phase, section, detail)
  select p, 'signup_test_market_rows', jsonb_build_object('market_id', e->>'market_id', 'market', e->>'market', 'country_code', e->>'country_code', 'country', e->>'country', 'available', e->'available', 'locale', e->>'locale')
  from jsonb_array_elements(public.qb_signup_markets()) e
  where (e->>'market_id') is not null and (e->>'market_id')::uuid in (select id from public.markets where is_test);
  insert into _diag(phase, section, detail)
  select p, 'market_row', jsonb_build_object('id', m.id, 'name', m.name, 'is_test', m.is_test, 'active', m.active, 'status', m.status, 'country_id', m.country_id)
  from public.markets m where m.id in (select (d.detail->>'market_id')::uuid from _diag d where d.phase = p and d.section = 'signup_test_market_rows');
  insert into _diag(phase, section, detail)
  select p, 'country_row', jsonb_build_object('id', c.id, 'iso2_code', c.iso2_code, 'name', c.name, 'active', c.active)
  from public.countries c where c.id in (select (d.detail->>'country_id')::uuid from _diag d where d.phase = p and d.section = 'market_row');
  insert into _diag(phase, section, detail) select p, 'feature_flag_rows', to_jsonb(f) from public.feature_flags f where f.feature_code = 'TEST_MARKETS_VISIBLE';
  insert into _diag_rows select p, 'public.markets', m.id::text, to_jsonb(m) from public.markets m;
  insert into _diag_rows select p, 'public.countries', c.id::text, to_jsonb(c) from public.countries c;
  insert into _diag_rows select p, 'public.feature_flags', f.id::text, to_jsonb(f) from public.feature_flags f;
  -- per country that has a test market: every market of that country, what the LATERAL ... ORDER BY name LIMIT 1 picks, and what signup actually returns
  insert into _diag(phase, section, detail)
  select p, 'country_markets', jsonb_build_object('country_id', c.id, 'iso2_code', c.iso2_code, 'country_active', c.active, 'flag_enabled', flag_on,
    'lateral_pick', (select jsonb_build_object('id', x.id, 'name', x.name, 'is_test', x.is_test) from public.markets x where x.country_id = c.id and x.status = 'ACTIVE' and (not x.is_test or flag_on) order by x.name limit 1),
    'returned_by_signup', (select e->>'market_id' from jsonb_array_elements(public.qb_signup_markets()) e where e->>'country_code' = c.iso2_code limit 1),
    'markets', (select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'status', x.status, 'is_test', x.is_test, 'active', x.active,
                  'in_cleanup_plan', exists (select 1 from _plan pl where pl.t = 'public.markets'::regclass::oid and pl.pk = jsonb_build_object('id', x.id))) order by x.name)
                from public.markets x where x.country_id = c.id))
  from public.countries c where exists (select 1 from public.markets t where t.country_id = c.id and t.is_test);
end $f$;

create function pg_temp.diag_report() returns jsonb language plpgsql as $f$
declare out jsonb;
        disc oid[] := array['public.markets'::regclass::oid, 'public.countries'::regclass::oid, 'public.feature_flags'::regclass::oid];
        touched oid[] := array['public.profiles'::regclass::oid, 'auth.users'::regclass::oid, 'public.user_capabilities'::regclass::oid, 'public.user_market_memberships'::regclass::oid,
                               'public.sme_profiles'::regclass::oid, 'public.questions'::regclass::oid];
begin
  select jsonb_build_object(
    'mode', case when (select force_rollback from _diag_cfg) then 'DIAGNOSTIC RUN (forced rollback, nothing committed)' else 'real run (aborting)' end,
    'notes', coalesce((select jsonb_agg(n.note order by n.id) from _diag_notes n), '[]'),
    -- 1-4: what qb_signup_markets() returns for test markets, the markets / countries rows behind it, the flag rows
    'signup_test_market_rows', jsonb_build_object('before', coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'before' and d.section = 'signup_test_market_rows'), '[]'),
                                                  'after',  coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'after'  and d.section = 'signup_test_market_rows'), '[]')),
    'markets_rows_behind_them', jsonb_build_object('before', coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'before' and d.section = 'market_row'), '[]'),
                                                   'after',  coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'after'  and d.section = 'market_row'), '[]')),
    'countries_rows_behind_them', jsonb_build_object('before', coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'before' and d.section = 'country_row'), '[]'),
                                                     'after',  coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'after'  and d.section = 'country_row'), '[]')),
    'feature_flag_TEST_MARKETS_VISIBLE_rows', jsonb_build_object('before', coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'before' and d.section = 'feature_flag_rows'), '[]'),
                                                                 'after',  coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'after'  and d.section = 'feature_flag_rows'), '[]')),
    -- 5-6: fingerprints before vs after, the exact rows that changed, the function definition
    'fingerprints', (select coalesce(jsonb_object_agg(a.k, jsonb_build_object('before', b.v, 'after', a.v, 'changed', b.v is distinct from a.v)), '{}')
                     from _fp a join _fp b on b.k = a.k and b.phase = 'before' where a.phase = 'after' and a.k in ('fp_markets', 'fp_countries', 'fp_feature_flags', 'fp_qb_signup_markets_def')),
    'rows_changed_by_the_transaction', (select coalesce(jsonb_agg(jsonb_build_object('table', coalesce(b.tbl, a.tbl), 'key', coalesce(b.key, a.key),
                   'change', case when a.r is null then 'DELETED' when b.r is null then 'ADDED' else 'UPDATED' end, 'before', b.r, 'after', a.r)), '[]')
                from (select * from _diag_rows where phase = 'before') b full join (select * from _diag_rows where phase = 'after') a on a.tbl = b.tbl and a.key = b.key
                where a.r is distinct from b.r),
    'qb_signup_markets_definition', pg_get_functiondef('public.qb_signup_markets()'::regprocedure),
    -- lateral LIMIT 1: every market of each country that has a test market, before and after, with what the lateral picks and what signup returns
    'country_markets_before', coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'before' and d.section = 'country_markets'), '[]'),
    'country_markets_after',  coalesce((select jsonb_agg(d.detail) from _diag d where d.phase = 'after'  and d.section = 'country_markets'), '[]'),
    -- triggers that could touch market discovery: on the three input tables, or on tables the cleanup deletes from / updates, and either mention them or build SQL dynamically
    'triggers', (select coalesce(jsonb_agg(jsonb_build_object('table', c.oid::regclass::text, 'trigger', t.tgname, 'enabled', t.tgenabled,
                   'timing', case when (t.tgtype & 2) > 0 then 'BEFORE' when (t.tgtype & 64) > 0 then 'INSTEAD OF' else 'AFTER' end,
                   'events', concat_ws(',', case when (t.tgtype & 4) > 0 then 'INSERT' end, case when (t.tgtype & 8) > 0 then 'DELETE' end, case when (t.tgtype & 16) > 0 then 'UPDATE' end, case when (t.tgtype & 32) > 0 then 'TRUNC' end),
                   'function', p.oid::regprocedure::text,
                   'on_discovery_table', c.oid = any (disc),
                   'table_has_planned_deletes', exists (select 1 from _plan pl where pl.t = c.oid),
                   'function_mentions_markets_countries_or_feature_flags', p.prosrc ~* '(markets|countries|feature_flags)',
                   'function_uses_dynamic_sql', p.prosrc ~* '(\mexecute\M|\mformat\s*\()') order by c.oid::regclass::text, t.tgname), '[]')
                 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
                 where not t.tgisinternal
                   and (c.oid = any (disc)
                        or ((exists (select 1 from _plan pl where pl.t = c.oid) or c.oid = any (touched))
                            and (p.prosrc ~* '(markets|countries|feature_flags)' or p.prosrc ~* '(\mexecute\M|\mformat\s*\()')))),
    'event_triggers', (select coalesce(jsonb_agg(jsonb_build_object('name', e.evtname, 'event', e.evtevent, 'function', e.evtfoid::regproc::text)), '[]') from pg_event_trigger e),
    'rewrite_rules_on_discovery_tables', (select coalesce(jsonb_agg(jsonb_build_object('table', r.ev_class::regclass::text, 'rule', r.rulename)), '[]') from pg_rewrite r where r.ev_class = any (disc) and r.rulename <> '_RETURN'),
    -- foreign keys into or out of the three tables, with ON DELETE / ON UPDATE actions and how many rows each side loses in the cleanup plan
    'foreign_keys', (select coalesce(jsonb_agg(jsonb_build_object('constraint', k.conname, 'child', k.conrelid::regclass::text, 'parent', k.confrelid::regclass::text,
                   'on_delete', case k.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end,
                   'on_update', case k.confupdtype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end,
                   'child_planned_deletes', (select count(*) from _plan pl where pl.t = k.conrelid), 'parent_planned_deletes', (select count(*) from _plan pl where pl.t = k.confrelid))
                   order by k.conrelid::regclass::text, k.conname), '[]')
                 from pg_constraint k where k.contype = 'f' and (k.conrelid = any (disc) or k.confrelid = any (disc))),
    -- every function that reads or writes feature_flags (dynamic SQL elsewhere may not contain the literal)
    'functions_mentioning_feature_flags', (select coalesce(jsonb_agg(jsonb_build_object('function', p.oid::regprocedure::text,
                   'writes', p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?feature_flags') order by p.oid::regprocedure::text), '[]')
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where (n.nspname = 'public' or n.nspname like 'quizbox\_%') and p.prosrc ~* 'feature_flags')
  ) into out;
  return out;
end $f$;

-- rows anywhere in the database that reference admin.test through a foreign key to auth.users / profiles (must be identical before and after)
create function pg_temp.admin_refs() returns bigint language plpgsql as $f$
declare e record; n bigint; total bigint := 0; aid uuid;
begin
  select id into aid from auth.users where lower(email) = 'admin.test@quizbox.local';
  if aid is null then return -1; end if;
  for e in select k.conrelid::regclass as ch, (select a.attname from pg_attribute a where a.attrelid = k.conrelid and a.attnum = k.conkey[1]) as col
           from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
           where k.contype = 'f' and k.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass) and array_length(k.conkey, 1) = 1
             and (ns.nspname in ('public', 'auth') or ns.nspname like 'quizbox\_%') loop
    execute format('select count(*) from %s where %I = $1', e.ch, e.col) into n using aid;
    total := total + n;
  end loop;
  return total;
end $f$;

/*ENGINE_RUN*/

-- ------------------------------------------------------------ holders for the report (filled before any delete)
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

-- ------------------------------------------------------------ PRE-FLIGHT ASSERTIONS (before the first DELETE)
do $pre$
declare r record; n bigint; bad text;
begin
  -- 1. every precheck counter produced by the reviewed engine must be zero (genuine-link counts and the closure self-check)
  for r in select step, rows from _log where phase like 'precheck%' order by seq loop
    insert into _assertions(name, result) values ('pre: ' || r.step, case when r.rows = 0 then 'PASS (0)' else 'FAIL (' || r.rows || ')' end);
    if r.rows <> 0 then raise exception 'CLEANUP_ABORTED: % = % (must be 0)', r.step, r.rows; end if;
  end loop;
  if not exists (select 1 from _log where phase like 'precheck%' and step like 'closure self-check%') then raise exception 'CLEANUP_ABORTED: closure self-check did not run'; end if;
  -- 2. the plan must match the reviewed dry-run
  perform pg_temp.assert_eq('pre: rows proposed for deletion', (select count(*) from _c)::text, (select v from _expect where k = 'rows_proposed_for_deletion')::text);
  perform pg_temp.assert_eq('pre: removable users', (select count(*) from s_users_rm)::text, (select v from _expect where k = 'removable_users')::text);
  perform pg_temp.assert_eq('pre: removable users retained', (select count(*) from _usr where not deletable)::text, (select v from _expect where k = 'removable_users_retained')::text);
  perform pg_temp.assert_eq('pre: fixture attempts retained by competition history', (select count(*) from _fx_att f where f.comp_linked and not exists (select 1 from _c c where c.t = 'public.attempts'::regclass::oid and c.tid = f.tid))::text, (select v from _expect where k = 'fixture_attempts_retained_by_competition_history')::text);
  perform pg_temp.assert_eq('pre: fixture questions total', (select count(*) from _qs)::text, (select v from _expect where k = 'fixture_questions_total')::text);
  perform pg_temp.assert_eq('pre: fixture questions retained', (select count(*) from _qs where not deletable)::text, (select v from _expect where k = 'fixture_questions_retained')::text);
  -- 2b. the plan must match the reviewed dry-run TABLE BY TABLE: every pinned table exactly, and no unlisted table with a single planned deletion
  select string_agg(format('%s: expected %s, plan has %s%s', coalesce(e.tbl, a.tbl), coalesce(e.n::text, 'none'), coalesce(a.n, 0), case when e.tbl is null then ' (UNLISTED TABLE)' else '' end), '; ' order by coalesce(e.tbl, a.tbl))
    into bad
    from _expect_table e full join (select pg_temp.relname(t) as tbl, count(*) as n from _c group by t) a on a.tbl = e.tbl
    where e.n is distinct from a.n;
  if bad is not null then raise exception 'CLEANUP_ABORTED: per-table plan differs from the reviewed dry-run -> %', bad; end if;
  insert into _assertions(name, result) select 'pre: plan rows ' || e.tbl, 'PASS (' || e.n || ')' from _expect_table e order by e.tbl;
  perform pg_temp.assert_eq('pre: per-table pins sum to the aggregate', (select sum(x.n) from _expect_table x)::text, (select v from _expect where k = 'rows_proposed_for_deletion')::text);
  perform pg_temp.assert_eq('pre: no table outside the per-table pins is in the plan', (select count(*) from _c c where pg_temp.relname(c.t) not in (select tbl from _expect_table))::text, '0');
  -- 2c. every table of the cleanup plan has a primary key (no ctid fallback exists anywhere)
  select string_agg(distinct pg_temp.relname(t), ', ') into bad from _c where pg_temp.pkcols(t) is null;
  if bad is not null then raise exception 'CLEANUP_ABORTED: planned tables without a primary key: %', bad; end if;
  insert into _assertions(name, result) values ('pre: every cleanup-plan table has a primary key', 'PASS (' || (select count(distinct t) from _c) || ' tables)');
  -- 3. structural guarantees
  perform pg_temp.assert_eq('pre: plan rows in immutable (delete-guarded) tables', (select count(*) from _c c join _allow a on a.t = c.t where a.guarded)::text, '0');
  perform pg_temp.assert_eq('pre: plan rows in tables outside the cleanup scope', (select count(*) from _c c where c.t not in (select t from _allow))::text, '0');
  perform pg_temp.assert_eq('pre: admin.test in the plan', (select count(*) from _c c join auth.users u on c.t = 'auth.users'::regclass::oid and c.tid = u.ctid where lower(u.email) = 'admin.test@quizbox.local')::text, '0');
  perform pg_temp.assert_eq('pre: admin.test profile in the plan', (select count(*) from _c c join public.profiles p on c.t = 'public.profiles'::regclass::oid and c.tid = p.ctid join auth.users u on u.id = p.id where lower(u.email) = 'admin.test@quizbox.local')::text, '0');
  perform pg_temp.assert_eq('pre: competition-snapshot assessments in the plan', (select count(*) from _c c join public.assessments a on c.t = 'public.assessments'::regclass::oid and c.tid = a.ctid where a.competition_snapshot_id is not null)::text, '0');
  perform pg_temp.assert_eq('pre: SET NULL tolerance limited to the three accepted telemetry tables', (select count(*) from _setnull_ok where t not in (select to_regclass(x)::oid from unnest(array['public.audit_logs', 'public.analytics_events', 'public.admin_actions']) x where to_regclass(x) is not null))::text, '0');
  perform pg_temp.assert_eq('pre: every retained fixture question has a recorded root blocker', (select count(*) from _qs q where not q.deletable and q.reason is null)::text, '0');
  perform pg_temp.assert_eq('pre: every retained test user has a recorded root blocker', (select count(*) from _usr u where not u.deletable and u.reason is null)::text, '0');
end $pre$;

select pg_temp.freeze_plan();
select pg_temp.freeze_revocation();

-- ------------------------------------------------------------ PRE-FLIGHT ON THE FROZEN SETS (still before the first DELETE and before the 'before' snapshot)
do $prefrozen$
declare bad text;
begin
  perform pg_temp.assert_eq('pre: cleanup plan frozen completely (rows)', (select count(*) from _plan)::text, (select count(*) from _c)::text);
  perform pg_temp.assert_eq('pre: cleanup plan frozen without duplicate keys', (select count(distinct (t, pk::text)) from _plan)::text, (select count(*) from _plan)::text);
  perform pg_temp.assert_eq('pre: cleanup plan frozen per table', (select count(*) from (select t, count(*) n from _plan group by t) a full join (select t, count(*) n from _c group by t) b on a.t = b.t where a.n is distinct from b.n)::text, '0');
  select string_agg(distinct pg_temp.relname(t), ', ') into bad from _plan where pg_temp.pkcols(t) is null;
  if bad is not null then raise exception 'CLEANUP_ABORTED: cleanup-plan tables without a primary key: %', bad; end if;
  -- AUTH REVOCATION PLAN: only the four authentication tables, only primary-key addressable, only rows of retained test accounts, disjoint from the cleanup plan
  select string_agg(distinct pg_temp.relname(t), ', ') into bad from _revoke where pg_temp.pkcols(t) is null;
  if bad is not null then raise exception 'CLEANUP_ABORTED: auth-revocation tables without a primary key: %', bad; end if;
  insert into _assertions(name, result) values ('pre: every table of both frozen sets has a primary key', 'PASS (' || (select count(distinct t) from _plan) || ' cleanup tables, ' || (select count(distinct t) from _revoke) || ' revocation tables)');
  select string_agg(distinct pg_temp.relname(t), ', ') into bad from _revoke where pg_temp.relname(t) not in ('auth.sessions', 'auth.refresh_tokens', 'auth.mfa_amr_claims', 'auth.one_time_tokens');
  if bad is not null then raise exception 'CLEANUP_ABORTED: auth-revocation plan contains tables outside the authentication set: %', bad; end if;
  perform pg_temp.assert_eq('pre: revocation rows that overlap the cleanup plan', (select count(*) from _revoke r join _plan p on p.t = r.t and p.pk = r.pk)::text, '0');
  perform pg_temp.assert_eq('pre: revocation sessions not owned by a retained test user', (select count(*) from _revoke r join auth.sessions s on r.t = 'auth.sessions'::regclass::oid and r.pk = jsonb_build_object('id', s.id) where s.user_id not in (select id from _usr where not deletable))::text, '0');
  perform pg_temp.assert_eq('pre: revocation one-time tokens not owned by a retained test user', (select count(*) from _revoke r join auth.one_time_tokens o on r.t = 'auth.one_time_tokens'::regclass::oid and r.pk = jsonb_build_object('id', o.id) where o.user_id not in (select id from _usr where not deletable))::text, '0');
  perform pg_temp.assert_eq('pre: revocation refresh tokens / MFA claims owned by a non-retained user (by user or by session)',
    (select count(*) from _revoke r join auth.refresh_tokens c on r.t = 'auth.refresh_tokens'::regclass::oid and r.pk = jsonb_build_object('id', c.id)
      where c.user_id <> all (select id::text from _usr where not deletable)
         or exists (select 1 from auth.sessions s where s.id = c.session_id and s.user_id <> all (select id from _usr where not deletable)))::text
    || '/' ||
    (select count(*) from _revoke r join auth.mfa_amr_claims c on r.t = 'auth.mfa_amr_claims'::regclass::oid and r.pk = jsonb_build_object('id', c.id)
      join auth.sessions s on s.id = c.session_id where s.user_id <> all (select id from _usr where not deletable))::text, '0/0');
  perform pg_temp.assert_eq('pre: admin.test sessions in the revocation plan', (select count(*) from _revoke r join auth.sessions s on r.t = 'auth.sessions'::regclass::oid and r.pk = jsonb_build_object('id', s.id) join auth.users u on u.id = s.user_id where lower(u.email) = 'admin.test@quizbox.local')::text, '0');
  -- closure: no table outside the revocation set may reference a revocation table (a cascade would otherwise remove rows nobody planned)
  select string_agg(distinct format('%s -> %s', k.conrelid::regclass, k.confrelid::regclass), ', ') into bad from pg_constraint k
    where k.contype = 'f' and k.confrelid in ('auth.sessions'::regclass::oid, 'auth.refresh_tokens'::regclass::oid, 'auth.mfa_amr_claims'::regclass::oid, 'auth.one_time_tokens'::regclass::oid)
      and k.conrelid not in ('auth.sessions'::regclass::oid, 'auth.refresh_tokens'::regclass::oid, 'auth.mfa_amr_claims'::regclass::oid, 'auth.one_time_tokens'::regclass::oid);
  if bad is not null then raise exception 'CLEANUP_ABORTED: tables outside the revocation set reference session/token tables: %', bad; end if;
end $prefrozen$;

select pg_temp.snap('before');
select pg_temp.diag_snap('before');   -- reporting only
insert into _left select id, t, pk from _plan;
insert into _revoke_left select id, t, pk from _revoke;
insert into _log(phase, step, action, rows) select 'plan', 'CLEANUP PLAN: rows frozen for deletion (reviewed number)', 'count', count(*) from _plan;
insert into _log(phase, step, action, rows) select 'plan', 'AUTH REVOCATION PLAN: rows frozen for deletion (separately authorised, not in the reviewed number)', 'count', count(*) from _revoke;

-- ------------------------------------------------------------ DELETE exactly the frozen plan (children first by retry passes; cycles broken only inside the plan)
do $del$
declare r record; pass int := 0; before_n bigint; after_n bigint; broke bigint; total_broke bigint := 0; msg text;
begin
  loop
    pass := pass + 1;
    select count(*) into before_n from _left;
    exit when before_n = 0;
    for r in select * from _left order by id loop
      begin
        perform pg_temp.del_row(r.t, r.pk);
        delete from _left where id = r.id;
      exception when others then
        get stacked diagnostics msg = message_text;
        insert into _err values (r.t, left(msg, 300));
      end;
    end loop;
    select count(*) into after_n from _left;
    exit when after_n = 0;
    if after_n = before_n then
      broke := pg_temp.break_cycles();
      total_broke := total_broke + broke;
      exit when broke = 0;
    end if;
    exit when pass >= 60;
  end loop;
  insert into _log(phase, step, action, rows) values ('delete', 'passes', 'count', pass), ('delete', 'foreign-key cycle links nulled (rows already in the plan)', 'count', total_broke);
  if exists (select 1 from _left) then
    raise exception 'CLEANUP_ABORTED: % planned rows could not be deleted; first errors: %', (select count(*) from _left), (select string_agg(distinct e.msg, ' | ') from (select x.msg from _err x order by x.msg limit 3) e);
  end if;
end $del$;

-- every planned row must now be gone
do $gone$
declare n bigint;
begin
  select count(*) into n from _plan p where pg_temp.row_exists(p.t, p.pk);
  perform pg_temp.assert_eq('post: planned rows still present', n::text, '0');
end $gone$;

-- ------------------------------------------------------------ retained test accounts: disable (rows are kept for history; nothing else about them is changed)
do $disable$
declare ids uuid[];
begin
  select array_agg(u.id) into ids from auth.users u where u.id in (select id from s_users_rm);
  if ids is null then return; end if;
  update public.profiles set status = 'inactive' where id = any (ids) and status::text <> 'inactive';
  update auth.users set banned_until = 'infinity'::timestamptz where id = any (ids);
  update public.user_capabilities set active = false where user_id = any (ids) and active;
  update public.user_market_memberships set active = false where user_id = any (ids) and active;
  if to_regclass('public.sme_profiles') is not null then update public.sme_profiles set active = false where user_id = any (ids) and active; end if;
  if to_regclass('public.sme_domain_assignments') is not null then update public.sme_domain_assignments set active = false where reviewer_id = any (ids) and active; end if;
  insert into _retained_users select u.id, u.email, (select reason from _usr x where x.id = u.id) from auth.users u where u.id = any (ids);
end $disable$;

-- ------------------------------------------------------------ AUTH REVOCATION: delete exactly the frozen revocation set, by primary key (children before parents)
do $revoke$
declare r record; n bigint;
begin
  for r in select rv.* from _revoke_left rv
           order by array_position(array['auth.refresh_tokens', 'auth.mfa_amr_claims', 'auth.sessions', 'auth.one_time_tokens'], pg_temp.relname(rv.t)), rv.id loop
    perform pg_temp.del_row(r.t, r.pk);   -- any failure aborts the whole transaction
    delete from _revoke_left where id = r.id;
  end loop;
  select count(*) into n from _revoke rv where pg_temp.row_exists(rv.t, rv.pk);
  perform pg_temp.assert_eq('post: revocation rows still present', n::text, '0');
end $revoke$;

-- retained fixture questions: inactive (status only; no validation/editorial state is changed, immutable history untouched)
update public.questions set status = 'inactive' where id in (select id from s_q_fx) and status::text <> 'inactive';

select pg_temp.snap('after');

-- ------------------------------------------------------------ POST ASSERTIONS
do $post$
declare r record;
begin
  -- A. no collateral damage anywhere. Every table: rows may only be removed from the two frozen sets (cleanup plan + auth revocation plan); nothing else may disappear.
  --    (Rows may legitimately be ADDED by live traffic during the seconds this runs, so non-immutable tables are checked for "nothing lost".)
  for r in select c.t, c.tbl, c.n as before_n, coalesce(p.planned, 0) + coalesce(rv.revoked, 0) as planned, af.n as after_n, coalesce(a.guarded, false) as guarded
           from _cnt c join _cnt af on af.phase = 'after' and af.t = c.t
           left join (select t, count(*) planned from _plan group by t) p on p.t = c.t
           left join (select t, count(*) revoked from _revoke group by t) rv on rv.t = c.t
           left join _allow a on a.t = c.t
           where c.phase = 'before' loop
    if r.after_n < r.before_n - r.planned then
      raise exception 'CLEANUP_ABORTED: rows disappeared from % (before %, planned cleanup + revocation deletes %, after %)', r.tbl, r.before_n, r.planned, r.after_n;
    end if;
    if r.guarded and r.after_n <> r.before_n then
      raise exception 'CLEANUP_ABORTED: immutable table % changed (before %, after %)', r.tbl, r.before_n, r.after_n;
    end if;
  end loop;
  insert into _assertions(name, result) values ('post: no table lost a row other than its planned rows (collateral damage = none)', 'PASS (' || (select count(*) from _cnt where phase = 'after') || ' tables checked)');
  -- B. immutable tables: identical counts (stated explicitly, one line per table); audit/telemetry rows never deleted (only their actor column may become NULL)
  for r in select name, t from _allow where guarded loop
    perform pg_temp.assert_eq('post: immutable table unchanged: ' || r.name, (select n from _cnt where phase = 'after' and t = r.t)::text, (select n from _cnt where phase = 'before' and t = r.t)::text);
  end loop;
  for r in select t::regclass::text as nm, t from _setnull_ok loop
    insert into _assertions(name, result) select 'post: audit rows not deleted: ' || r.nm,
      case when (select n from _cnt where phase = 'after' and t = r.t) >= (select n from _cnt where phase = 'before' and t = r.t) then 'PASS (' || (select n from _cnt where phase = 'before' and t = r.t) || ' -> ' || (select n from _cnt where phase = 'after' and t = r.t) || ')' else 'FAIL' end;
  end loop;
  -- C. genuine data unchanged (exact equality; if live activity changed these during the run the script aborts and can simply be re-run)
  for r in select k from (values ('genuine_users'), ('genuine_classes'), ('genuine_assignments'), ('genuine_assessments'), ('genuine_attempts'), ('genuine_questions'), ('genuine_class_memberships')) v(k) loop
    perform pg_temp.assert_eq('post: ' || replace(r.k, '_', ' ') || ' unchanged', (select v from _fp where phase = 'after' and k = r.k), (select v from _fp where phase = 'before' and k = r.k));
  end loop;
  -- D. configuration untouched
  for r in select k from (values ('triggers'), ('rls_flags'), ('policies')) v(k) loop
    perform pg_temp.assert_eq('post: ' || r.k || ' fingerprint unchanged (no trigger/RLS/policy was disabled or altered)', (select v from _fp where phase = 'after' and k = r.k), (select v from _fp where phase = 'before' and k = r.k));
  end loop;
  perform pg_temp.assert_eq('post: immutable_legacy_attribution still enabled', (select count(*) from pg_trigger where tgname = 'immutable_legacy_attribution' and tgenabled = 'O')::text, '1');
  perform pg_temp.assert_eq('post: admin.test@quizbox.local rows byte-identical', (select v from _fp where phase = 'after' and k = 'admin_test_rows'), (select v from _fp where phase = 'before' and k = 'admin_test_rows'));
  perform pg_temp.assert_eq('post: rows referencing admin.test unchanged', (select v from _fp where phase = 'after' and k = 'admin_test_refs'), (select v from _fp where phase = 'before' and k = 'admin_test_refs'));
  -- E. retained fixture attempts, users, questions, markets
  perform pg_temp.assert_eq('post: competition-linked fixture attempts preserved', (select count(*) from public.attempts a where a.id in (select id from _fx_att where comp_linked))::text, (select count(*) from _fx_att where comp_linked)::text);
  perform pg_temp.assert_eq('post: retained fixture questions active (must be none)', (select count(*) from public.questions where id in (select id from s_q_fx) and status::text = 'active')::text, '0');
  perform pg_temp.assert_eq('post: retained test users that are not disabled', (select count(*) from auth.users u join public.profiles p on p.id = u.id where u.id in (select id from s_users_rm) and not (p.status::text <> 'active' and u.banned_until is not null and u.banned_until > now()))::text, '0');
  perform pg_temp.assert_eq('post: retained test users with a live session', (select count(*) from auth.sessions where user_id in (select id from s_users_rm))::text, '0');
  perform pg_temp.assert_eq('post: retained test users with a refresh token', (select count(*) from auth.refresh_tokens rt where rt.user_id in (select id::text from _retained_users) or rt.session_id in (select s.id from auth.sessions s where s.user_id in (select id from _retained_users)))::text, '0');
  perform pg_temp.assert_eq('post: retained test users with a one-time token', (select count(*) from auth.one_time_tokens where user_id in (select id from _retained_users))::text, '0');
  perform pg_temp.assert_eq('post: retained test users able to authenticate (not banned)', (select count(*) from auth.users u where u.id in (select id from s_users_rm) and not (u.banned_until is not null and u.banned_until > now()))::text, '0');
  perform pg_temp.assert_eq('post: retained test users with active capabilities/roles', (select (select count(*) from public.user_capabilities where active and user_id in (select id from s_users_rm)) + (select count(*) from public.sme_profiles where active and user_id in (select id from s_users_rm)))::text, '0');
  -- DIAGNOSTICS (reporting only): capture the in-transaction market-discovery state immediately before the assertion below.
  perform pg_temp.diag_snap('after');
  if exists (select 1 from _diag d where d.phase = 'after' and d.section = 'signup_test_market_rows') then
    if (select force_rollback from _diag_cfg) then
      insert into _diag_notes(note) values ('post: test markets visible in ordinary market discovery (qb_signup_markets): a real run would abort here. This diagnostic run continues to the remaining assertions and then rolls back.');
    else
      raise exception 'CLEANUP_ABORTED: post: test markets visible in ordinary market discovery (qb_signup_markets) -> % test market row(s) returned. DIAGNOSTICS: %',
        (select count(*) from _diag d where d.phase = 'after' and d.section = 'signup_test_market_rows'), jsonb_pretty(pg_temp.diag_report());
    end if;
  end if;
  -- the existing assertion, unchanged. (Skipped only in the forced-rollback diagnostic variant, and only after the condition above was diagnosed and noted.)
  if not (select force_rollback from _diag_cfg) or not exists (select 1 from _diag d where d.phase = 'after' and d.section = 'signup_test_market_rows') then
    perform pg_temp.assert_eq('post: test markets visible in ordinary market discovery (qb_signup_markets)',
      (select count(*) from jsonb_array_elements(public.qb_signup_markets()) e where (e->>'market_id') is not null and (e->>'market_id')::uuid in (select id from public.markets where is_test))::text, '0');
  end if;
  perform pg_temp.assert_eq('post: active memberships of non-test users in retained test markets', (select count(*) from public.user_market_memberships um where um.active and um.market_id in (select id from public.markets where is_test) and um.user_id not in (select id from s_users_rm) and um.user_id not in (select id from auth.users where lower(email) = 'admin.test@quizbox.local'))::text, '0');   -- admin.test is intentionally preserved in its test market (asserted next)
  perform pg_temp.assert_eq('post: admin.test retained test-market membership unchanged', (select count(*) from public.user_market_memberships um join auth.users u on u.id = um.user_id join public.markets m on m.id = um.market_id where lower(u.email) = 'admin.test@quizbox.local' and m.is_test and um.active)::text, '1');
end $post$;

/*END_OF_TRANSACTION*/

-- ------------------------------------------------------------ FINAL REPORT (temp tables survive the commit within this session)
select ord, section, item, a, b, c from (
  select 1 as ord, e.k as s, 'EXPECTED vs ACTUAL' as section, e.k as item, e.v::text as a,
         (case e.k when 'rows_proposed_for_deletion' then (select count(*) from _plan)::text
                   when 'removable_users' then (select count(*) from s_users_rm)::text || ' at start'
                   when 'removable_users_retained' then (select count(*) from _retained_users)::text
                   when 'fixture_attempts_retained_by_competition_history' then (select count(*) from public.attempts where id in (select id from _fx_att where comp_linked))::text
                   when 'fixture_questions_total' then (select count(*) from _qs)::text
                   when 'fixture_questions_retained' then (select count(*) from public.questions where id in (select id from s_q_fx))::text end) as b, '' as c from _expect e
  union all
  select 1.1, coalesce(e.tbl, a.tbl), 'CLEANUP PLAN (reviewed 1,154 rows)', coalesce(e.tbl, a.tbl), 'pinned ' || coalesce(e.n::text, 'none'), 'deleted ' || coalesce(a.n, 0), case when e.n is distinct from a.n then 'MISMATCH' else '' end
  from _expect_table e full join (select pg_temp.relname(t) as tbl, count(*) as n from _plan group by t) a on a.tbl = e.tbl
  union all
  select 1.2, pg_temp.relname(t), 'AUTH REVOCATION PLAN (retained test accounts; separately authorised, NOT in the reviewed 1,154)', pg_temp.relname(t), 'deleted ' || count(*), '', '' from _revoke group by t
  union all
  select 2, c.tbl, 'TABLE BEFORE -> AFTER', c.tbl, c.n::text || ' -> ' || af.n::text, 'cleanup ' || coalesce(p.planned, 0) || ' + revocation ' || coalesce(rv.revoked, 0), case when c.n <> af.n then 'CHANGED' else '' end
  from _cnt c join _cnt af on af.phase = 'after' and af.t = c.t left join (select t, count(*) planned from _plan group by t) p on p.t = c.t
  left join (select t, count(*) revoked from _revoke group by t) rv on rv.t = c.t
  where c.phase = 'before' and (c.n <> af.n or p.planned is not null or rv.revoked is not null)
  union all select 3, u.email, 'USERS DELETED', u.email, '', '', '' from _usr u where u.deletable
  union all select 4, r.email, 'USERS RETAINED (DISABLED)', r.email, coalesce(r.reason, ''), 'profile inactive, sign-in banned, sessions/refresh tokens/one-time tokens revoked (AUTH REVOCATION PLAN), roles deactivated', '' from _retained_users r
  union all select 5, 'questions', 'FIXTURE QUESTIONS', 'deleted / retained inactive', (select count(*) from _qs where deletable)::text || ' / ' || (select count(*) from public.questions where id in (select id from s_q_fx))::text, '', ''
  union all select 6, tbl || '.' || col, 'AUDIT ROWS KEPT, ACTOR NULLED', tbl || '.' || col, rows::text, 'rows kept; column set NULL by the existing FK', '' from _nul where rows > 0
  union all select 7, 'markets/tenants', 'TEST MARKETS / TENANTS', 'test markets retained', (select count(*) from public.markets where is_test)::text, 'test tenants retained', (select count(*) from public.tenants where code ~ '^QB_TEST')::text
  union all select 8, a.seq::text, 'ASSERTIONS', a.name, a.result, '', '' from _assertions a
  union all select 9, l.seq::text, 'LOG', l.phase || ': ' || l.step, l.rows::text, coalesce(l.note, ''), '' from _log l where l.phase in ('plan', 'delete', 'engine')
) r order by ord, s, item;
