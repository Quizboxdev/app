-- Computes a closed round: each learner, each school, each fixture, then who goes through. p_keep keeps the qualification already announced (used when a later round has started).
create or replace function quizbox_interschool.compute_round(p_round uuid, p_keep boolean default false) returns void language plpgsql security definer set search_path = '' as $fn$
declare x record; r quizbox_interschool.rounds; d quizbox_interschool.divisions; c quizbox_interschool.competitions; prev uuid;
begin
  x := quizbox_interschool.round_ctx(p_round); r := x.r; d := x.d;
  select * into c from quizbox_interschool.competitions where id = d.competition_id;
  select id into prev from quizbox_interschool.rounds where division_id = d.id and round_no = r.round_no - 1;
  perform quizbox_interschool.close_sitting(s.id, true) from quizbox_interschool.sittings s where s.round_id = r.id and s.submitted_at is null;
  create temporary table if not exists is_keep(candidate_id uuid primary key, qualified boolean, manual boolean) on commit drop;
  truncate is_keep;
  insert into is_keep select candidate_id, qualified, manual from quizbox_interschool.round_results where round_id = r.id;
  delete from quizbox_interschool.round_results where round_id = r.id;
  delete from quizbox_interschool.school_results where round_id = r.id;
  -- who was meant to take this round
  insert into quizbox_interschool.round_results(round_id, candidate_id, institution_id, score, max_score, percent, total_score, duration_ms, absent)
  select r.id, k.id, k.institution_id, coalesce(adj.new_score, s.score, 0), m.max_score,
         case when m.max_score > 0 then round(100.0 * coalesce(adj.new_score, s.score, 0) / m.max_score, 2) else 0 end,
         coalesce(adj.new_score, s.score, 0) + case when c.score_carry = 'ACCUMULATE' then coalesce(pr.total_score, 0) else 0 end,
         coalesce(s.duration_ms, 0), s.id is null
    from quizbox_interschool.candidates k
    left join quizbox_interschool.sittings s on s.round_id = r.id and s.candidate_id = k.id
    left join quizbox_interschool.round_results pr on pr.round_id = prev and pr.candidate_id = k.id
    left join lateral (select a.new_score from quizbox_interschool.adjustments a where a.round_id = r.id and a.candidate_id = k.id order by a.id desc limit 1) adj on true
    cross join lateral (select coalesce(s.max_score, (select count(*) from quizbox_interschool.paper_questions q join quizbox_interschool.papers p on p.id = q.paper_id where p.round_id = r.id and p.fixture_id is null))::integer as max_score) m
   where k.division_id = d.id and k.status = 'CONFIRMED'
     and (r.round_no = 1 or pr.qualified or s.id is not null)
     -- in a knockout only the drawn schools take part; in a league or group stage a school resting on a match day stays in
     and (r.format <> 'KNOCKOUT' or exists (select 1 from quizbox_interschool.fixtures fx where fx.round_id = r.id and fx.status <> 'CANCELLED' and (fx.home_institution = k.institution_id or fx.away_institution = k.institution_id)));
  update quizbox_interschool.round_results t set rank = z.rk from (
    select candidate_id, rank() over (order by total_score desc, duration_ms asc) as rk from quizbox_interschool.round_results where round_id = r.id and not absent) z
   where t.round_id = r.id and t.candidate_id = z.candidate_id;
  -- schools: AVERAGE and TEAM_TOTAL count absent learners as zero; TOP_N and FIXTURE_POINTS use the best N learners present
  insert into quizbox_interschool.school_results(round_id, institution_id, entered, present, score, total_score, duration_ms, eligible)
  select r.id, y.institution_id, count(*), count(*) filter (where not y.absent),
         round(case c.school_scoring when 'AVERAGE' then avg(y.percent) when 'TEAM_TOTAL' then sum(y.score) else coalesce(sum(y.percent) filter (where not y.absent and y.pos <= c.scoring_top_n), 0) end, 2),
         0, coalesce(sum(y.duration_ms) filter (where not y.absent and (c.school_scoring in ('AVERAGE', 'TEAM_TOTAL') or y.pos <= c.scoring_top_n)), 0),
         count(*) filter (where not y.absent) >= c.min_candidates
    from (select rr.*, row_number() over (partition by rr.institution_id order by rr.absent, rr.percent desc, rr.duration_ms) as pos from quizbox_interschool.round_results rr where rr.round_id = r.id and rr.institution_id is not null) y
   group by y.institution_id;
  update quizbox_interschool.school_results t set total_score = t.score + case when c.score_carry = 'ACCUMULATE' then coalesce((select p.total_score from quizbox_interschool.school_results p where p.round_id = prev and p.institution_id = t.institution_id), 0) else 0 end
   where t.round_id = r.id;
  update quizbox_interschool.school_results t set rank = z.rk from (
    select institution_id, rank() over (order by total_score desc, duration_ms asc) as rk from quizbox_interschool.school_results where round_id = r.id and eligible) z
   where t.round_id = r.id and t.institution_id = z.institution_id;
  perform quizbox_interschool.settle_fixtures(r.id);
  perform quizbox_interschool.apply_rules(r.id, p_keep);
end $fn$;

create or replace function quizbox_interschool.after_finalise(p_round uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare x record; r quizbox_interschool.rounds; d quizbox_interschool.divisions; c quizbox_interschool.competitions; nxt quizbox_interschool.rounds; schools uuid[]; k record;
begin
  x := quizbox_interschool.round_ctx(p_round); r := x.r; d := x.d;
  select * into c from quizbox_interschool.competitions where id = d.competition_id;
  select * into nxt from quizbox_interschool.rounds where division_id = d.id and round_no = r.round_no + 1;
  for k in select cd.user_id, y.qualified from quizbox_interschool.round_results y join quizbox_interschool.candidates cd on cd.id = y.candidate_id where y.round_id = r.id loop
    perform quizbox_interschool.notify(k.user_id, case when nxt.id is null then 'Final results are out' when k.qualified then 'You qualified' else 'Round results are out' end,
      c.title || ' ' || r.title || case when nxt.id is null then ': see how you did.' when k.qualified then ': you are through to ' || nxt.title || '.' else ': you did not go through this time.' end, '/interschool');
  end loop;
  -- the next knockout draw is made automatically from the winners
  if nxt.id is not null and nxt.format = 'KNOCKOUT' and not exists (select 1 from quizbox_interschool.fixtures f where f.round_id = nxt.id) and nxt.closes_at > now() then
    select array_agg(s.institution_id order by s.rank nulls last, s.institution_id) into schools from quizbox_interschool.school_results s where s.round_id = r.id and s.qualified;
    perform quizbox_interschool.knockout_pairs(nxt.id, schools);
  end if;
  -- the competition is complete when every round of every division has been finalised
  if not exists (select 1 from quizbox_interschool.rounds y join quizbox_interschool.divisions v on v.id = y.division_id where v.competition_id = c.id and y.finalised_at is null) then
    update quizbox_interschool.competitions set status = 'COMPLETED', finalised_at = now(), updated_at = now() where id = c.id and status <> 'CANCELLED';
  end if;
end $fn$;
