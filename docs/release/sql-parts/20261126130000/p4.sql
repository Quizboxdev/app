-- Numbers only, for sponsors. Groups smaller than 10 learners are not broken down, so no individual can be picked out.
create or replace function quizbox_interschool.aggregate(p_competition uuid) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'schools_registered', (select count(*) from quizbox_interschool.school_entries e where e.competition_id = p_competition and e.status = 'REGISTERED'),
    'schools_invited', (select count(*) from quizbox_interschool.school_entries e where e.competition_id = p_competition and e.invited_at is not null),
    'expected_participants', (select c.expected_participants from quizbox_interschool.competitions c where c.id = p_competition),
    'funded_participants', (select c.funded_participants from quizbox_interschool.competitions c where c.id = p_competition),
    'registered_participants', (select count(*) from quizbox_interschool.candidates k where k.competition_id = p_competition and k.status in ('PENDING', 'CONFIRMED')),
    'took_part', (select count(distinct s.candidate_id) from quizbox_interschool.sittings s join quizbox_interschool.candidates k on k.id = s.candidate_id where k.competition_id = p_competition),
    'regions', coalesce((select jsonb_agg(jsonb_build_object('region', x.region, 'schools', x.schools, 'learners', case when x.learners >= 10 then x.learners end) order by x.schools desc, x.region) from (
        select coalesce(nullif(i.region, ''), 'Not stated') as region, count(distinct e.institution_id) as schools, count(k.id) as learners
          from quizbox_interschool.school_entries e join public.institutions i on i.id = e.institution_id
          left join quizbox_interschool.candidates k on k.competition_id = e.competition_id and k.institution_id = e.institution_id and k.status = 'CONFIRMED'
         where e.competition_id = p_competition and e.status = 'REGISTERED' group by 1) x), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('division', d.title, 'round', r.title, 'finalised', r.finalised_at is not null,
          'eligible', y.eligible, 'completed', y.completed, 'completion_percent', case when y.eligible > 0 then round(100.0 * y.completed / y.eligible, 1) end,
          'average_percent', case when y.completed >= 10 then y.average end) order by d.position, r.round_no)
        from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id
        cross join lateral (select count(*) as eligible, count(*) filter (where not z.absent) as completed, round(avg(z.percent) filter (where not z.absent), 1) as average from quizbox_interschool.round_results z where z.round_id = r.id) y
       where d.competition_id = p_competition and r.finalised_at is not null), '[]'::jsonb),
    'sources', coalesce((select jsonb_object_agg(s.source, s.n) from (select k.source, count(*) n from quizbox_interschool.candidates k where k.competition_id = p_competition and k.status in ('PENDING', 'CONFIRMED') group by k.source) s), '{}'::jsonb),
    'page_views', (select count(*) from quizbox_interschool.events v where v.competition_id = p_competition and v.kind = 'view'),
    'shares', (select count(*) from quizbox_interschool.events v where v.competition_id = p_competition and v.kind = 'share'))
$fn$;

-- A sponsor's competitions with their own quotations and invoices.
create or replace function public.interschool_sponsor_home() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_billing();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status, 'funding', c.funding, 'organiser', c.organiser_user_id = auth.uid(), 'capacity', c.capacity,
      'funding_cleared', c.funding_cleared_at is not null, 'registration', quizbox_interschool.registration_state(c),
      'quotations', coalesce((select jsonb_agg(to_jsonb(q) - 'issued_by' - 'accepted_by' order by q.version desc) from quizbox_interschool.quotations q where q.competition_id = c.id and q.sponsor_user_id = auth.uid()), '[]'::jsonb),
      'invoices', coalesce((select jsonb_agg(to_jsonb(i) - 'approved_by' order by i.created_at desc) from quizbox_interschool.invoices i where i.competition_id = c.id and i.sponsor_user_id = auth.uid()), '[]'::jsonb),
      'figures', quizbox_interschool.aggregate(c.id)) order by c.created_at desc)
    from quizbox_interschool.competitions c
   where (c.organiser_user_id = auth.uid() and c.organiser_kind = 'SPONSOR') or exists (select 1 from quizbox_interschool.quotations q where q.competition_id = c.id and q.sponsor_user_id = auth.uid())), '[]'::jsonb);
end $fn$;

-- Billing of one competition for its managers, plus the figures. Administrators see every quotation and invoice.
create or replace function public.interschool_billing(p_competition uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; admin boolean;
begin
  c := quizbox_interschool.managed(p_competition);
  admin := quizbox_interschool.is_admin();
  return jsonb_build_object('funding', c.funding, 'funded_participants', c.funded_participants, 'capacity', c.capacity, 'funding_cleared', c.funding_cleared_at is not null,
    'rate_minor', quizbox_core.setting('interschool.rate_per_participant_minor'), 'setup_fee_minor', quizbox_core.setting('interschool.setup_fee_minor'),
    'billing_on', coalesce(quizbox_core.flag('flags.interschool_sponsorship'), false),
    'quotations', coalesce((select jsonb_agg(to_jsonb(q) order by q.version desc) from quizbox_interschool.quotations q where q.competition_id = c.id and (admin or q.sponsor_user_id = auth.uid())), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('attempts', (select count(*) from quizbox_interschool.payment_attempts a where a.invoice_id = i.id),
        'needs_refund', exists (select 1 from quizbox_interschool.payment_attempts a where a.invoice_id = i.id and a.status in ('duplicate', 'mismatch'))) order by i.created_at desc)
      from quizbox_interschool.invoices i where i.competition_id = c.id and (admin or i.sponsor_user_id = auth.uid())), '[]'::jsonb),
    'figures', quizbox_interschool.aggregate(c.id));
end $fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.interschool_set_rate(bigint, bigint), public.interschool_quote(uuid, integer, uuid, text, bigint, text, bigint), public.interschool_decide_quote(uuid, boolean), public.interschool_fund_invoice(uuid, text, text),
  public.interschool_payment_start(uuid), public.interschool_payment_apply(text, text, text, text, text, bigint, text, jsonb), public.interschool_sponsor_home(), public.interschool_billing(uuid), public.interschool_payment_status(text) from public, anon, authenticated;
grant execute on function public.interschool_set_rate(bigint, bigint), public.interschool_quote(uuid, integer, uuid, text, bigint, text, bigint), public.interschool_decide_quote(uuid, boolean), public.interschool_fund_invoice(uuid, text, text),
  public.interschool_payment_start(uuid), public.interschool_sponsor_home(), public.interschool_billing(uuid) to authenticated;
grant execute on function public.interschool_payment_apply(text, text, text, text, text, bigint, text, jsonb), public.interschool_payment_status(text) to service_role;


notify pgrst, 'reload schema';
