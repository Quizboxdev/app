-- Unrelated legacy endpoints needed by migration introspection only.
create function qb_question_is_available(q questions) returns boolean language sql stable security definer set search_path='' as $$ select q.status='active' and q.validation_status='approved' $$;
      create function qb_content_queue(p_filters jsonb default '{}',p_page int default 1,p_limit int default 25) returns jsonb language plpgsql security definer set search_path='' as $$ begin return (select jsonb_build_object('total',count(*)) from (select q.* from public.questions q where (p_filters->>'curriculum')::uuid=q.curriculum_id) q); end $$;
      create function qb_content_coverage(p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$ begin return (with nodes as (select * from public.curriculum_nodes where is_active), production as (select * from public.questions where source_type='HUMAN_AUTHOR') select jsonb_build_object('nodes',(select count(*) from nodes),'questions',(select count(*) from production))); end $$;
      create function qb_content_batches() returns jsonb language plpgsql security definer set search_path='' as $$ begin return (select jsonb_build_object('total',(select count(*) from public.content_import_batches),'rows',(select jsonb_agg(to_jsonb(b)) from public.content_import_batches b))); end $$;
      create function qb_can_manage_class(p_class_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select true $$;
      create function qb_is_class_member(p_class_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select true $$;
      create function qb_competition_leaderboard(p_competition_id uuid) returns table(score int) language sql stable security definer set search_path='' as $$ select cr.score from public.competition_results cr where cr.competition_id = p_competition_id $$;
      create function qb_competition_funding_summary(p_competition_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select jsonb_build_object('amount',sum(cs.committed_amount)) from public.competition_sponsors cs where cs.competition_id = p_competition_id $$;
      create function qb_admin_content_health() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb;
      begin
      select jsonb_build_object('questions',count(*),'banks',(select count(*)
      from public.question_banks
      )) into result from public.questions;
      return result; end $$;
      create function qb_register_competition_school(p_competition_id uuid,p_institution_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_create_competition_team(p_competition_id uuid,p_institution_id uuid,p_team_name text) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_add_team_member(p_team_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_verify_team_member(p_team_member_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_attach_competition_sponsor(p_competition_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_record_competition_result(p_competition_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_finalize_competition_leaderboard(p_competition_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_content_detail(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return jsonb_build_object('id',p_id); end $$;
      create function qb_content_review(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin if (select role from public.profiles where id=auth.uid()) not in ('OWNER','ADMIN') then raise exception 'ORIGINAL_ROLE_DENIED'; end if; return '{}'; end $$;
      create function qb_content_request_generation(p_spec jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin return p_spec; end $$;
      create function qb_content_ingest(p_spec jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin return p_spec; end $$;
      create function qb_publish_assignment(p_class_id uuid,p_curriculum_node_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_start_attempt(p_assessment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
