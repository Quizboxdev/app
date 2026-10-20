-- Rollback for 20261029100000_quiz_studio.sql. Removes the reader, joining, templates, featured and library functions and their tables. The new columns
-- (target_levels, reader_*, cloned_from, content_type, word_count) are left in place so no data is lost.
-- Afterwards re-apply, in order: 20261022100000_challenges_extensions.sql, 20261023100000_challenges_moderation.sql and 20261027100000_competitions_and_sharing.sql. They restore the earlier
-- add-material (10 sources, no chapters), brand (no logo), start, public card and list functions.
drop function if exists public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid, text, jsonb);
drop function if exists public.challenge_material_read(text, uuid), public.challenge_material(text), public.challenge_join(text, text), public.challenge_clone(uuid, text), public.challenge_featured(integer, text),
  public.challenge_library_stats(), public.challenge_set_reader(uuid, boolean, text), public.challenge_set_targeting(uuid, text[]), public.challenge_sections_set_visible(uuid, uuid[]),
  public.qb_challenge_reader_state(public.challenge_campaigns);
drop table if exists public.challenge_reads, public.challenge_participants, public.challenge_sections;
