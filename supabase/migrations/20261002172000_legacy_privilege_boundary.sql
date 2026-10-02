-- Legacy result summaries must honor the competition's tenant context.
-- Depends on the closure privilege helpers.
CREATE OR REPLACE FUNCTION public.qb_competition_leaderboard(p_competition_id uuid)
 RETURNS TABLE(rank integer, entity_type text, entity_id uuid, score numeric, percentage numeric, completion_time_ms bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

    select
        cr.rank,
        cr.entity_type,
        cr.entity_id,
        cr.score,
        cr.percentage,
        cr.completion_time_ms

    from public.competition_results cr

    where cr.competition_id = p_competition_id
 and auth.uid() is not null and exists(select 1 from public.competitions c where c.id=p_competition_id and (
 public.qb_is_platform_admin() or public.qb_is_tenant_member(c.tenant_id) or
 (c.tenant_id=public.qb_public_tenant_id() and upper(c.status::text) in ('ACTIVE','PUBLISHED','OPEN','ONGOING','COMPLETED'))))

      and upper(cr.result_status) =
        'FINAL'

    order by
        cr.rank nulls last,
        cr.score desc;

$function$
;
CREATE OR REPLACE FUNCTION public.qb_competition_funding_summary(p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

    select jsonb_build_object(

        'competition_id',
            p_competition_id,

        'sponsor_count',
            count(distinct cs.sponsor_id),

        'committed_amount',
            coalesce(
                sum(cs.committed_amount),
                0
            ),

        'currency',
            coalesce(
                max(cs.currency),
                'GHS'
            )

    )

    from public.competition_sponsors cs

    where cs.competition_id = p_competition_id
 and auth.uid() is not null and exists(select 1 from public.competitions c where c.id=p_competition_id and (
 public.qb_is_platform_admin() or public.qb_is_tenant_member(c.tenant_id) or
 (c.tenant_id=public.qb_public_tenant_id() and upper(c.status::text) in ('ACTIVE','PUBLISHED','OPEN','ONGOING','COMPLETED'))))

      and upper(cs.status) =
        'ACTIVE';

$function$
;
create function public.qb_class_roster_page(p_class_id uuid,p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.qb_can_manage_class(p_class_id) then raise exception 'QB_PERMISSION_DENIED'; end if;
 if p_page is null or p_page<1 or p_page>10000 or p_limit is null or p_limit not between 1 and 100 then raise exception 'QB_INVALID_PAGE'; end if;
 return jsonb_build_object('total',(select count(*) from public.class_memberships where class_id=p_class_id and status='active'),
 'rows',coalesce((select jsonb_agg(x) from(select id,student_user_id,student_name,student_email,joined_at,status from public.class_memberships where class_id=p_class_id and status='active' order by joined_at,id limit p_limit offset (p_page-1)*p_limit)x),'[]'::jsonb));
end $$;
create function public.qb_my_attempts_page(p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_page is null or p_page<1 or p_page>10000 or p_limit is null or p_limit not between 1 and 100 then raise exception 'QB_INVALID_PAGE'; end if;
 return jsonb_build_object('total',(select count(*) from public.attempts where student_user_id=auth.uid()),
 'rows',coalesce((select jsonb_agg(x) from(select id,assessment_id,assignment_id,class_id,status,started_at,submitted_at from public.attempts where student_user_id=auth.uid() order by started_at desc,id desc limit p_limit offset (p_page-1)*p_limit)x),'[]'::jsonb));
end $$;
revoke all on function public.qb_class_roster_page(uuid,integer,integer),public.qb_my_attempts_page(integer,integer) from public,anon;
grant execute on function public.qb_class_roster_page(uuid,integer,integer),public.qb_my_attempts_page(integer,integer) to authenticated,service_role;
