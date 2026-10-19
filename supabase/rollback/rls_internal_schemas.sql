-- Rollback for 20261018140000_rls_internal_schemas: switch row-level security back OFF on exactly the tables that migration switched on.
begin;
do $undo$
declare t record;
begin
  for t in select object from quizbox_private.hardening_log where action = 'rls_enabled' loop
    execute format('alter table %s disable row level security', t.object);
  end loop;
  delete from quizbox_private.hardening_log where action = 'rls_enabled';
end $undo$;
drop table if exists quizbox_private.hardening_log;
commit;
