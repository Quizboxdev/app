-- Follow-up diagnostic (read-only), 18 October 2026. One result set; the first column says what each row is. Set the editor to "No limit" and send me everything.
-- It answers: (1) are the Data API exposed schemas only "public"? (2) what policies guard classes and class_memberships? (3) which browser grants exist on the tables
-- that have row-level security off? (4) does any client-callable (SECURITY INVOKER) function read those internal tables? (5) the rest of the previous check (D and E).
select '1 exposed schemas' as section, coalesce(c.cfg, '(not set: default is public only)') as detail, '' as object
  from (select (select split_part(x, '=', 2) from pg_roles r, unnest(r.rolconfig) x where r.rolname = 'authenticator' and x like 'pgrst.db_schemas=%' limit 1) as cfg) c
union all
select '2 policy on ' || tablename, policyname, cmd || ' ' || permissive from pg_policies where schemaname = 'public' and tablename in ('classes', 'class_memberships')
union all
select '3 grant on RLS-off table', r.rolname || ': ' || concat_ws(',', case when has_table_privilege(r.rolname, c.oid, 'SELECT') then 'select' end,
        case when has_table_privilege(r.rolname, c.oid, 'INSERT') then 'insert' end, case when has_table_privilege(r.rolname, c.oid, 'UPDATE') then 'update' end,
        case when has_table_privilege(r.rolname, c.oid, 'DELETE') then 'delete' end), n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
 where c.relkind in ('r', 'p') and n.nspname like 'quizbox\_%' and not c.relrowsecurity
   and (has_table_privilege(r.rolname, c.oid, 'SELECT') or has_table_privilege(r.rolname, c.oid, 'INSERT') or has_table_privilege(r.rolname, c.oid, 'UPDATE') or has_table_privilege(r.rolname, c.oid, 'DELETE'))
union all
select '3 schema usage', r.rolname, n.nspname from pg_namespace n cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
 where n.nspname like 'quizbox\_%' and has_schema_privilege(r.rolname, n.oid, 'USAGE')
union all
select '4 invoker function reads internal table', p.proname, (regexp_match(p.prosrc, '(quizbox_(factory|sources|private)\.[a-z_]+)'))[1]
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not p.prosecdef and p.prosrc ~ 'quizbox_(factory|sources|private)\.[a-z_]+'
union all
select '5 browser role can TRUNCATE', r.rolname, n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
 where c.relkind in ('r', 'p') and (n.nspname = 'public' or n.nspname like 'quizbox\_%') and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
union all
select '5 apply-pack function missing', 'public', f.name
  from (values ('qb_owner_batch_preview'),('qb_owner_approve_batch'),('qb_owner_revoke_batch_approval'),('qb_my_access'),('qb_admin_set_free_allowance'),('qb_admin_grant_subscription'),
        ('qb_admin_grant_subscription_email'),('qb_admin_revoke_subscription'),('qb_admin_access_overview'),('qb_topic_label'),('qb_label_is_code'),('qb_staff_practice_preview')) f(name)
 where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.name)
order by 1, 3, 2;
