create or replace function public.qb_company_details() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'value', c.value) order by c.sort_order, c.key) from public.company_details c), '[]'::jsonb);
end $fn$;

create or replace function public.qb_company_detail_save(p_key text, p_value text) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if length(coalesce(p_value, '')) > 500 then raise exception 'QB_POLICY_TOO_LONG' using errcode = '22023'; end if;
  if btrim(coalesce(p_value, '')) = '' and exists (select 1 from public.policy_versions v where v.state = 'published' and v.body like '%{{' || p_key || '}}%') then
    raise exception 'QB_POLICY_VARIABLE_IN_USE' using errcode = '55000';   -- a live policy uses it: replace the policy first
  end if;
  update public.company_details set value = btrim(coalesce(p_value, '')), updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('company.detail', 'company_details', null, jsonb_build_object('key', p_key));
end $fn$;

-- Acknowledgement. A person must accept every required, live document. The first live version counts, and so does any later version that was marked "requires re-acknowledgement";
-- a small edit marked as a notice does not ask again. Teacher-managed child accounts are never stopped by the screen: the teacher accepts for them (qb_policy_record_for_managed).
create or replace function public.qb_policy_pending() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.managed_by is not null) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('version_id', l.id, 'slug', d.slug, 'title', d.title, 'version_no', l.version_no, 'summary', l.summary) order by d.sort_order)
    from public.policy_documents d
    join public.policy_versions l on l.document_id = d.id and l.state = 'published'
    where d.active and d.required
      and not exists (
        select 1 from public.policy_acceptances a join public.policy_versions av on av.id = a.version_id
         where a.user_id = auth.uid() and av.document_id = d.id
           and av.version_no >= coalesce((select max(g.version_no) from public.policy_versions g where g.document_id = d.id and g.state in ('published', 'superseded')
                                            and (g.requires_reack or g.version_no = (select min(f.version_no) from public.policy_versions f where f.document_id = d.id and f.state in ('published', 'superseded')))), 1))), '[]'::jsonb);
end $fn$;

create or replace function public.qb_policy_accept(p_version_ids uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare pv public.policy_versions; n integer := 0; vid uuid;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_version_ids is null or cardinality(p_version_ids) = 0 or cardinality(p_version_ids) > 10 then raise exception 'QB_INVALID_POLICY' using errcode = '22023'; end if;
  foreach vid in array p_version_ids loop
    select x.* into pv from public.policy_versions x join public.policy_documents d on d.id = x.document_id where x.id = vid and x.state = 'published' and d.active;
    if pv.id is null then raise exception 'QB_INVALID_POLICY' using errcode = '22023'; end if;       -- only the live version of a live document can be accepted
    insert into public.policy_acceptances(user_id, version_id, accepted_by, fingerprint) values (auth.uid(), pv.id, auth.uid(), coalesce(pv.fingerprint, ''))
    on conflict (user_id, version_id) do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'accepted', n);
end $fn$;

create or replace function public.qb_policy_my_acceptances() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('slug', d.slug, 'title', d.title, 'version_no', v.version_no, 'accepted_at', a.accepted_at) order by a.accepted_at desc)
    from public.policy_acceptances a join public.policy_versions v on v.id = a.version_id join public.policy_documents d on d.id = v.document_id where a.user_id = auth.uid()), '[]'::jsonb);
end $fn$;

-- Called by the server when a teacher creates a child account: the teacher's acceptance is recorded for the child, with the teacher named as the person who accepted.
create or replace function public.qb_policy_record_for_managed(p_learner uuid, p_teacher uuid) returns integer language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  insert into public.policy_acceptances(user_id, version_id, accepted_by, fingerprint)
  select p_learner, l.id, p_teacher, coalesce(l.fingerprint, '') from public.policy_documents d join public.policy_versions l on l.document_id = d.id and l.state = 'published' where d.active and d.required
  on conflict (user_id, version_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function public.qb_policy_public(text, integer), public.qb_policy_admin_list(), public.qb_policy_admin_get(uuid), public.qb_policy_draft_save(uuid, text, text, timestamptz, boolean),
  public.qb_policy_draft_discard(uuid), public.qb_policy_publish(uuid), public.qb_policy_document_save(text, text, boolean, boolean, integer), public.qb_company_details(), public.qb_company_detail_save(text, text),
  public.qb_policy_pending(), public.qb_policy_accept(uuid[]), public.qb_policy_my_acceptances(), public.qb_policy_record_for_managed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.qb_policy_public(text, integer) to anon, authenticated, service_role;
grant execute on function public.qb_policy_admin_list(), public.qb_policy_admin_get(uuid), public.qb_policy_draft_save(uuid, text, text, timestamptz, boolean), public.qb_policy_draft_discard(uuid), public.qb_policy_publish(uuid),
  public.qb_policy_document_save(text, text, boolean, boolean, integer), public.qb_company_details(), public.qb_company_detail_save(text, text), public.qb_policy_pending(), public.qb_policy_accept(uuid[]), public.qb_policy_my_acceptances() to authenticated;
grant execute on function public.qb_policy_record_for_managed(uuid, uuid) to service_role;


notify pgrst, 'reload schema';
