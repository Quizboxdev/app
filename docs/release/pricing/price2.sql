create or replace function public.qb_price_save(p_code text, p_row jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k text; r public.price_list; v_code text := lower(btrim(p_code)); inc jsonb;
begin
  if not public.qb_price_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if jsonb_typeof(p_row) <> 'object' then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_row) loop
    if k not in ('kind','name','audience','description','includes','period','price_minor','currency','checkout_url','highlight','active','starts_at','ends_at','sort_order','grants') then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  end loop;
  if p_row ? 'includes' then
    inc := p_row->'includes';
    if jsonb_typeof(inc) <> 'array' or exists (select 1 from jsonb_array_elements(inc) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 120) then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  end if;
  select * into r from public.price_list where code = v_code;
  if not found then
    if not (p_row ? 'name' and p_row ? 'audience') then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
    insert into public.price_list(code, name, audience, updated_by) values (v_code, btrim(p_row->>'name'), p_row->>'audience', auth.uid()) returning * into r;
  end if;
  update public.price_list set
    kind = coalesce(p_row->>'kind', kind), name = coalesce(nullif(btrim(p_row->>'name'), ''), name), audience = coalesce(p_row->>'audience', audience),
    description = coalesce(left(p_row->>'description', 300), description), includes = coalesce(p_row->'includes', includes), period = coalesce(p_row->>'period', period),
    price_minor = case when p_row ? 'price_minor' then (p_row->>'price_minor')::integer else price_minor end,
    currency = coalesce(upper(p_row->>'currency'), currency),
    checkout_url = case when p_row ? 'checkout_url' then nullif(btrim(p_row->>'checkout_url'), '') else checkout_url end,
    highlight = coalesce((p_row->>'highlight')::boolean, highlight), active = coalesce((p_row->>'active')::boolean, active),
    starts_at = case when p_row ? 'starts_at' then (p_row->>'starts_at')::timestamptz else starts_at end, ends_at = case when p_row ? 'ends_at' then (p_row->>'ends_at')::timestamptz else ends_at end,
    sort_order = coalesce((p_row->>'sort_order')::integer, sort_order), grants = coalesce(p_row->'grants', grants), updated_at = now(), updated_by = auth.uid()
   where id = r.id returning * into r;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'price_saved', 'price_list', r.id, 'ok',
    jsonb_build_object('code', r.code, 'price_minor', r.price_minor, 'active', r.active, 'has_link', r.checkout_url is not null));
  return to_jsonb(r) - 'updated_by';
end $fn$;

-- Starter rows. Nothing is priced and nothing needs a link yet; change them in Admin, Prices. Safe to run again: existing rows are never overwritten.
insert into public.price_list(code, kind, name, audience, description, includes, period, price_minor, highlight, active, sort_order) values
  ('learner_free', 'plan', 'Free', 'learner', 'Start learning today.', '["Free practice sessions to try QuizBox","Join challenges and competitions","Read the material before you play"]', 'free', 0, false, true, 10),
  ('learner_monthly', 'plan', 'Learner Monthly', 'learner', 'Unlimited practice for a month.', '["Unlimited self-built practice sessions","All subjects for your grade","Progress and mastery tracking"]', 'month', null, false, true, 20),
  ('learner_term', 'plan', 'Learner Term', 'learner', 'The best value for a full school term.', '["Everything in Monthly","Best value for a full school term"]', 'term', null, true, true, 30),
  ('teacher_free', 'plan', 'Teacher', 'teacher', 'Free for teachers.', '["Classes, assignments and gradebook","Question bank","Create up to 3 live quizzes a month"]', 'free', 0, false, true, 10),
  ('school_year', 'plan', 'School', 'school', 'For a whole school.', '["All learners in the school","Teacher assignments and class reports","Challenges and competitions for your school","Contact us for a quote"]', 'year', null, false, true, 20),
  ('sponsor_starter', 'campaign', 'Quiz Starter', 'sponsor', 'Your first branded quiz.', '["One branded challenge or competition","Your logo and colours","Reading material for players","Results and participation report"]', 'campaign', null, false, true, 10),
  ('sponsor_standard', 'campaign', 'Quiz Standard', 'sponsor', 'More players, more reach.', '["Everything in Starter","Sponsored carousel placement","Aimed at your target audience","Prizes and winners list"]', 'campaign', null, true, true, 20),
  ('sponsor_premium', 'campaign', 'Quiz Premium', 'company', 'For a company or brand campaign.', '["Everything in Standard","Several rounds with elimination","Priority placement","Dedicated support"]', 'campaign', null, false, true, 30)
on conflict (code) do nothing;

revoke all on function public.qb_price_admin(), public.qb_price_list(), public.qb_price_list_admin(), public.qb_price_save(text, jsonb) from public, anon, authenticated;
grant execute on function public.qb_price_list() to authenticated, service_role;
grant execute on function public.qb_price_list_admin(), public.qb_price_save(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

