-- Family workspace, phase 5: question sets a parent buys in the Marketplace become the family's library, and the parent can give a set to the children they choose.
-- Nothing is copied: a grant is a reference to the purchase the parent already made (same licence, same 90 days), and the child plays the original set. If the purchase is reversed or expires, the child's access ends with it.
--   public.qb_family_library()                          the parent's purchased sets, with which children have each set and their best score
--   public.qb_family_grant_set(item, students)          the parent gives a purchased set to ticked children (each must be a child the parent may give work to)
--   public.qb_family_revoke_grant(item, student)        the parent takes a set back from one child
--   public.qb_family_my_sets()                          the child's sets from their family
--   public.qb_family_set_open(item)                     the child opens a set they were given (same shape as the Marketplace's own opener)
--   public.qb_family_set_record(item, correct, total)   the child's score for a set they were given
-- Off with the rest of the workspace (flags.family_workspace). Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN, QB_NOT_PURCHASED, QB_INVALID_ATTEMPT. Additive and idempotent. Rollback: supabase/rollback/family_library.sql

create table if not exists public.family_set_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.family_workspaces(id) on delete cascade,
  item_id uuid not null references public.mk_items(id) on delete cascade,
  purchase_id uuid not null references public.mk_purchases(id) on delete cascade,
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, item_id, student_user_id)
);
create index if not exists family_set_grants_student on public.family_set_grants(student_user_id);
alter table public.family_set_grants enable row level security;
revoke all on public.family_set_grants from public, anon, authenticated;

create or replace function public.qb_family_library() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', p.item_id, 'title', p.item_title, 'subject', p.item_subject, 'school', p.item_school, 'grade', p.item_grade,
      'expires_at', p.expires_at, 'active', p.status = 'active' and p.expires_at > now(),
      'children', coalesce((select jsonb_agg(jsonb_build_object('student_id', g.student_user_id, 'name', pr.full_name,
            'best', (select max(round(a.correct * 100.0 / a.total)) from public.mk_attempts a where a.item_id = p.item_id and a.user_id = g.student_user_id)) order by pr.full_name)
          from public.family_set_grants g join public.profiles pr on pr.id = g.student_user_id
          where g.workspace_id = w and g.item_id = p.item_id and quizbox_core.family_can(uid, g.student_user_id, 'view_progress')), '[]'::jsonb)) order by p.purchased_at desc)
    from public.mk_purchases p where p.buyer_user_id = uid), '[]'::jsonb);
end $fn$;
