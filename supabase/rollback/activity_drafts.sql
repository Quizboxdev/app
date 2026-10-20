-- Rollback for 20261028100000_activity_drafts.sql. Removes the draft holder and every draft in it (they are temporary by design).
drop function if exists public.qb_drafts_sweep(), public.qb_draft_keep(uuid), public.qb_draft_discard(uuid), public.qb_draft_delete(text, text), public.qb_draft_list(),
  public.qb_draft_get(text, text), public.qb_draft_save(text, text, text, jsonb, text), public.qb_draft_allowed();
drop table if exists public.activity_drafts;
