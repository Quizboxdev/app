create or replace function public.challenge_material_read(p_slug text, p_section uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; s public.challenge_sections; a public.challenge_content_assets; v public.challenge_content_versions; nm text; prev_id uuid; next_id uuid;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if public.qb_challenge_reader_state(c) <> 'OPEN' then raise exception 'READER_CLOSED' using errcode = '55000'; end if;
  select s2.* into s from public.challenge_sections s2 join public.challenge_content_versions v2 on v2.id = s2.version_id join public.challenge_content_assets a2 on a2.id = v2.asset_id
   where s2.id = p_section and a2.campaign_id = c.id and v2.version = a2.current_version and (s2.reader_visible or c.owner_id = auth.uid() or public.qb_challenge_admin());
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if (select count(*) from public.challenge_reads where user_id = auth.uid() and read_at > now() - interval '1 hour') >= 300 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  insert into public.challenge_reads(user_id, campaign_id, section_id) values (auth.uid(), c.id, s.id);
  if random() < 0.02 then delete from public.challenge_reads where read_at < now() - interval '2 days'; end if;
  select * into v from public.challenge_content_versions where id = s.version_id;
  select * into a from public.challenge_content_assets where id = v.asset_id;
  select s3.id into prev_id from public.challenge_sections s3 where s3.version_id = s.version_id and s3.section_no < s.section_no and (s3.reader_visible or c.owner_id = auth.uid() or public.qb_challenge_admin()) order by s3.section_no desc limit 1;
  select s3.id into next_id from public.challenge_sections s3 where s3.version_id = s.version_id and s3.section_no > s.section_no and (s3.reader_visible or c.owner_id = auth.uid() or public.qb_challenge_admin()) order by s3.section_no limit 1;
  select split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end into nm from public.profiles p where p.id = auth.uid();
  return jsonb_build_object('document', a.title, 'content_type', a.content_type, 'section_id', s.id, 'no', s.section_no, 'title', s.title, 'words', s.word_count, 'prev', prev_id, 'next', next_id, 'reader', nm,
    'ends_at', c.ends_at, 'passages', coalesce((select jsonb_agg(jsonb_build_object('position', ch.position, 'heading', ch.heading, 'body', ch.body) order by ch.position)
        from public.challenge_source_chunks ch where ch.version_id = s.version_id and ch.position between s.first_position and least(s.last_position, s.first_position + 79)), '[]'::jsonb));
end $fn$;
revoke all on function public.qb_challenge_reader_state(public.challenge_campaigns) from public, anon, authenticated;

-- 7. Templates: copy a campaign (questions, rounds, prizes, look, material and its chapters) into a new draft with no audience and no dates, so it can be run again for someone else.
create or replace function public.challenge_clone(p_id uuid, p_title text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; base text; s text; n integer := 0; v_new uuid; v_title text; v_code text; a record; v_asset uuid; v_ver uuid; v_limit integer;
begin
  c := public.qb_challenge_owned(p_id);
  v_limit := case when exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) = 'student') then 5 else 20 end;
  if (select count(*) from public.challenge_campaigns where owner_id = auth.uid() and created_at > now() - interval '1 day') >= v_limit then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  v_title := left(coalesce(nullif(btrim(p_title), ''), 'Copy of ' || c.title), 120);
  base := left(regexp_replace(regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), 50);
  if length(base) < 3 then base := lower(c.format); end if; s := base;
  while exists (select 1 from public.challenge_campaigns where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  v_code := case when c.visibility = 'PRIVATE' then upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)) end;
  insert into public.challenge_campaigns(owner_id, slug, title, summary, category, visibility, access_code, question_count, time_limit_seconds, max_attempts, reward_text, brand, stage_count, format,
                                         target_levels, reader_enabled, reader_closes, cloned_from)
  values (auth.uid(), s, v_title, c.summary, c.category, c.visibility, v_code, c.question_count, c.time_limit_seconds, c.max_attempts, c.reward_text, c.brand, c.stage_count, c.format,
          c.target_levels, c.reader_enabled, 'END', c.id) returning id into v_new;
  insert into public.challenge_stages(campaign_id, stage_no, title, question_count, time_limit_seconds, pass_percent, advance_top_n) select v_new, stage_no, title, question_count, time_limit_seconds, pass_percent, null from public.challenge_stages where campaign_id = c.id;
  insert into public.challenge_prizes(campaign_id, rank_from, rank_to, kind, title, details) select v_new, rank_from, rank_to, kind, title, details from public.challenge_prizes where campaign_id = c.id;
  drop table if exists qb_clone_map; create temporary table qb_clone_map(old_id uuid, new_id uuid) on commit drop;
  for a in select * from public.challenge_content_assets where campaign_id = c.id and current_version > 0 order by created_at loop
    insert into public.challenge_content_assets(campaign_id, owner_id, title, kind, rights_attested, current_version, content_type) values (v_new, auth.uid(), a.title, a.kind, true, 1, a.content_type) returning id into v_asset;
    insert into public.challenge_content_versions(asset_id, version, source_name, sha256, char_count, chunk_count, word_count, created_by)
      select v_asset, 1, source_name, sha256, char_count, chunk_count, word_count, auth.uid() from public.challenge_content_versions where asset_id = a.id and version = a.current_version returning id into v_ver;
    insert into public.challenge_source_chunks(version_id, position, heading, body) select v_ver, ch.position, ch.heading, ch.body from public.challenge_source_chunks ch
      join public.challenge_content_versions ov on ov.id = ch.version_id where ov.asset_id = a.id and ov.version = a.current_version;
    insert into qb_clone_map select oc.id, nc.id from public.challenge_source_chunks oc join public.challenge_content_versions ov on ov.id = oc.version_id and ov.asset_id = a.id and ov.version = a.current_version
      join public.challenge_source_chunks nc on nc.version_id = v_ver and nc.position = oc.position;
    insert into public.challenge_sections(version_id, section_no, title, first_position, last_position, word_count, reader_visible)
      select v_ver, sc.section_no, sc.title, sc.first_position, sc.last_position, sc.word_count, sc.reader_visible from public.challenge_sections sc join public.challenge_content_versions ov on ov.id = sc.version_id where ov.asset_id = a.id and ov.version = a.current_version;
  end loop;
  insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id, stage_no, source_chunk_id, source_quote)
    select v_new, q.position, q.question_text, q.options, q.correct_index, q.explanation, q.source_question_id, q.stage_no, m.new_id, case when m.new_id is not null then q.source_quote end
      from public.challenge_questions q left join qb_clone_map m on m.old_id = q.source_chunk_id where q.campaign_id = c.id;
  perform public.qb_challenge_audit('challenge_cloned', v_new, jsonb_build_object('from', c.id));
  return jsonb_build_object('id', v_new, 'slug', s, 'format', c.format);
end $fn$;
