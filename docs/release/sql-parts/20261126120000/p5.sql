-- ───────────── results, rankings and progression ─────────────
-- Fixture results of a round, and the standings by fixture points.
create or replace function quizbox_interschool.settle_fixtures(p_round uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare x record; r quizbox_interschool.rounds; d quizbox_interschool.divisions; c quizbox_interschool.competitions; f quizbox_interschool.fixtures;
  hs record; aws record; winner uuid; hp integer; ap integer; lot text;
begin
  x := quizbox_interschool.round_ctx(p_round); r := x.r; d := x.d;
  select * into c from quizbox_interschool.competitions where id = d.competition_id;
  -- fixtures: higher school score wins; equal scores go to the shorter time; a knockout tie that is still level is decided by a recorded draw of lots
  for f in select * from quizbox_interschool.fixtures where round_id = r.id and status <> 'CANCELLED' loop
    select * into hs from quizbox_interschool.school_results where round_id = r.id and institution_id = f.home_institution;
    select * into aws from quizbox_interschool.school_results where round_id = r.id and institution_id = f.away_institution;
    winner := null; lot := null;
    if f.away_institution is null then winner := f.home_institution;
    elsif coalesce(hs.eligible, false) and not coalesce(aws.eligible, false) then winner := f.home_institution;
    elsif coalesce(aws.eligible, false) and not coalesce(hs.eligible, false) then winner := f.away_institution;
    elsif coalesce(hs.eligible, false) then
      if hs.score <> aws.score then winner := case when hs.score > aws.score then f.home_institution else f.away_institution end;
      elsif hs.duration_ms <> aws.duration_ms then winner := case when hs.duration_ms < aws.duration_ms then f.home_institution else f.away_institution end;
      end if;
    end if;
    if winner is null and r.format = 'KNOCKOUT' then
      winner := case when md5(f.id::text || f.home_institution::text) < md5(f.id::text || f.away_institution::text) then f.home_institution else f.away_institution end;
      lot := 'level on score and time: decided by lot';
    end if;
    hp := case when f.away_institution is null then 3 when winner = f.home_institution then 3 when winner is null and coalesce(hs.eligible, false) then 1 else 0 end;
    ap := case when f.away_institution is null then null when winner = f.away_institution then 3 when winner is null and coalesce(aws.eligible, false) then 1 else 0 end;
    update quizbox_interschool.fixtures set status = 'COMPLETED', home_score = hs.score, away_score = aws.score, home_points = hp, away_points = ap, winner_institution = winner, note = coalesce(lot, note), updated_at = now() where id = f.id;
  end loop;
  -- league and group standings (and any fixture-points competition) add up fixture points across the match days; level points are split by the summed school scores, then time
  if r.format in ('ROUND_ROBIN', 'GROUP') or (c.school_scoring = 'FIXTURE_POINTS' and r.format <> 'FIELD') then
    update quizbox_interschool.school_results t set total_score = coalesce((select sum(case when fx.home_institution = t.institution_id then fx.home_points else fx.away_points end)
        from quizbox_interschool.fixtures fx join quizbox_interschool.rounds rx on rx.id = fx.round_id
       where rx.division_id = d.id and rx.round_no <= r.round_no and fx.status = 'COMPLETED' and (fx.home_institution = t.institution_id or fx.away_institution = t.institution_id)), 0)
     where t.round_id = r.id;
    update quizbox_interschool.school_results t set rank = z.rk from (
      select s.institution_id, rank() over (order by s.total_score desc, h.points_for desc, h.time_ms asc) as rk
        from quizbox_interschool.school_results s
        cross join lateral (select coalesce(sum(p.score), 0) as points_for, coalesce(sum(p.duration_ms), 0) as time_ms from quizbox_interschool.school_results p join quizbox_interschool.rounds rp on rp.id = p.round_id
                             where rp.division_id = d.id and rp.round_no <= r.round_no and rp.format = r.format and p.institution_id = s.institution_id) h
       where s.round_id = r.id) z
     where t.round_id = r.id and t.institution_id = z.institution_id;
  end if;
end $fn$;

-- Who goes through, by the round's rule. Authorised manual choices are kept (all earlier choices when p_keep).
create or replace function quizbox_interschool.apply_rules(p_round uuid, p_keep boolean) returns void language plpgsql security definer set search_path = '' as $fn$
declare r quizbox_interschool.rounds;
begin
  select * into r from quizbox_interschool.rounds where id = p_round;
  -- who goes through
  update quizbox_interschool.round_results t set qualified = case r.rule
      when 'ALL' then true
      when 'PASS' then not t.absent and t.percent >= r.pass_percent
      when 'TOP_LEARNERS' then not t.absent and t.rank <= r.top_n and t.percent >= coalesce(r.pass_percent, 0)
      when 'PASS_AND_TOP_LEARNERS' then not t.absent and t.percent >= r.pass_percent and t.rank <= r.top_n
      -- in a group stage the top schools of EACH group go through
      when 'TOP_SCHOOLS' then exists (
                              select 1 from (select z.institution_id, z.eligible, z.rank as overall, rank() over (partition by z.grp order by z.rank nulls last) as in_group
                                from (select s.institution_id, s.eligible, s.rank, (select max(fx.group_no) from quizbox_interschool.fixtures fx join quizbox_interschool.rounds rx on rx.id = fx.round_id
                                          where rx.division_id = r.division_id and (fx.home_institution = s.institution_id or fx.away_institution = s.institution_id)) as grp
                                        from quizbox_interschool.school_results s where s.round_id = r.id) z) g
                               where g.institution_id = t.institution_id and (g.eligible or r.format = 'GROUP') and (case when r.format = 'GROUP' then g.in_group else g.overall end) <= r.top_n)
                              and (r.pass_percent is null or (not t.absent and t.percent >= r.pass_percent))
      when 'FIXTURE_WINNERS' then exists (select 1 from quizbox_interschool.fixtures fx where fx.round_id = r.id and fx.status = 'COMPLETED' and fx.winner_institution = t.institution_id)
                              and (r.pass_percent is null or (not t.absent and t.percent >= r.pass_percent))
      else false end
   where t.round_id = r.id;
  if r.rule = 'MANUAL' then
    update quizbox_interschool.round_results t set qualified = k.qualified, manual = k.manual from is_keep k where t.round_id = r.id and t.candidate_id = k.candidate_id and k.manual;
  end if;
  if p_keep then
    update quizbox_interschool.round_results t set qualified = k.qualified, manual = k.manual from is_keep k where t.round_id = r.id and t.candidate_id = k.candidate_id;
  else
    update quizbox_interschool.round_results t set qualified = k.qualified, manual = true from is_keep k where t.round_id = r.id and t.candidate_id = k.candidate_id and k.manual;
  end if;
  update quizbox_interschool.school_results t set qualified = exists (select 1 from quizbox_interschool.round_results y where y.round_id = r.id and y.institution_id = t.institution_id and y.qualified)
    or (r.format <> 'FIELD' and r.rule = 'FIXTURE_WINNERS' and exists (select 1 from quizbox_interschool.fixtures fx where fx.round_id = r.id and fx.status = 'COMPLETED' and fx.winner_institution = t.institution_id))
   where t.round_id = r.id;
end $fn$;
