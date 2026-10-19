-- Defence in depth (tracker C6 part 2): switch row-level security ON for every table in the internal schemas (quizbox_*) that has it off.
-- Verified on production 18 October 2026 before writing this: the Data API exposes only "public"; the browser roles hold no privileges on these tables
-- and no usage on quizbox_factory, quizbox_sources or quizbox_private; no client-callable function reads them; the app never queries them directly.
-- So nothing changes today. With RLS on and no policy, a future grant or an exposed schema still returns no rows to a browser. Server functions
-- (SECURITY DEFINER, owned by the table owner) are unaffected: owners bypass RLS.
-- Every table switched on is written to quizbox_private.hardening_log so the rollback undoes exactly these and nothing else.
begin;

create table if not exists quizbox_private.hardening_log (
  id bigint generated always as identity primary key,
  action text not null,
  object text not null,
  at timestamptz not null default now(),
  unique (action, object)
);
alter table quizbox_private.hardening_log enable row level security;
revoke all on quizbox_private.hardening_log from public, anon, authenticated;

do $rls$
declare t record;
begin
  for t in
    select n.nspname as s, c.relname as r
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname like 'quizbox\_%' and not c.relrowsecurity
  loop
    execute format('alter table %I.%I enable row level security', t.s, t.r);
    insert into quizbox_private.hardening_log(action, object) values ('rls_enabled', t.s || '.' || t.r) on conflict do nothing;
  end loop;
end $rls$;

commit;
