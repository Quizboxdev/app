-- Read-only schema fingerprint. One line per fact: kind|key|detail. Scope: public, quizbox_* schemas + migration-relevant bits of auth/storage.
with scoped as (
  select oid, nspname from pg_namespace where nspname = 'public' or nspname like 'quizbox\_%'
),
roles(r) as (values ('anon'),('authenticated'),('service_role'))
select 'schema|'||nspname||'|' from scoped
union all select 'ext|'||extname||'|' from pg_extension where extname in ('pgcrypto','uuid-ossp','pg_net','pg_cron')
union all select 'schemaacl|'||s.nspname||'.'||r||'|usage='||has_schema_privilege(r,s.oid,'usage')||' create='||has_schema_privilege(r,s.oid,'create') from scoped s cross join roles
union all
-- relations
select 'rel|'||n.nspname||'.'||c.relname||'|kind='||c.relkind::text||' rls='||c.relrowsecurity||' force='||c.relforcerowsecurity||' opts='||coalesce(array_to_string(c.reloptions,','),'')||' part='||c.relispartition
from pg_class c join scoped n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','S','f')
union all
select 'col|'||n.nspname||'.'||c.relname||'.'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||' notnull='||a.attnotnull||' default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||' ident='||a.attidentity::text||' gen='||a.attgenerated::text||' coll='||coalesce(a.attcollation::regcollation::text,'')
from pg_attribute a join pg_class c on c.oid=a.attrelid join scoped n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')
union all
select 'con|'||n.nspname||'.'||c.relname||'.'||k.conname||'|'||k.contype::text||' '||regexp_replace(pg_get_constraintdef(k.oid),'\s+',' ','g')
from pg_constraint k join pg_class c on c.oid=k.conrelid join scoped n on n.oid=c.relnamespace where k.contype<>'n'
union all
select 'idx|'||n.nspname||'.'||c.relname||'|'||regexp_replace(pg_get_indexdef(i.indexrelid),'\s+',' ','g')
from pg_index i join pg_class c on c.oid=i.indrelid join scoped n on n.oid=c.relnamespace
union all
select 'trg|'||n.nspname||'.'||c.relname||'.'||t.tgname||'|enabled='||t.tgenabled::text||' '||regexp_replace(pg_get_triggerdef(t.oid),'\s+',' ','g')
from pg_trigger t join pg_class c on c.oid=t.tgrelid join scoped n on n.oid=c.relnamespace where not t.tgisinternal
union all
select 'trg|auth.users.'||t.tgname||'|enabled='||t.tgenabled::text||' '||regexp_replace(pg_get_triggerdef(t.oid),'\s+',' ','g')
from pg_trigger t where t.tgrelid='auth.users'::regclass and not t.tgisinternal
union all
select 'fn|'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g')
from pg_proc p join scoped n on n.oid=p.pronamespace where p.prokind in ('f','p','a','w')
union all
select 'fnacl|'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|public_exec='||(p.proacl is null or exists(select 1 from aclexplode(p.proacl) x where x.grantee=0 and x.privilege_type='EXECUTE'))::text||' '||
  (select string_agg(r||'='||has_function_privilege(r,p.oid,'execute'),' ' order by r) from roles)
from pg_proc p join scoped n on n.oid=p.pronamespace where p.prokind in ('f','p','a','w')
union all
select 'relacl|'||n.nspname||'.'||c.relname||'|'||(select string_agg(r||':'||(select string_agg(pr, ',' order by pr) from unnest(array['select','insert','update','delete','truncate','references','trigger']) pr where has_table_privilege(r,c.oid,pr)),' ' order by r) from roles)
from pg_class c join scoped n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m')
union all
select 'seqacl|'||n.nspname||'.'||c.relname||'|'||(select string_agg(r||':'||(select string_agg(pr, ',' order by pr) from unnest(array['usage','select','update']) pr where has_sequence_privilege(r,c.oid,pr)),' ' order by r) from roles)
from pg_class c join scoped n on n.oid=c.relnamespace where c.relkind='S'
union all
select 'colacl|'||n.nspname||'.'||c.relname||'.'||a.attname||'|'||array_to_string(a.attacl,',')
from pg_attribute a join pg_class c on c.oid=a.attrelid join scoped n on n.oid=c.relnamespace where a.attacl is not null and a.attnum>0 and not a.attisdropped
union all
select 'pol|'||n.nspname||'.'||c.relname||'.'||p.polname||'|cmd='||p.polcmd::text||' permissive='||p.polpermissive||' roles='||coalesce((select string_agg(rolname,',' order by rolname) from pg_roles where oid=any(p.polroles)),'public')||' using='||coalesce(regexp_replace(pg_get_expr(p.polqual,p.polrelid),'\s+',' ','g'),'')||' check='||coalesce(regexp_replace(pg_get_expr(p.polwithcheck,p.polrelid),'\s+',' ','g'),'')
from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') or n.nspname like 'quizbox\_%'
union all
select 'type|'||n.nspname||'.'||t.typname||'|'||t.typtype::text||' '||coalesce((select string_agg(enumlabel,',' order by enumsortorder) from pg_enum where enumtypid=t.oid),'')
from pg_type t join scoped n on n.oid=t.typnamespace where t.typtype in ('e','d','c') and (t.typtype<>'c' or not exists(select 1 from pg_class c where c.reltype=t.oid and c.relkind in ('r','v','m','p','f','S')))
union all
select 'view|'||n.nspname||'.'||c.relname||'|'||regexp_replace(pg_get_viewdef(c.oid),'\s+',' ','g') from pg_class c join scoped n on n.oid=c.relnamespace where c.relkind in ('v','m')
union all
select 'bucket|'||id||'|public='||public||' limit='||coalesce(file_size_limit::text,'')||' mime='||coalesce(array_to_string(allowed_mime_types,','),'') from storage.buckets where id in ('question-media','competition-sources','curriculum-sources')
order by 1;
