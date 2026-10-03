-- Reverse 20261002270000 BEFORE any earlier sponsor rollback. No data is created by it.
begin;
drop function quizbox_competition.dispatch(text,uuid,jsonb);
alter function quizbox_competition.dispatch_delivery(text,uuid,jsonb) rename to dispatch;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;
drop function quizbox_competition.participant_label(uuid,integer);
commit;
