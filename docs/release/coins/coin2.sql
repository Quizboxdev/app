create or replace function public.qb_price_save(p_code text, p_row jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k text; r public.price_list; v_code text := lower(btrim(p_code)); inc jsonb; lv text[];
begin
  if not public.qb_price_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if jsonb_typeof(p_row) <> 'object' then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_row) loop
    if k not in ('kind','name','audience','description','includes','period','price_minor','currency','checkout_url','highlight','active','starts_at','ends_at','sort_order','grants','coins','days','levels') then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  end loop;
  if p_row ? 'includes' then
    inc := p_row->'includes';
    if jsonb_typeof(inc) <> 'array' or exists (select 1 from jsonb_array_elements(inc) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 120) then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  end if;
  if p_row ? 'levels' then
    select coalesce(array_agg(distinct upper(x)), '{}') into lv from jsonb_array_elements_text(p_row->'levels') x;
  end if;
  select * into r from public.price_list where code = v_code;
  if not found then
    if not (p_row ? 'name' and p_row ? 'audience') then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
    insert into public.price_list(code, name, audience, updated_by) values (v_code, btrim(p_row->>'name'), p_row->>'audience', auth.uid()) returning * into r;
  end if;
  update public.price_list set
    kind = coalesce(p_row->>'kind', kind), name = coalesce(nullif(btrim(p_row->>'name'), ''), name), audience = coalesce(p_row->>'audience', audience),
    description = coalesce(left(p_row->>'description', 300), description), includes = coalesce(p_row->'includes', includes), period = coalesce(p_row->>'period', period),
    coins = case when p_row ? 'coins' then nullif(p_row->>'coins', '')::integer else coins end,
    days = case when p_row ? 'days' then nullif(p_row->>'days', '')::integer else days end,
    levels = case when p_row ? 'levels' then lv else levels end,
    price_minor = case when p_row ? 'coins' then (case when nullif(p_row->>'coins', '') is null then null else (p_row->>'coins')::integer * 100 end)
                       when p_row ? 'price_minor' then (p_row->>'price_minor')::integer else price_minor end,
    currency = coalesce(upper(p_row->>'currency'), currency),
    checkout_url = case when p_row ? 'checkout_url' then nullif(btrim(p_row->>'checkout_url'), '') else checkout_url end,
    highlight = coalesce((p_row->>'highlight')::boolean, highlight), active = coalesce((p_row->>'active')::boolean, active),
    starts_at = case when p_row ? 'starts_at' then (p_row->>'starts_at')::timestamptz else starts_at end, ends_at = case when p_row ? 'ends_at' then (p_row->>'ends_at')::timestamptz else ends_at end,
    sort_order = coalesce((p_row->>'sort_order')::integer, sort_order), grants = coalesce(p_row->'grants', grants), updated_at = now(), updated_by = auth.uid()
   where id = r.id returning * into r;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'price_saved', 'price_list', r.id, 'ok',
    jsonb_build_object('code', r.code, 'coins', r.coins, 'price_minor', r.price_minor, 'active', r.active, 'has_link', r.checkout_url is not null));
  return to_jsonb(r) - 'updated_by';
end $fn$;

revoke all on function public.qb_price_list(), public.qb_price_save(text, jsonb) from public, anon;
grant execute on function public.qb_price_list() to authenticated, service_role;
grant execute on function public.qb_price_save(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

