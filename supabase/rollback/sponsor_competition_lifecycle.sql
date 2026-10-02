-- Operator-only reversal of the NEW private schema. Never bulk-run as a migration.
-- Populated workflow records require an independently verified archive/restore
-- procedure; this script deliberately refuses to discard them.
begin;
do $$ declare t text; populated boolean; begin
  foreach t in array array['sponsor_organizations','organization_members','drafts','documents','chunks','generation_jobs','candidates','review_events','bank_items','snapshots','participations'] loop
    execute format('select exists(select 1 from quizbox_competition.%I)',t) into populated;
    if populated then raise exception 'ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE'; end if;
  end loop;
end $$;
drop table quizbox_competition.participations;
drop table quizbox_competition.snapshots;
drop table quizbox_competition.bank_items;
drop table quizbox_competition.review_events;
drop table quizbox_competition.candidates;
drop table quizbox_competition.generation_jobs;
drop table quizbox_competition.chunks;
drop table quizbox_competition.documents;
drop table quizbox_competition.drafts;
drop table quizbox_competition.organization_members;
drop table quizbox_competition.sponsor_organizations;
drop function quizbox_competition.reject_mutation();
drop schema quizbox_competition;
commit;
