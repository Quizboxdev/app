-- Market setup works on markets that are not ACTIVE yet (RLS-backed screens only show active markets).
begin;
create function public.qb_market_setup(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare mc public.market_curricula; target uuid:=nullif(p_data->>'market_id','')::uuid;
begin
 if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
 if p_action='authorities' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'market_id',a.market_id,'code',a.code,'name',a.name,'active',a.active) order by a.name) from public.curriculum_authorities a where target is null or a.market_id=target),'[]');
 elsif p_action='curricula' then
  return coalesce((select jsonb_agg(jsonb_build_object('curriculum_id',c.id,'code',c.code,'name',c.name,'version',c.version,'market_id',mc2.market_id,'authority',a.name,'active',mc2.active,
    'effective_from',c.effective_from,'effective_to',c.effective_to,'source_name',c.source_name,'nodes',(select count(*) from public.curriculum_nodes n where n.curriculum_id=c.id),
    'approved_sources',(select count(*) from public.source_documents d where d.curriculum_id=c.id and d.validation_status='approved')) order by c.code)
   from public.curricula c join public.market_curricula mc2 on mc2.curriculum_id=c.id left join public.curriculum_authorities a on a.id=mc2.authority_id where target is null or mc2.market_id=target),'[]');
 elsif p_action in ('activate_curriculum','deactivate_curriculum') then
  select * into mc from public.market_curricula where curriculum_id=(p_data->>'curriculum_id')::uuid for update;
  if mc.curriculum_id is null then raise exception 'CURRICULUM_NOT_FOUND'; end if;
  -- Activation requires a governing authority and at least one approved official source.
  if p_action='activate_curriculum' and (mc.authority_id is null or not exists(select 1 from public.source_documents d where d.curriculum_id=mc.curriculum_id and d.validation_status='approved' and d.rights_confirmed)) then
   raise exception 'CURRICULUM_ACTIVATION_REQUIRES_AUTHORITY_AND_APPROVED_SOURCE';
  end if;
  update public.market_curricula set active=(p_action='activate_curriculum') where curriculum_id=mc.curriculum_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_'||upper(p_action),'market_curricula',mc.curriculum_id,'pass','{}');
  return jsonb_build_object('curriculum_id',mc.curriculum_id,'active',p_action='activate_curriculum');
 elsif p_action='sources' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'curriculum_id',d.curriculum_id,'validation_status',d.validation_status,'rights_confirmed',d.rights_confirmed,'has_text',nullif(btrim(d.content_text),'') is not null) order by d.title)
   from public.source_documents d where d.market_id=target and d.source_kind='CURRICULUM'),'[]');
 elsif p_action='approve_source' then
  -- The existing source guard still requires rights, checksum and extracted text.
  update public.source_documents set validation_status='approved',approved_by=auth.uid() where id=(p_data->>'source_id')::uuid and market_id=target and source_kind='CURRICULUM';
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_SOURCE_APPROVED','source_documents',(p_data->>'source_id')::uuid,'pass','{}');
  return jsonb_build_object('source_id',p_data->>'source_id','validation_status','approved');
 elsif p_action='add_market_admin' then
  select id into target from public.markets where id=target;
  if not exists(select 1 from public.profiles where lower(email)=lower(p_data->>'email') and lower(role::text) in ('admin','owner') and lower(status::text)='active') then raise exception 'ACTIVE_ADMIN_REQUIRED'; end if;
  insert into public.user_market_memberships(user_id,market_id,active) select id,target,true from public.profiles where lower(email)=lower(p_data->>'email') on conflict(user_id,market_id) do update set active=true;
  return jsonb_build_object('market_id',target,'email',p_data->>'email');
 end if;
 raise exception 'INVALID_MARKET_SETUP_ACTION';
end $$;
revoke all on function public.qb_market_setup(text,jsonb) from public,anon;
grant execute on function public.qb_market_setup(text,jsonb) to authenticated;
commit;
