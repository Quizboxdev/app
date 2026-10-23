-- Policies as a managed section (Terms, Privacy, Refunds, Cookies) with versions, company details as variables, and acknowledgement.
--   company_details        the facts policies use as {{company_name}} {{support_email}} ... (entered once in Admin)
--   policy_documents       one row per document (slug, title, required = must be accepted after sign-up and after a material change)
--   policy_versions        text, summary, effective date; draft -> published -> superseded; a published version can never be edited
--   policy_acceptances     who accepted which version, when, by whom (a teacher for a child account), with a fingerprint of the text
-- Publishing is refused while the text uses a {{variable}} that has no value, so nothing goes live with a blank fact. Owner and super admin manage; everyone can read the published text.
-- Writes only through the checked functions below. Additive and idempotent. Rollback: supabase/rollback/policy_cms.sql.
begin;

create table if not exists public.company_details (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null, value text not null default '' check (length(value) <= 500),
  sort_order integer not null default 100, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.company_details(key, label, value, sort_order) values
  ('company_name', 'Company name', 'QuizBox Solutions', 10),
  ('country', 'Country of registration', 'Ghana', 20),
  ('registration_number', 'Company registration number', '', 30),
  ('registered_address', 'Registered office address', '', 40),
  ('support_email', 'Support email address', '', 50),
  ('dpo_contact', 'Data protection contact (name and email)', '', 60),
  ('dpc_registration', 'Data Protection Commission registration number', '', 70),
  ('data_location', 'Where data is stored (for example: the European Union and the United States)', '', 80),
  ('retention_tickets', 'How long support tickets and files are kept', '', 90),
  ('retention_inactive', 'How long inactive accounts are kept', '', 100),
  ('retention_attempts', 'How long quiz attempts and results are kept', '', 110)
on conflict (key) do nothing;

create table if not exists public.policy_documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  title text not null check (length(btrim(title)) between 3 and 80),
  required boolean not null default true,
  sort_order integer not null default 100, active boolean not null default true, created_at timestamptz not null default now()
);
insert into public.policy_documents(slug, title, required, sort_order) values
  ('terms', 'Terms of Use', true, 10), ('privacy', 'Privacy Notice', true, 20), ('refunds', 'Refund Policy', false, 30), ('cookies', 'Cookie and Storage Notice', false, 40)
on conflict (slug) do nothing;

create table if not exists public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.policy_documents(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  body text not null default '' check (length(body) <= 200000),
  summary text not null default '' check (length(summary) <= 500),
  effective_at timestamptz, requires_reack boolean not null default false,
  state text not null default 'draft' check (state in ('draft', 'published', 'superseded')),
  fingerprint text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  published_by uuid references public.profiles(id), published_at timestamptz,
  unique (document_id, version_no)
);
create unique index if not exists policy_versions_one_draft on public.policy_versions(document_id) where state = 'draft';
create unique index if not exists policy_versions_one_published on public.policy_versions(document_id) where state = 'published';

create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  version_id uuid not null references public.policy_versions(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  accepted_by uuid references public.profiles(id) on delete set null,
  fingerprint text not null,
  unique (user_id, version_id)
);
create index if not exists policy_acceptances_user on public.policy_acceptances(user_id);

alter table public.company_details enable row level security;
alter table public.policy_documents enable row level security;
alter table public.policy_versions enable row level security;
alter table public.policy_acceptances enable row level security;
revoke all on public.company_details, public.policy_documents, public.policy_versions, public.policy_acceptances from anon, authenticated;

-- A published version is evidence of what people accepted: its text can never change, and it can never be deleted. Only draft -> published and published -> superseded are allowed.
create or replace function public.qb_trg_policy_version_guard() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then raise exception 'QB_POLICY_IMMUTABLE' using errcode = '55000'; end if;
    return old;
  end if;
  if old.state <> 'draft' then
    if old.state = 'published' and new.state = 'superseded' and new.body = old.body and new.summary = old.summary and new.fingerprint is not distinct from old.fingerprint then return new; end if;
    raise exception 'QB_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $fn$;
drop trigger if exists qb_policy_version_guard on public.policy_versions;
create trigger qb_policy_version_guard before update or delete on public.policy_versions for each row execute function public.qb_trg_policy_version_guard();
revoke all on function public.qb_trg_policy_version_guard() from public, anon, authenticated;

-- Variables: {{key}} in the text is replaced by the company detail of that name. Internal helpers, not callable from a browser.
create or replace function public.qb_policy_missing(p_body text) returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}') from regexp_matches(coalesce(p_body, ''), '\{\{([a-z][a-z0-9_]*)\}\}', 'g') as m
   where not exists (select 1 from public.company_details c where c.key = m[1] and btrim(c.value) <> '');
$fn$;
create or replace function public.qb_policy_resolve(p_body text) returns text language plpgsql stable security definer set search_path = '' as $fn$
declare r record; t text := coalesce(p_body, '');
begin
  for r in select key, value from public.company_details where btrim(value) <> '' loop t := replace(t, '{{' || r.key || '}}', btrim(r.value)); end loop;
  return t;
end $fn$;
revoke all on function public.qb_policy_missing(text), public.qb_policy_resolve(text) from public, anon, authenticated;

-- What a visitor sees: the live version (or an older published one by number), with the company details filled in. Public by design: it returns only published text.
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

commit;
notify pgrst, 'reload schema';
