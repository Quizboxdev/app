import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Test-only database. Never connects to hosted Supabase.
export async function createDeliveryFixture() {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(read("./governance-schema.sql").replace(/create table (learning_events|mastery_records)\([^\n]+;\s*/g, ""));
    await db.exec(read("./assessment-engine.sql").replace(/\$function\$\s*\n(?=\s*(?:CREATE|$))/g, "$function$;\n"));
    await db.exec(read("./assessment-review.sql"));
    await db.exec("alter table assignments add column mode text;");
    await db.exec(read("./assessment-completion.sql"));
    await db.exec(read("./legacy-dependencies.sql"));
    // Real-schema columns/tables the market platform migration relies on (absent from the slim fixtures).
    await db.exec(`alter table auth.users add column if not exists raw_user_meta_data jsonb default '{}';
      alter table profiles add column if not exists email text, add column if not exists school_name text, add column if not exists created_at timestamptz default now();
      alter table classes add column if not exists grade qb_grade, add column if not exists teacher_user_id uuid;
      alter table class_memberships add column if not exists grade qb_grade;
      alter table assignments add column if not exists grade qb_grade, add column if not exists teacher_user_id uuid;
      alter table student_profiles add column if not exists institution_id uuid;
      alter table curricula add column if not exists name text, add column if not exists version text, add column if not exists status text, add column if not exists source_name text, add column if not exists source_hash text;
      alter table sponsor_profiles add column if not exists sponsor_type text, add column if not exists country text, add column if not exists verification_status text;
      create table if not exists teacher_profiles(id uuid primary key default gen_random_uuid(),user_id uuid not null,school_name text,region text,country text,status qb_status not null default 'active',institution_id uuid,created_at timestamptz default now());
      create table if not exists feature_flags(id uuid primary key default gen_random_uuid(),feature_code text unique,enabled boolean not null default false,rollout_config jsonb);
      create table if not exists notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid,recipient_profile_id uuid,recipient_email text,recipient_role text not null,type text not null,title text not null,message text not null,entity_type text,entity_id uuid,created_at timestamptz default now(),read_at timestamptz);
      create table if not exists content_reports(id uuid primary key default gen_random_uuid(),reporter_user_id uuid,target_type text not null,target_id uuid not null,report_type text not null,description text,status text default 'open',resolved_by uuid,resolved_at timestamptz,created_at timestamptz default now());
      create table if not exists system_events(id uuid primary key default gen_random_uuid(),event_type text not null,entity_type text,entity_id uuid,severity text,details jsonb,created_at timestamptz default now());
      do $e$ begin if to_regtype('institution_role') is null then create type institution_role as enum('student','teacher','admin','owner'); end if; end $e$;
      create table if not exists institutions(id uuid primary key default gen_random_uuid(),name text not null,code text,status qb_status default 'active',tenant_id uuid);
      create table if not exists institution_memberships(id uuid primary key default gen_random_uuid(),institution_id uuid not null,user_id uuid not null,role institution_role not null,status qb_status default 'active',joined_at timestamptz default now());
      alter table assignments add column if not exists created_at timestamptz default now(), add column if not exists title text;
      alter table classes add column if not exists institution_id uuid, add column if not exists class_name text, add column if not exists status qb_status default 'active', add column if not exists primary_teacher_id uuid;
      alter table class_memberships add column if not exists student_id uuid, add column if not exists student_email text, add column if not exists student_name text, add column if not exists joined_at timestamptz default now(), add column if not exists left_at timestamptz, add column if not exists approved_at timestamptz, add column if not exists approved_by uuid;
      create table if not exists audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,action text not null,entity_type text,entity_id uuid,status text,details jsonb,created_at timestamptz default now());`);
    await db.exec("alter table profiles add column if not exists full_name text; alter table curriculum_nodes add column node_type text, add column code text, add column title text; create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;");
    const editorial = read("../../../supabase/migrations/20261002150000_question_factory_governance.sql");
    for (const name of ["qb_factory_normalize", "qb_content_validation_errors", "qb_question_is_available", "qb_question_editorial_guard", "qb_question_version_capture"]) {
      const start = editorial.indexOf(`create or replace function public.${name}(`);
      const end = editorial.indexOf("$$;", start);
      await db.exec(editorial.slice(start, end + 3));
    }
    await db.exec("create trigger qb_question_editorial_guard before insert or update on questions for each row execute function qb_question_editorial_guard(); create trigger qb_question_version_capture after insert or update on questions for each row execute function qb_question_version_capture();");
    for (const name of ["20261002200000_market_sme_foundation.sql", "20261002210000_content_market_enforcement.sql", "20261002220000_sponsor_competition_lifecycle.sql", "20261002230000_sponsor_authenticated_workflows.sql", "20261002240000_sponsor_candidate_review_bridge.sql", "20261002250000_sponsor_source_delivery.sql", "20261002260000_legacy_node_attribution.sql", "20261002270000_competition_review_operations.sql", "20261003100000_multi_market_platform.sql", "20261003120000_market_grade_codes.sql", "20261003130000_market_content_grades.sql", "20261003140000_market_setup_curricula.sql", "20261003150000_editorial_market_grades.sql", "20261003160000_sme_queue_predicate_grant.sql", "20261003170000_continuous_attribution.sql", "20261003180000_sme_review_guard_alias.sql", "20261003190000_class_policy_row_check.sql", "20261003200000_self_serve_tenant_access.sql", "20261004100000_activity_search_home.sql", "20261004110000_quality_analytics_home.sql", "20261004120000_competition_school_admin_ops.sql"]) {
      try { await db.exec(read(`../../../supabase/migrations/${name}`)); }
      catch (error) { throw new Error(`${name}: ${(error as Error).message}`, { cause: error }); }
    }
    const market = (await db.query<{ id: string }>("select id from markets limit 1")).rows[0].id;
    await db.query("insert into profiles(id,role,status,country,default_market_id) values($1,'SPONSOR','active','Ghana',$6),($2,'OWNER','active','Ghana',$6),($3,'TEACHER','active','Ghana',$6),($4,'STUDENT','active','Ghana',$6),($5,'SPONSOR','active','Ghana',$6)", [id(1), id(2), id(3), id(4), id(5), market]);
    await db.query("insert into profiles(id,role,status,country,default_market_id) values($1,'STUDENT','active','Ghana',$2)", [id(6), market]);
    await db.query("insert into student_profiles(user_id,grade) values($1,'B10')", [id(4)]);
    await db.query("insert into student_profiles(user_id,grade) values($1,'B10')", [id(6)]);
    await db.query("insert into auth.users(id,email,email_confirmed_at) select id,'fixture-'||id||'@example.invalid',now() from profiles");
    await db.query("insert into user_market_memberships(user_id,market_id,active) select id,$1,true from profiles", [market]);
    await db.query("insert into tenants(id,code,country) values($1,'QUIZBOX_PUBLIC','Ghana')", [id(90)]);

    return { db, market };
}
