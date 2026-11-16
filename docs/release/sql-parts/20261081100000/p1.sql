-- Family workspace, phase 4a: a parent gives their children work through the same assignment engine teachers use (no second engine).
-- A parent's work lives in a hidden "family class" per class level (one per workspace and grade), owned by the parent. It holds only the parent's own linked children, so a school class is never touched
-- and a child who is also in a school class keeps both. Every assignment made in a family class is stamped source_type = 'family' and the workspace it came from, so the student can tell school work from family work.
--   public.qb_family_class(grade_code)   the parent's family class for that grade (made on first use), with the children of that grade the parent may give work to; the app then uses the existing topic functions with this class
--   public.qb_family_assignments()       the parent's assignments with each child's progress, only for children the parent may follow
-- Reuses: classes, class_memberships, teacher_profiles, qb_teacher_topics / qb_topic_assignment_plan / qb_publish_topic_assignment, assignments, assignment_targets, attempts. Off with the rest of the workspace (flags.family_workspace).
-- Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN. Additive and idempotent. Rollback: supabase/rollback/family_assignments.sql

alter table public.classes add column if not exists family_workspace_id uuid references public.family_workspaces(id) on delete set null;
create unique index if not exists classes_family_grade on public.classes(family_workspace_id, grade_code) where family_workspace_id is not null;

alter table public.assignments add column if not exists source_type text not null default 'school';
alter table public.assignments add column if not exists workspace_id uuid references public.family_workspaces(id) on delete set null;
alter table public.assignments drop constraint if exists assignments_source_type_check;
alter table public.assignments add constraint assignments_source_type_check check (source_type in ('school', 'family', 'system', 'self'));

create or replace function quizbox_core.assignment_source() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare w uuid;
begin
  select c.family_workspace_id into w from public.classes c where c.id = new.class_id;
  if w is not null then new.source_type := 'family'; new.workspace_id := w; end if;
  return new;
end $fn$;
drop trigger if exists assignment_source on public.assignments;
create trigger assignment_source before insert on public.assignments for each row execute function quizbox_core.assignment_source();
