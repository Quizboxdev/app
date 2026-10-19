-- Reviewer applications (completion plan Phase 6): teachers apply at any time, support staff vet and grant the subjects they may review.
-- Until now an application could only be made during sign-up, and approving one meant hand-editing a profile and its domains. This adds:
--   qb_apply_reviewer(p)                              a teacher applies (or updates a pending application); a declined teacher may re-apply after 90 days
--   qb_my_reviewer_application()                      the teacher's own status and the staff decision note
--   qb_reviewer_applications(status)                  super admin or support staff (sme_support): the queue, with the teacher's details and requested subjects
--   qb_reviewer_application_decide(user, decision, note, domains)   approve with chosen subject domains, or decline with a reason; one transaction
-- Quality control: support staff may grant review rights; only the owner (super admin) may grant approval or senior-review rights.
begin;

alter table public.sme_profiles add column if not exists decision_note text, add column if not exists decided_at timestamptz, add column if not exists decided_by uuid references public.profiles(id);

create or replace function public.qb_apply_reviewer(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare me public.profiles; sp public.sme_profiles; quals text := btrim(coalesce(p ->> 'qualifications', '')); yrs integer := coalesce(nullif(p ->> 'years_experience', '')::integer, 0);
        subj text[]; lv jsonb := coalesce(p -> 'education_levels', '[]'::jsonb); mkt uuid; country uuid; reqd jsonb;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or upper(me.role::text) <> 'TEACHER' or lower(me.status::text) <> 'active' then raise exception 'QB_TEACHER_REQUIRED' using errcode = '42501'; end if;
  if char_length(quals) not between 20 and 2000 then raise exception 'QB_APPLICATION_INVALID'; end if;
  if yrs not between 0 and 60 then raise exception 'QB_APPLICATION_INVALID'; end if;
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into subj from jsonb_array_elements_text(coalesce(p -> 'subjects', '[]'::jsonb)) x;
  if cardinality(subj) not between 1 and 6 or exists (select 1 from unnest(subj) s where char_length(s) > 60) then raise exception 'QB_APPLICATION_INVALID'; end if;
  if jsonb_typeof(lv) <> 'array' or jsonb_array_length(lv) > 3 then raise exception 'QB_APPLICATION_INVALID'; end if;
  mkt := coalesce(me.primary_market_id, me.default_market_id);
  select country_id into country from public.markets where id = mkt;
  select * into sp from public.sme_profiles where user_id = me.id;
  if sp.user_id is not null then
    if sp.reviewer_status = 'verified' then raise exception 'QB_ALREADY_REVIEWER'; end if;
    if sp.reviewer_status = 'suspended' and sp.decided_at is not null and sp.decided_at > now() - interval '90 days' then raise exception 'QB_APPLICATION_DECLINED_RECENTLY'; end if;
    if sp.reviewer_status = 'suspended' and sp.decided_at is null then raise exception 'QB_REVIEWER_SUSPENDED'; end if;
  end if;
  reqd := coalesce((select jsonb_agg(jsonb_build_object('subject_code', s, 'market_id', mkt, 'education_levels', lv)) from unnest(subj) s), '[]'::jsonb);
  insert into public.sme_profiles(user_id, reviewer_status, country_id, reviewer_tier, qualification_summary, years_experience, payment_status, active, requested_domains)
  values (me.id, 'pending', country, 'applicant', quals, yrs, 'pending', false, reqd)
  on conflict (user_id) do update set reviewer_status = 'pending', qualification_summary = excluded.qualification_summary, years_experience = excluded.years_experience,
        requested_domains = excluded.requested_domains, active = false, decision_note = null, decided_at = null, decided_by = null, updated_at = now();
  return jsonb_build_object('status', 'pending', 'subjects', to_jsonb(subj));
end $fn$;

create or replace function public.qb_my_reviewer_application() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare sp public.sme_profiles;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into sp from public.sme_profiles where user_id = auth.uid();
  if sp.user_id is null then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object('status', case when sp.reviewer_status = 'verified' then 'approved' when sp.reviewer_status = 'pending' then 'pending' when sp.decided_at is not null then 'declined' else 'suspended' end,
    'note', sp.decision_note, 'decided_at', sp.decided_at, 'can_reapply_after', case when sp.decided_at is not null then sp.decided_at + interval '90 days' end,
    'requested', sp.requested_domains, 'qualifications', sp.qualification_summary, 'years_experience', sp.years_experience);
end $fn$;

create or replace function public.qb_reviewer_applications(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not (quizbox_sme.has_capability('super_admin') or quizbox_sme.has_capability('sme_support')) then raise exception 'SUPPORT_ACCESS_REQUIRED' using errcode = '42501'; end if;
  if p_status not in ('pending', 'verified', 'suspended', 'all') then raise exception 'QB_INVALID_ACTION'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'applied_at') desc) from (
    select jsonb_build_object('user_id', s.user_id, 'name', p.full_name, 'email', p.email, 'school', p.school_name, 'status', s.reviewer_status, 'qualifications', s.qualification_summary,
        'years_experience', s.years_experience, 'requested', s.requested_domains, 'applied_at', s.updated_at, 'decision_note', s.decision_note, 'decided_at', s.decided_at,
        'domains', (select count(*) from public.sme_domain_assignments d where d.reviewer_id = s.user_id and d.active)) as x
      from public.sme_profiles s join public.profiles p on p.id = s.user_id
     where (p_status = 'all' or s.reviewer_status = p_status) order by s.updated_at desc limit 200) y), '[]'::jsonb);
end $fn$;

create or replace function public.qb_reviewer_application_decide(p_user uuid, p_decision text, p_note text, p_domains jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare sp public.sme_profiles; d jsonb; owner boolean := quizbox_sme.has_capability('super_admin'); granted integer := 0; me public.profiles;
begin
  if auth.uid() is null or not (owner or quizbox_sme.has_capability('sme_support')) then raise exception 'SUPPORT_ACCESS_REQUIRED' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'decline') then raise exception 'QB_INVALID_ACTION'; end if;
  select * into sp from public.sme_profiles where user_id = p_user for update;
  if sp.user_id is null then raise exception 'QB_NOT_FOUND'; end if;
  if sp.reviewer_status <> 'pending' then raise exception 'QB_APPLICATION_NOT_PENDING'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < (case when p_decision = 'decline' then 10 else 3 end) then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  if p_decision = 'decline' then
    update public.sme_profiles set reviewer_status = 'suspended', active = false, decision_note = btrim(p_note), decided_at = now(), decided_by = auth.uid(), updated_at = now() where user_id = p_user;
  else
    if jsonb_typeof(p_domains) <> 'array' or jsonb_array_length(p_domains) not between 1 and 20 then raise exception 'QB_DOMAINS_REQUIRED'; end if;
    for d in select * from jsonb_array_elements(p_domains) loop
      if coalesce(btrim(d ->> 'subject_code'), '') = '' then raise exception 'QB_DOMAINS_REQUIRED'; end if;
      if not owner and (coalesce((d ->> 'can_approve')::boolean, false) or coalesce((d ->> 'can_senior_review')::boolean, false)) then raise exception 'QB_SENIOR_GRANT_REQUIRES_OWNER' using errcode = '42501'; end if;
      insert into public.sme_domain_assignments(reviewer_id, subject_code, market_id, education_level, grade_codes, can_review, can_approve, can_senior_review, active)
      values (p_user, btrim(d ->> 'subject_code'), nullif(d ->> 'market_id', '')::uuid, nullif(btrim(coalesce(d ->> 'education_level', '')), ''),
              coalesce(array(select jsonb_array_elements_text(coalesce(d -> 'grade_codes', '[]'::jsonb))), '{}'), true,
              coalesce((d ->> 'can_approve')::boolean, false), coalesce((d ->> 'can_senior_review')::boolean, false), true);
      granted := granted + 1;
    end loop;
    update public.sme_profiles set reviewer_status = 'verified', active = true, reviewer_tier = 'reviewer', decision_note = btrim(p_note), decided_at = now(), decided_by = auth.uid(), updated_at = now() where user_id = p_user;
  end if;
  select * into me from public.profiles where id = p_user;
  insert into public.notifications(recipient_user_id, recipient_email, recipient_role, type, title, message, entity_type, entity_id)
  values (p_user, me.email, me.role, 'REVIEWER_APPLICATION', case when p_decision = 'approve' then 'You are now a QuizBox reviewer' else 'Update on your reviewer application' end,
          case when p_decision = 'approve' then 'Your application was approved. Open Reviews to see your assigned questions.' else 'Your reviewer application was not approved this time. ' || left(btrim(p_note), 300) || ' You may apply again after 90 days.' end,
          'sme_profile', p_user);
  return jsonb_build_object('decision', p_decision, 'domains_granted', granted);
end $fn$;

revoke all on function public.qb_apply_reviewer(jsonb), public.qb_my_reviewer_application(), public.qb_reviewer_applications(text), public.qb_reviewer_application_decide(uuid, text, text, jsonb) from public, anon;
grant execute on function public.qb_apply_reviewer(jsonb), public.qb_my_reviewer_application(), public.qb_reviewer_applications(text), public.qb_reviewer_application_decide(uuid, text, text, jsonb) to authenticated;

commit;
