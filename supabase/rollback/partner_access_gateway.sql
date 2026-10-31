-- Rollback for 20261049100000_partner_access_gateway.sql: restores qb_has_subscription() to its earlier answer (subscriptions only) and removes every partner function,
-- so no licence grants access, no partner can authenticate, allocate or be approved. The tables (partners, contracts, seats, identity links, credentials, secrets, events) are KEPT on purpose:
-- they are contractual records. Accounts and learning history are never touched. To remove the records as well (only before any real contract exists), drop the partner_* tables by hand.
begin;
update public.platform_settings set value = 'false'::jsonb where key = 'flags.partner_access_gateway_v1' and scope_type = 'global';
create or replace function public.qb_has_subscription(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.learner_subscriptions s where s.user_id = p_user and s.status = 'active' and s.valid_from <= now() and s.valid_until > now())
$fn$;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (p.proname like 'qb\_partner\_%' or p.proname like 'qb\_admin\_partner%' or p.proname like 'qb\_pg\_%') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
