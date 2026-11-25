create or replace function public.qb_admin_live(p_section text, p_days integer default 30, p_max_age integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_key text; ttl integer; snap quizbox_stats.snapshots; data jsonb; failed boolean := false;
  is_super boolean; caps text[] := array['a'];
begin
  if auth.uid() is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_section is null or p_section not in ('people', 'content', 'queues') then raise exception 'QB_INVALID_ACTION' using errcode = '22023'; end if;
  v_key := case when p_section = 'people' then 'people:' || days else p_section end;
  -- How old a snapshot may be before it is calculated again. A refresh button may ask for newer figures, but not newer than 5 seconds.
  ttl := case p_section when 'queues' then 20 when 'people' then 60 else 90 end;
  if p_max_age is not null then ttl := least(ttl, greatest(p_max_age, 5)); end if;

  select * into snap from quizbox_stats.snapshots s where s.section = v_key;
  if snap.section is null or snap.computed_at <= clock_timestamp() - make_interval(secs => ttl) then
    -- Only one caller calculates at a time. The others take the last good figures; with nothing stored yet they wait for the first calculation.
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('qb_admin_live:' || v_key)) then
      begin
        perform quizbox_stats.refresh(v_key);
      exception when query_canceled or others then
        if snap.section is null then raise; end if;
        failed := true;
      end;
    elsif snap.section is null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('qb_admin_live:' || v_key));
      if not exists (select 1 from quizbox_stats.snapshots s where s.section = v_key) then perform quizbox_stats.refresh(v_key); end if;
    end if;
    select * into snap from quizbox_stats.snapshots s where s.section = v_key;
  end if;

  if p_section = 'queues' then
    is_super := quizbox_market.is_super();
    if is_super then caps := caps || 's'::text; end if;
    if is_super or quizbox_sme.has_capability('finance_admin') then caps := caps || 'f'::text; end if;
    if is_super or quizbox_sme.has_capability('content_admin') then caps := caps || 'c'::text; end if;
    if is_super or quizbox_sme.has_capability('sme_support') then caps := caps || 'p'::text; end if;
    data := coalesce((select jsonb_object_agg(e.key, e.value->'n') from jsonb_each(snap.payload) e where e.value->>'cap' = any (caps)), '{}'::jsonb);
  else
    data := snap.payload;
  end if;

  return jsonb_build_object('section', p_section, 'data', data, 'computed_at', snap.computed_at,
    'age_seconds', greatest(0, floor(extract(epoch from clock_timestamp() - snap.computed_at)))::integer,
    'stale', failed or snap.computed_at <= clock_timestamp() - make_interval(secs => ttl));
end $fn$;

revoke all on function public.qb_admin_live(text, integer, integer) from public, anon, authenticated;
grant execute on function public.qb_admin_live(text, integer, integer) to authenticated;

-- Optional scheduler: where pg_cron is installed, keep the snapshot warm. Without it the figures are calculated when someone asks.
do $do$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule('qb-admin-live-refresh', '* * * * *', 'select quizbox_stats.refresh_all()');
  end if;
exception when others then raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $do$;


notify pgrst, 'reload schema';
