create or replace function public.qb_social_admin_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('flag', coalesce(quizbox_core.flag('flags.social_channels'), false),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'handle', c.handle, 'target', c.target, 'url', c.url, 'active', c.active, 'sort_order', c.sort_order, 'updated_at', c.updated_at)
                                       order by c.sort_order, c.created_at) from public.social_channels c), '[]'::jsonb));
end $fn$;

-- Add (no id) or change (id) one channel. p: { id?, kind, label, handle?, target, active? }
create or replace function public.qb_social_admin_save(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_kind text := btrim(coalesce(p ->> 'kind', '')); v_label text := btrim(regexp_replace(coalesce(p ->> 'label', ''), '[[:cntrl:]]', ' ', 'g'));
        v_handle text := nullif(left(btrim(regexp_replace(coalesce(p ->> 'handle', ''), '[[:cntrl:]]', ' ', 'g')), 80), ''); v_target text := btrim(coalesce(p ->> 'target', ''));
        v_active boolean := coalesce((p ->> 'active')::boolean, true); v_url text; r public.social_channels;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if length(v_label) not between 2 and 60 or v_label ~ '[<>]' or (v_handle is not null and v_handle ~ '[<>]') then raise exception 'QB_SOCIAL_INVALID'; end if;
  v_url := public.qb_social_link(v_kind, v_target);
  if v_id is null then
    if (select count(*) from public.social_channels) >= 30 then raise exception 'QB_SOCIAL_TOO_MANY'; end if;
    insert into public.social_channels(kind, label, handle, target, url, active, sort_order)
    values (v_kind, v_label, v_handle, v_target, v_url, v_active, coalesce((select max(sort_order) + 1 from public.social_channels), 1)) returning * into r;
  else
    update public.social_channels set kind = v_kind, label = v_label, handle = v_handle, target = v_target, url = v_url, active = v_active, updated_at = now() where id = v_id returning * into r;
    if r.id is null then raise exception 'QB_NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label, 'url', r.url, 'active', r.active);
end $fn$;

create or replace function public.qb_social_admin_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  delete from public.social_channels where id = p_id; get diagnostics n = row_count;
  if n = 0 then raise exception 'QB_NOT_FOUND'; end if;
  return jsonb_build_object('deleted', p_id);
end $fn$;

-- p_ids: every channel id in the order wanted (a channel not listed keeps its place after the listed ones).
create or replace function public.qb_social_admin_reorder(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  update public.social_channels c set sort_order = o.n, updated_at = now() from (select id, ord::integer as n from unnest(coalesce(p_ids, '{}')) with ordinality as u(id, ord)) o where c.id = o.id;
  update public.social_channels c set sort_order = 1000 + s.rn from (select id, row_number() over (order by sort_order, created_at) as rn from public.social_channels where id <> all (coalesce(p_ids, '{}'))) s where c.id = s.id;
  return jsonb_build_object('ok', true);
end $fn$;

-- The six channels the app shows today, so switching the flag on changes nothing until staff edit the list.
insert into public.social_channels(kind, label, handle, target, url, sort_order)
select v.kind, v.label, v.handle, v.target, v.target, v.ord from (values
  ('tiktok', 'TikTok', '@quizz_box', 'https://www.tiktok.com/@quizz_box', 1),
  ('instagram', 'Instagram', '@quizz.box.solutions', 'https://www.instagram.com/quizz.box.solutions/', 2),
  ('facebook', 'Facebook', 'quizbox.solutions', 'https://www.facebook.com/quizbox.solutions/', 3),
  ('youtube', 'YouTube', '@QuizBoxsolutions', 'https://www.youtube.com/@QuizBoxsolutions', 4),
  ('linkedin', 'LinkedIn', 'QuizBox Solutions', 'https://www.linkedin.com/company/94181986', 5),
  ('snapchat', 'Snapchat', 'quizbox', 'https://www.snapchat.com/add/quizbox', 6)) as v(kind, label, handle, target, ord)
where not exists (select 1 from public.social_channels);

revoke all on function public.qb_social_channels() from public, anon, authenticated;
revoke all on function public.qb_social_admin_list() from public, anon, authenticated;
revoke all on function public.qb_social_admin_save(jsonb) from public, anon, authenticated;
revoke all on function public.qb_social_admin_delete(uuid) from public, anon, authenticated;
revoke all on function public.qb_social_admin_reorder(uuid[]) from public, anon, authenticated;
grant execute on function public.qb_social_channels() to anon, authenticated;
grant execute on function public.qb_social_admin_list() to authenticated;
grant execute on function public.qb_social_admin_save(jsonb) to authenticated;
grant execute on function public.qb_social_admin_delete(uuid) to authenticated;
grant execute on function public.qb_social_admin_reorder(uuid[]) to authenticated;
