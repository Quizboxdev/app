create or replace function public.qb_policy_public(p_slug text, p_version integer default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare d public.policy_documents; v public.policy_versions;
begin
  select * into d from public.policy_documents where slug = lower(btrim(coalesce(p_slug, ''))) and active;
  if d.id is null then return null; end if;
  if p_version is null then select * into v from public.policy_versions where document_id = d.id and state = 'published';
  else select * into v from public.policy_versions where document_id = d.id and version_no = p_version and state in ('published', 'superseded'); end if;
  if v.id is null then return null; end if;
  return jsonb_build_object('slug', d.slug, 'title', d.title, 'version_no', v.version_no, 'state', v.state, 'effective_at', coalesce(v.effective_at, v.published_at), 'summary', v.summary,
    'body', public.qb_policy_resolve(v.body), 'required', d.required,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version_no', x.version_no, 'effective_at', coalesce(x.effective_at, x.published_at), 'summary', x.summary, 'state', x.state) order by x.version_no desc)
                            from public.policy_versions x where x.document_id = d.id and x.state in ('published', 'superseded')), '[]'::jsonb));
end $fn$;

-- Management: owner and super admin only.
create or replace function public.qb_policy_admin_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'slug', d.slug, 'title', d.title, 'required', d.required, 'active', d.active,
      'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version_no', v.version_no, 'state', v.state, 'summary', v.summary, 'effective_at', v.effective_at,
          'requires_reack', v.requires_reack, 'published_at', v.published_at, 'missing', case when v.state = 'draft' then to_jsonb(public.qb_policy_missing(v.body)) else '[]'::jsonb end) order by v.version_no desc)
         from public.policy_versions v where v.document_id = d.id), '[]'::jsonb)) order by d.sort_order, d.title) from public.policy_documents d), '[]'::jsonb);
end $fn$;

create or replace function public.qb_policy_admin_get(p_version uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v public.policy_versions;
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into v from public.policy_versions where id = p_version;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return to_jsonb(v) || jsonb_build_object('missing', to_jsonb(public.qb_policy_missing(v.body)), 'resolved', public.qb_policy_resolve(v.body));
end $fn$;

-- One draft per document. Saving again changes that draft; a new draft starts from the next version number.
create or replace function public.qb_policy_draft_save(p_document uuid, p_body text, p_summary text, p_effective timestamptz, p_requires_reack boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v public.policy_versions;
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.policy_documents where id = p_document) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if length(coalesce(p_body, '')) > 200000 then raise exception 'QB_POLICY_TOO_LONG' using errcode = '22023'; end if;
  select * into v from public.policy_versions where document_id = p_document and state = 'draft' for update;
  if v.id is null then
    insert into public.policy_versions(document_id, version_no, body, summary, effective_at, requires_reack, created_by)
    values (p_document, coalesce((select max(version_no) from public.policy_versions where document_id = p_document), 0) + 1, coalesce(p_body, ''), left(coalesce(p_summary, ''), 500), p_effective, coalesce(p_requires_reack, false), auth.uid()) returning * into v;
  else
    update public.policy_versions set body = coalesce(p_body, ''), summary = left(coalesce(p_summary, ''), 500), effective_at = p_effective, requires_reack = coalesce(p_requires_reack, false) where id = v.id returning * into v;
  end if;
  return jsonb_build_object('id', v.id, 'version_no', v.version_no, 'state', v.state, 'missing', to_jsonb(public.qb_policy_missing(v.body)));
end $fn$;

create or replace function public.qb_policy_draft_discard(p_version uuid) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  delete from public.policy_versions where id = p_version and state = 'draft';
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
end $fn$;

create or replace function public.qb_policy_publish(p_version uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v public.policy_versions; d public.policy_documents; miss text[]; resolved text;
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into v from public.policy_versions where id = p_version for update;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.state <> 'draft' then raise exception 'QB_POLICY_NOT_DRAFT' using errcode = '55000'; end if;
  select * into d from public.policy_documents where id = v.document_id;
  if length(btrim(v.body)) < 200 then raise exception 'QB_POLICY_TOO_SHORT' using errcode = '22023'; end if;
  if length(btrim(v.summary)) < 5 then raise exception 'QB_POLICY_SUMMARY_REQUIRED' using errcode = '22023'; end if;
  miss := public.qb_policy_missing(v.body);
  if cardinality(miss) > 0 then raise exception 'QB_POLICY_VARIABLES_MISSING: %', array_to_string(miss, ', ') using errcode = '22023'; end if;
  resolved := public.qb_policy_resolve(v.body);
  update public.policy_versions set state = 'superseded' where document_id = v.document_id and state = 'published';
  update public.policy_versions set state = 'published', fingerprint = encode(sha256(convert_to(resolved, 'UTF8')), 'hex'), published_by = auth.uid(), published_at = now(), effective_at = coalesce(effective_at, now())
   where id = v.id returning * into v;
  perform quizbox_core.audit('policy.publish', 'policy_versions', v.id, jsonb_build_object('slug', d.slug, 'version', v.version_no, 'requires_reack', v.requires_reack));
  return jsonb_build_object('ok', true, 'slug', d.slug, 'version_no', v.version_no, 'fingerprint', v.fingerprint);
end $fn$;

create or replace function public.qb_policy_document_save(p_slug text, p_title text, p_required boolean, p_active boolean, p_sort integer) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare d public.policy_documents;
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  insert into public.policy_documents(slug, title, required, active, sort_order) values (lower(btrim(p_slug)), btrim(p_title), coalesce(p_required, true), coalesce(p_active, true), coalesce(p_sort, 100))
  on conflict (slug) do update set title = excluded.title, required = excluded.required, active = excluded.active, sort_order = excluded.sort_order returning * into d;
  return to_jsonb(d);
end $fn$;

create or replace function public.qb_company_details() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'value', c.value) order by c.sort_order, c.key) from public.company_details c), '[]'::jsonb);
end $fn$;

