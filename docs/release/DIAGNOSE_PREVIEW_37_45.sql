-- READ-ONLY diagnosis for Preview: which pieces of migration 20261037 (policy drafts) and 20261045 (admin exports) are missing.
-- Run it, then apply ONLY the parts it names. 'MISSING' rows tell you the part number; both migrations are safe to run again in full if you prefer.
select '37 policy drafts: ' || d.slug as item,
       case when exists (select 1 from public.policy_versions v where v.document_id = d.id) then 'present' else 'MISSING (run 20261037 parts 1 to 3)' end as status
from public.policy_documents d where d.slug in ('terms', 'privacy', 'cookies', 'refunds')
union all
select '45 export functions, part ' || part || ': ' || fn,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = fn) then 'present' else 'MISSING (run 20261045 part ' || part || ')' end
from (values (1,'qb_export_ts'), (1,'qb_export_is_admin'), (1,'qb_export_can'), (1,'qb_export_defs'), (2,'qb_export_catalog'), (2,'qb_export_build_a'), (3,'qb_export_build_b'), (4,'qb_export_build_c'), (5,'qb_export_build_d'), (5,'qb_export_build_e'), (5,'qb_export_build'), (6,'qb_export_run')) as v(part, fn)
order by 1;
