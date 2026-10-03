-- Content outside the legacy national grade enum carries its market grade code instead.
begin;
alter table public.questions drop constraint question_grade_semantics;
alter table public.questions add constraint question_grade_semantics check (grade is not null or nullif(canonical_grade_code,'') is not null
 or (origin_candidate_id is not null and content_origin in ('SPONSOR_DOCUMENT','HYBRID')));

alter table public.assessments add column grade_code text;
alter table public.assessments drop constraint assessment_grade_semantics;
alter table public.assessments add constraint assessment_grade_semantics check (grade is not null or nullif(grade_code,'') is not null or source_mode in ('SPONSOR_SOURCE','HYBRID'));

-- Curriculum assignments record their curriculum subject node in subject_code; take its grade code.
create function quizbox_market.assessment_grade_code() returns trigger language plpgsql set search_path='' as $$
begin
 if new.grade is null and nullif(new.grade_code,'') is null and new.subject_code ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select coalesce(n.canonical_grade_code,n.grade_code) into new.grade_code from public.curriculum_nodes n where n.id=new.subject_code::uuid;
 elsif new.grade_code is null and new.grade is not null then new.grade_code:=new.grade::text;
 end if;
 return new;
end $$;
create trigger assessment_grade_code before insert on public.assessments for each row execute function quizbox_market.assessment_grade_code();

create function quizbox_market.assignment_class_grade_code() returns trigger language plpgsql set search_path='' as $$
begin
 if nullif(new.grade_code,'') is null then select c.grade_code into new.grade_code from public.classes c where c.id=new.class_id; end if;
 return new;
end $$;
create trigger assignment_class_grade_code before insert on public.assignments for each row execute function quizbox_market.assignment_class_grade_code();
revoke all on function quizbox_market.assessment_grade_code(),quizbox_market.assignment_class_grade_code() from public,anon,authenticated;
commit;
