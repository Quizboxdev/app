create or replace function public.qb_school_admin_decide(p_id uuid, p_decision text, p_note text default null, p_merge_into uuid default null, p_fix jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.school_directory; t public.school_directory; v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), ''); linked integer := 0; k integer := 0;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject', 'merge') then raise exception 'QB_INVALID_ACTION'; end if;
  select * into s from public.school_directory where id = p_id for update;
  if s.id is null then raise exception 'QB_NOT_FOUND'; end if;
  if s.status <> 'pending' then raise exception 'QB_INVALID_TRANSITION'; end if;
  if p_decision = 'approve' then
    if p_fix is not null then s := public.qb_school_apply_fix(s.id, p_fix); end if;
    update public.school_directory set status = 'approved', needs_review = false, decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = s.id;
    update public.student_profiles set school_name = s.name where school_directory_id = s.id;
    update public.teacher_profiles set school_name = s.name where school_directory_id = s.id;
  elsif p_decision = 'reject' then
    if v_note is null or length(v_note) < 5 then raise exception 'QB_REASON_REQUIRED'; end if;
    update public.school_directory set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = s.id;
    -- People who used it keep the name they see but must pick again from the list.
    update public.student_profiles set school_directory_id = null where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
    update public.teacher_profiles set school_directory_id = null where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
  else
    select * into t from public.school_directory where id = p_merge_into for update;
    if t.id is null or t.id = s.id or t.status <> 'approved' then raise exception 'QB_INVALID_ACTION'; end if;
    update public.school_directory set status = 'merged', merged_into = t.id, decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = s.id;
    update public.student_profiles set school_directory_id = t.id, school_name = t.name where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
    update public.teacher_profiles set school_directory_id = t.id, school_name = t.name where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
    update public.profiles p set school_name = t.name where p.id in (select user_id from public.student_profiles where school_directory_id = t.id union select user_id from public.teacher_profiles where school_directory_id = t.id);
  end if;
  return jsonb_build_object('id', s.id, 'decision', p_decision, 'people_updated', linked);
end $fn$;

-- Staff correct an approved school later (a spelling, a district, public / private, levels); everyone linked to it sees the corrected name.
create or replace function public.qb_school_admin_update(p_id uuid, p_fix jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.school_directory;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  s := public.qb_school_apply_fix(p_id, p_fix);
  update public.student_profiles set school_name = s.name where school_directory_id = s.id;
  update public.teacher_profiles set school_name = s.name where school_directory_id = s.id;
  update public.profiles p set school_name = s.name where p.id in (select user_id from public.student_profiles where school_directory_id = s.id union select user_id from public.teacher_profiles where school_directory_id = s.id);
  return jsonb_build_object('id', s.id, 'name', s.name);
end $fn$;
