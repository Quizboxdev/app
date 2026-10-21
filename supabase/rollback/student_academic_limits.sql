-- Rollback for 20261034100000_student_academic_limits.sql: removes the learner limits. Learner campaigns already corrected stay corrected (link-only, curriculum category).
-- challenge_set_questions and challenge_creator_get keep the extra source_question_id handling, which is harmless; re-apply 20261022100000_challenges_extensions.sql to restore the originals.
drop trigger if exists qb_student_campaign on public.challenge_campaigns;
drop trigger if exists qb_student_question on public.challenge_questions;
drop trigger if exists qb_student_assets on public.challenge_content_assets;
drop trigger if exists qb_student_prizes on public.challenge_prizes;
drop function if exists public.qb_trg_student_campaign(), public.qb_trg_student_question(), public.qb_trg_student_asset(), public.qb_trg_student_prize(), public.qb_owner_is_student(uuid);
