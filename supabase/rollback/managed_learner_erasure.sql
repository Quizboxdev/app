-- Rollback for 20261020100000_managed_learner_erasure. Data already erased cannot be restored; the erased_at column stays.
drop function if exists public.qb_managed_learner_find(text);
drop function if exists public.qb_managed_erasure_queue();
drop function if exists public.qb_managed_learner_erase(uuid, text);
