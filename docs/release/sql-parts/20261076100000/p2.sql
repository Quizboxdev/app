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
