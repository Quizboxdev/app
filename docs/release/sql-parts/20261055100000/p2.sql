-- Chooses p_share questions of one topic: difficulty split (30 / 40 / 30 unless a level is asked for), one question per concept before a second of any, random within that,
-- never one already chosen (p_exclude). Returns the ids and the split. A topic that cannot supply the share raises QB_TOPIC_SHORT.
create or replace function quizbox_topic.pick_for_topic(p_topic uuid, p_title text, p_share integer, p_difficulty text, p_tenant uuid, p_acc boolean, p_exclude uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare av_e integer; av_m integer; av_h integer; av_t integer; tgt_e integer; tgt_m integer; tgt_h integer; tk_e integer; tk_m integer; tk_h integer; short integer; add_n integer; picked uuid[];
begin
  select count(*) filter (where e.level = 'easy'), count(*) filter (where e.level = 'medium'), count(*) filter (where e.level = 'hard'), count(*)
    into av_e, av_m, av_h, av_t from quizbox_topic.listable_questions(p_topic, p_tenant, p_acc) e where not (e.question_id = any (p_exclude));
  if p_difficulty is not null then
    tgt_e := case when p_difficulty = 'easy' then p_share else 0 end;
    tgt_m := case when p_difficulty = 'medium' then p_share else 0 end;
    tgt_h := case when p_difficulty = 'hard' then p_share else 0 end;
  else
    tgt_e := round(p_share * 0.3); tgt_h := round(p_share * 0.3); tgt_m := p_share - tgt_e - tgt_h;
  end if;
  tk_e := least(tgt_e, av_e); tk_m := least(tgt_m, av_m); tk_h := least(tgt_h, av_h);
  short := p_share - (tk_e + tk_m + tk_h);
  if short > 0 and p_difficulty is null then   -- a level is thin: fill from medium first, then easy, then hard
    add_n := least(short, av_m - tk_m); tk_m := tk_m + add_n; short := short - add_n;
    add_n := least(short, av_e - tk_e); tk_e := tk_e + add_n; short := short - add_n;
    add_n := least(short, av_h - tk_h); tk_h := tk_h + add_n; short := short - add_n;
  end if;
  if short > 0 then
    raise exception 'QB_TOPIC_SHORT: % has % available%, % needed', p_title,
      case when p_difficulty is null then av_t else case p_difficulty when 'easy' then av_e when 'medium' then av_m else av_h end end,
      case when p_difficulty is null then '' else ' at ' || p_difficulty || ' level' end, p_share;
  end if;
  -- A few spare candidates per level so a question the full check refuses is replaced; the full check runs on candidates only.
  with e as (select l.question_id, l.level, l.concept_id from quizbox_topic.listable_questions(p_topic, p_tenant, p_acc) l where not (l.question_id = any (p_exclude))),
  ranked as (select e.question_id, e.level, row_number() over (partition by e.level, e.concept_id order by random()) as rr from e),
  ordered as (select r.question_id, r.level, row_number() over (partition by r.level order by r.rr, random()) as pos from ranked r),
  cand as (select o.question_id, o.level, o.pos from ordered o
            where (o.level = 'easy' and tk_e > 0 and o.pos <= tk_e + 4) or (o.level = 'medium' and tk_m > 0 and o.pos <= tk_m + 4) or (o.level = 'hard' and tk_h > 0 and o.pos <= tk_h + 4)),
  ok as (select c.question_id, c.level, c.pos from cand c where (select public.qb_question_is_available(q) from public.questions q where q.id = c.question_id)),
  numbered as (select k.question_id, k.level, row_number() over (partition by k.level order by k.pos) as n from ok k)
  select coalesce(array_agg(n.question_id), '{}') into picked from numbered n
   where (n.level = 'easy' and n.n <= tk_e) or (n.level = 'medium' and n.n <= tk_m) or (n.level = 'hard' and n.n <= tk_h);
  if cardinality(picked) <> p_share then raise exception 'QB_TOPIC_SHORT: % has % available, % needed', p_title, cardinality(picked), p_share; end if;
  return jsonb_build_object('picked', to_jsonb(picked), 'available', av_t, 'easy', tk_e, 'medium', tk_m, 'hard', tk_h);
end $fn$;
