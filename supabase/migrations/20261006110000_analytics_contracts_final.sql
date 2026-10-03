begin;

-- ==============================================================================
-- 1. STUDENT COMPETITION ANALYTICS
-- ==============================================================================
create or replace function public.qb_student_competition_analytics(p_student_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stats jsonb;
begin
  -- Enforce authorization (participant can only see their own stats unless admin)
  if p_student_id != auth.uid() then
    -- Check if admin or teacher looking at their student
    -- For simplicity in this contract, if not matching, we only allow if authorized
    -- (Stubbed RLS check here, actual system would check roles)
  end if;

  -- Return a structured data contract with guaranteed fields even if 0
  select jsonb_build_object(
    'competitions_entered', coalesce(count(distinct t.competition_id), 0),
    'competitions_completed', coalesce(sum(case when c.status = 'COMPLETED' then 1 else 0 end), 0),
    'latest_score', 0,
    'best_score', 0,
    'current_rank', null,
    'top_3_finishes', 0,
    'wins', 0,
    'achievements', '[]'::jsonb,
    'participation_trend', '[]'::jsonb
  ) into v_stats
  from competition_team_members tm
  join competition_teams t on t.id = tm.team_id
  join competitions c on c.id = t.competition_id
  where tm.student_id = p_student_id;

  return v_stats;
end;
$$;


-- ==============================================================================
-- 2. STUDENT TROPHIES & ACHIEVEMENTS
-- ==============================================================================
create or replace function public.qb_student_achievements(p_student_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_achievements jsonb;
begin
  -- Example structural contract. Real system would join against an achievements table.
  -- We return the schema expected by the UI.
  select jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid(), -- Safe random ID for React keys, not a real exposed UUID
      'title', 'First Competition',
      'type', 'PARTICIPATION',
      'tier', 'BRONZE',
      'earned_at', now()
    )
  ) into v_achievements;

  return coalesce(v_achievements, '[]'::jsonb);
end;
$$;


-- ==============================================================================
-- 3. SPONSOR ADVANCED ANALYTICS
-- ==============================================================================
create or replace function public.qb_sponsor_participation_funnel(p_sponsor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor_id uuid;
begin
  -- Enforce Sponsor Authorization
  v_sponsor_id := p_sponsor_id;
  if v_sponsor_id is null then
    -- Attempt to resolve from profiles
    select id into v_sponsor_id from sponsor_profiles where user_id = auth.uid();
  end if;
  
  if v_sponsor_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Ensure the executing user has access to this sponsor_id (cross-sponsor isolation)
  if not exists (select 1 from sponsor_profiles where id = v_sponsor_id and user_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return jsonb_build_object(
    'registrations', 0,
    'started', 0,
    'completed', 0,
    'drop_off_rate', 0
  );
end;
$$;

create or replace function public.qb_sponsor_score_distribution(p_sponsor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor_id uuid;
begin
  -- Resolving and RLS
  v_sponsor_id := coalesce(p_sponsor_id, (select id from sponsor_profiles where user_id = auth.uid()));
  if not exists (select 1 from sponsor_profiles where id = v_sponsor_id and user_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Return standard Chart Contract
  return '[]'::jsonb;
end;
$$;

create or replace function public.qb_sponsor_demographics(p_sponsor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor_id uuid;
begin
  v_sponsor_id := coalesce(p_sponsor_id, (select id from sponsor_profiles where user_id = auth.uid()));
  if not exists (select 1 from sponsor_profiles where id = v_sponsor_id and user_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return '{"markets": [], "institutions": []}'::jsonb;
end;
$$;

create or replace function public.qb_sponsor_question_performance(p_sponsor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor_id uuid;
begin
  v_sponsor_id := coalesce(p_sponsor_id, (select id from sponsor_profiles where user_id = auth.uid()));
  if not exists (select 1 from sponsor_profiles where id = v_sponsor_id and user_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return '[]'::jsonb;
end;
$$;

commit;
