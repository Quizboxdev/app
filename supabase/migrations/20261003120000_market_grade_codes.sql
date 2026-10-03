-- Market-defined grade codes. The legacy national enum is derived only when the code is one of its
-- values; grade aliases (e.g. a legacy code equivalent to a canonical one) come from market data.
begin;

create function quizbox_market.sync_grade_code() returns trigger language plpgsql set search_path='' as $$
begin
 if new.grade is null and nullif(new.grade_code,'') is not null and exists(select 1 from pg_enum where enumtypid='public.qb_grade'::regtype and enumlabel=new.grade_code) then
  new.grade:=new.grade_code::public.qb_grade;
 elsif new.grade_code is null and new.grade is not null then new.grade_code:=new.grade::text;
 end if;
 return new;
end $$;
create trigger class_grade_code before insert or update of grade,grade_code on public.classes for each row execute function quizbox_market.sync_grade_code();
create trigger assignment_grade_code before insert or update of grade,grade_code on public.assignments for each row execute function quizbox_market.sync_grade_code();

-- Canonical grade from the student's market configuration (grades[].canonical); legacy fallback kept
-- only for rows created before market grade data existed.
create or replace function quizbox_market.student_grade_code(p_user uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select x->>'canonical' from public.profiles p join public.markets m on m.id=coalesce(p.primary_market_id,p.default_market_id)
   cross join jsonb_array_elements(coalesce(m.configuration->'grades','[]')) x where p.id=s.user_id and x->>'code'=s.g and nullif(x->>'canonical','') is not null limit 1),
   case when s.g='B10' then 'SHS1' else s.g end)
 from (select user_id,coalesce(nullif(grade_code,''),grade::text) g from public.student_profiles where user_id=p_user and lower(status::text)='active' limit 1) s;
$$;
revoke all on function quizbox_market.sync_grade_code() from public,anon,authenticated;
commit;
