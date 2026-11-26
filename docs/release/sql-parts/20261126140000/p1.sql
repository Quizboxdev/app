-- QuizBox inter-school competitions, part 5 of 5: certificates with public verification, cancellation notices, reminders and the administrator's overview.
-- Certificates are issued only after every round is finalised (competition COMPLETED), once each, with a unique verification code; they can be revoked with a reason.
-- Certificates are switched on with flags.interschool_certificates.
-- Builds on 20261126100000 to 20261126130000. Additive and idempotent. Rollback: supabase/rollback/interschool_awards.sql


insert into public.platform_settings(key, value, description)
select 'flags.interschool_certificates', 'false'::jsonb, 'Certificates for inter-school competitions'
where not exists (select 1 from public.platform_settings p where p.key = 'flags.interschool_certificates' and p.scope_type = 'global');

create table if not exists quizbox_interschool.certificates (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete restrict,
  division_id uuid not null references quizbox_interschool.divisions(id) on delete restrict,
  user_id uuid references public.profiles(id),
  institution_id uuid references public.institutions(id),
  kind text not null check (kind in ('PARTICIPATION', 'FINALIST', 'WINNER', 'CHAMPION_SCHOOL')),
  recipient_name text not null,
  school_name text,
  competition_title text not null,
  division_title text not null,
  code text not null unique default ('QBC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  issued_at timestamptz not null default now(),
  issued_by uuid not null references public.profiles(id),
  revoked_at timestamptz,
  revoke_reason text,
  check ((kind = 'CHAMPION_SCHOOL') = (user_id is null)),
  check (user_id is not null or institution_id is not null)
);
create unique index if not exists is_certificates_person on quizbox_interschool.certificates(division_id, kind, user_id) where user_id is not null;
create unique index if not exists is_certificates_school on quizbox_interschool.certificates(division_id, kind, institution_id) where user_id is null;
alter table quizbox_interschool.certificates enable row level security;
revoke all on all tables in schema quizbox_interschool from public, anon, authenticated;

create or replace function public.interschool_issue_certificates(p_competition uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; d record; final_round uuid; rounds integer; n integer := 0; added integer; k record;
begin
  c := quizbox_interschool.managed(p_competition, true);
  if not coalesce(quizbox_core.flag('flags.interschool_certificates'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if c.status <> 'COMPLETED' then raise exception 'IS_RESULTS_NOT_FINAL' using errcode = '55000'; end if;
  if exists (select 1 from quizbox_interschool.disputes q where q.competition_id = c.id and q.status = 'OPEN') then raise exception 'IS_DISPUTES_OPEN' using errcode = '55000'; end if;
  for d in select * from quizbox_interschool.divisions v where v.competition_id = c.id order by v.position loop
    select id into final_round from quizbox_interschool.rounds r where r.division_id = d.id order by r.round_no desc limit 1;
    select count(*) into rounds from quizbox_interschool.rounds r where r.division_id = d.id;
    insert into quizbox_interschool.certificates(competition_id, division_id, user_id, institution_id, kind, recipient_name, school_name, competition_title, division_title, issued_by)
    select c.id, d.id, cd.user_id, cd.institution_id, w.kind, p.full_name, i.name, c.title, d.title, auth.uid()
      from quizbox_interschool.candidates cd join public.profiles p on p.id = cd.user_id left join public.institutions i on i.id = cd.institution_id
      cross join lateral (
        select 'PARTICIPATION' as kind where exists (select 1 from quizbox_interschool.sittings s join quizbox_interschool.rounds r on r.id = s.round_id where r.division_id = d.id and s.candidate_id = cd.id)
        union all select 'FINALIST' where rounds > 1 and exists (select 1 from quizbox_interschool.round_results y where y.round_id = final_round and y.candidate_id = cd.id and not y.absent)
        union all select 'WINNER' where exists (select 1 from quizbox_interschool.round_results y where y.round_id = final_round and y.candidate_id = cd.id and not y.absent and y.rank = 1)) w
     where cd.division_id = d.id and cd.status = 'CONFIRMED'
    on conflict do nothing;
    get diagnostics added = row_count; n := n + added;
    insert into quizbox_interschool.certificates(competition_id, division_id, institution_id, kind, recipient_name, school_name, competition_title, division_title, issued_by)
    select c.id, d.id, s.institution_id, 'CHAMPION_SCHOOL', i.name, i.name, c.title, d.title, auth.uid()
      from quizbox_interschool.school_results s join public.institutions i on i.id = s.institution_id
     where s.round_id = final_round and s.rank = 1 and s.eligible
    on conflict do nothing;
    get diagnostics added = row_count; n := n + added;
  end loop;
  if n > 0 then
    for k in select distinct user_id from quizbox_interschool.certificates where competition_id = c.id and user_id is not null loop
      perform quizbox_interschool.notify(k.user_id, 'Your certificate is ready', c.title || ': download your certificate.', '/interschool/certificates');
    end loop;
  end if;
  perform quizbox_interschool.audit('certificates_issued', c.id, jsonb_build_object('new', n));
  return jsonb_build_object('ok', true, 'issued', n, 'total', (select count(*) from quizbox_interschool.certificates x where x.competition_id = c.id));
end $fn$;

create or replace function public.interschool_revoke_certificate(p_code text, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x quizbox_interschool.certificates;
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  update quizbox_interschool.certificates set revoked_at = now(), revoke_reason = btrim(p_reason) where code = upper(btrim(p_code)) and revoked_at is null returning * into x;
  if x.id is null then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_interschool.audit('certificate_revoked', x.competition_id, jsonb_build_object('certificate', x.id, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $fn$;

-- Your own certificates, plus your school's champion certificates and learners' certificates if you are verified school staff.
create or replace function public.interschool_my_certificates() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  return coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'kind', x.kind, 'recipient', x.recipient_name, 'school', x.school_name, 'competition', x.competition_title, 'division', x.division_title, 'issued_at', x.issued_at, 'mine', x.user_id = auth.uid()) order by x.issued_at desc, x.recipient_name)
    from quizbox_interschool.certificates x where x.revoked_at is null and (x.user_id = auth.uid() or x.institution_id in (select quizbox_interschool.my_schools()))), '[]'::jsonb);
end $fn$;
