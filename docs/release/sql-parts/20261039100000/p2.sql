create or replace function public.qb_help_save(p_id uuid, p_slug text, p_title text, p_summary text, p_body text, p_category text, p_audiences text[], p_sort integer) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare a public.help_articles; v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  begin
    if p_id is null then
      insert into public.help_articles(slug, title, summary, body, category, audiences, sort_order, updated_by)
      values (v_slug, btrim(p_title), btrim(p_summary), p_body, p_category, coalesce(p_audiences, array['everyone']), coalesce(p_sort, 100), auth.uid()) returning * into a;
    else
      update public.help_articles set slug = v_slug, title = btrim(p_title), summary = btrim(p_summary), body = p_body, category = p_category, audiences = coalesce(p_audiences, audiences),
             sort_order = coalesce(p_sort, sort_order), updated_by = auth.uid(), updated_at = now() where id = p_id returning * into a;
      if a.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
    end if;
  exception when unique_violation then raise exception 'QB_HELP_SLUG_TAKEN' using errcode = '23505';
            when check_violation then raise exception 'QB_HELP_INVALID' using errcode = '22023';
  end;
  return to_jsonb(a) - 'search' - 'updated_by';
end $fn$;

create or replace function public.qb_help_set_state(p_id uuid, p_state text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare a public.help_articles;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_state not in ('draft', 'published') then raise exception 'QB_HELP_INVALID' using errcode = '22023'; end if;
  update public.help_articles set state = p_state, published_at = case when p_state = 'published' then coalesce(published_at, now()) else published_at end, updated_by = auth.uid(), updated_at = now()
   where id = p_id returning * into a;
  if a.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('help.' || p_state, 'help_articles', a.id, jsonb_build_object('slug', a.slug));
  return jsonb_build_object('ok', true, 'state', a.state);
end $fn$;

create or replace function public.qb_help_delete(p_id uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare a public.help_articles;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into a from public.help_articles where id = p_id for update;
  if a.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.state = 'published' then raise exception 'QB_HELP_UNPUBLISH_FIRST' using errcode = '55000'; end if;
  delete from public.help_articles where id = a.id;
  perform quizbox_core.audit('help.delete', 'help_articles', a.id, jsonb_build_object('slug', a.slug));
end $fn$;

revoke all on function public.qb_help_list(text), public.qb_help_get(text), public.qb_help_search(text, text), public.qb_help_track(text, text), public.qb_help_admin_list(), public.qb_help_admin_get(uuid),
  public.qb_help_save(uuid, text, text, text, text, text, text[], integer), public.qb_help_set_state(uuid, text), public.qb_help_delete(uuid) from public, anon, authenticated;
grant execute on function public.qb_help_list(text), public.qb_help_get(text), public.qb_help_search(text, text) to anon, authenticated, service_role;
grant execute on function public.qb_help_admin_list(), public.qb_help_admin_get(uuid), public.qb_help_save(uuid, text, text, text, text, text, text[], integer), public.qb_help_set_state(uuid, text), public.qb_help_delete(uuid) to authenticated;
grant execute on function public.qb_help_track(text, text) to service_role;


notify pgrst, 'reload schema';
