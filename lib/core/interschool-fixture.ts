import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Shared test database for the inter-school migrations (isolated PostgreSQL). The inter-school migrations are applied unchanged. Accounts, schools, classes, the curriculum, the question bank,
// notifications and the payment ledger are stand-ins with the columns the migrations use; the quizbox_core audit and flag helpers have the real definitions. qb_challenge_admin, the question
// listing and availability rules are simplified stand-ins (they have their own tests), so integration with the real ones is NOT proven here.
export const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const MIGRATIONS = ["20261126100000_interschool_core", "20261126110000_interschool_registration", "20261126120000_interschool_play", "20261126130000_interschool_billing", "20261126140000_interschool_awards"];
export const migration = (name: string) => read(`supabase/migrations/${name}.sql`);

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ADMIN = id(1), SPONSOR_OK = id(2), SPONSOR_NEW = id(3), PLAIN_TEACHER = id(4), MANAGED = id(5);
export const SCHOOLS = [1, 2, 3, 4, 5, 6].map((n) => id(100 + n));
export const UNVERIFIED_SCHOOL = id(199);
export const staff = (school: number) => id(200 + school);                       // school 1..6
export const learner = (school: number, level: 7 | 8 | 9, n: number) => id(school * 10000 + level * 100 + n);
export const LEVELS = [7, 8, 9] as const;
export const SUBJECT = { math7: id(307), math8: id(308), math9: id(309), eng7: id(317), eng8: id(318), eng9: id(319) };
export const strandOf = (subject: string) => subject.replace(/^(.{8})-0000/, "$1-0001");
export const QUESTIONS_PER_CELL = 40;   // per subject and difficulty

export type Db = PGlite;

export function baseSql() {
  const learners: string[] = [], profiles: string[] = [], memberships: string[] = [];
  SCHOOLS.forEach((school, i) => {
    const s = i + 1;
    profiles.push(`('${staff(s)}','teacher','active','Staff ${s} Mensah','staff${s}@example.com')`);
    memberships.push(`('${school}','${staff(s)}','teacher','active')`);
    for (const level of LEVELS) for (let n = 1; n <= 8; n++) {
      profiles.push(`('${learner(s, level, n)}','student','active','Learner${s}${level}${n} Owusu','l${s}${level}${n}@example.com')`);
      learners.push(`('${learner(s, level, n)}','B${level}','${school}',null)`);
      // learners 1-6 are verified members of their school; 7 and 8 only chose it at sign-up
      if (n <= 6) memberships.push(`('${school}','${learner(s, level, n)}','student','active')`);
    }
  });
  const nodes: string[] = [], questions: string[] = [];
  Object.entries(SUBJECT).forEach(([key, subject]) => {
    const level = `B${key.slice(-1)}`, strand = strandOf(subject);
    nodes.push(`('${subject}',null,'subject','${key.startsWith("math") ? "Mathematics" : "English"}','${key}','${level}')`, `('${strand}','${subject}','strand','Strand one','${key}.1','${level}')`);
    questions.push(`select gen_random_uuid(), '${strand}'::uuid, '${level}', d, '${key} ' || d || ' question ' || g || '?', 'right ' || g, 'wrong a ' || g, 'wrong b ' || g, 'wrong c ' || g, 'A' from unnest(array['easy','medium','hard']) d, generate_series(1, ${QUESTIONS_PER_CELL}) g`);
  });
  return `
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(user_id uuid primary key references public.profiles(id), grade text, grade_code text, institution_id uuid, managed_by uuid);
    create table public.sponsor_profiles(user_id uuid primary key, verification_status text, organization_name text);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb, created_at timestamptz default now());
    create table public.platform_settings(key text not null, value jsonb not null, description text, scope_type text not null default 'global', scope_id uuid);
    create schema quizbox_core;
    create function quizbox_core.audit(p_action text,p_entity_type text,p_entity uuid,p_details jsonb default '{}') returns void language sql security definer set search_path='' as $$
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),p_action,p_entity_type,p_entity,'pass',coalesce(p_details,'{}')) $$;
    create function quizbox_core.setting(p_key text,p_scope_type text default 'global',p_scope uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
      select coalesce((select value from public.platform_settings where key=p_key and scope_type=p_scope_type and scope_id is not distinct from p_scope), (select value from public.platform_settings where key=p_key and scope_type='global')) $$;
    create function quizbox_core.flag(p_key text,p_scope_type text default 'global',p_scope uuid default null) returns boolean language sql stable security definer set search_path='' as $$ select coalesce(quizbox_core.setting(p_key,p_scope_type,p_scope)='true'::jsonb,false) $$;
    create function public.qb_challenge_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','owner') and p.status='active') $$;
    create table public.institutions(id uuid primary key, name text not null, region text, district text, status text default 'active', verified_at timestamptz);
    create table public.institution_memberships(institution_id uuid, user_id uuid, role text, status text);
    create table public.classes(id uuid primary key, class_name text, status text default 'active', teacher_user_id uuid, institution_id uuid);
    create table public.class_memberships(class_id uuid, student_user_id uuid, status text default 'active');
    create table public.curriculum_nodes(id uuid primary key, parent_id uuid, node_type text, title text, code text, grade_code text, canonical_grade_code text, is_active boolean not null default true);
    create table public.questions(id uuid primary key default gen_random_uuid(), curriculum_node_id uuid, source_grade_code text, grade text, difficulty_label text, difficulty_code text, question_text text, option_a text, option_b text, option_c text, option_d text,
      correct_answer text, explanation text, status text default 'active', validation_status text default 'approved', tenant_id uuid, answer_type text default 'SINGLE_CHOICE', source_type text, version integer default 1);
    create function public.qb_public_tenant_id() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000ff'::uuid $$;
    create function public.qb_question_is_listable(q public.questions) returns boolean language sql stable as $$ select q.status='active' $$;
    create function public.qb_question_is_available(q public.questions) returns boolean language sql stable as $$ select coalesce(q.source_type,'') <> 'UNAVAILABLE' $$;
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text, type text, title text, message text, link text, category text, created_at timestamptz default now(),
      check (link is null or link ~ '^/[A-Za-z0-9/_\\-?=&.]*$'));
    create table public.payment_events(id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null, reference text, reported_status text, signature_verified boolean, payload jsonb, outcome text, created_at timestamptz default now(), unique(provider, provider_event_id));
    insert into public.profiles values ('${ADMIN}','admin','active','Site Admin','admin@example.com'),('${SPONSOR_OK}','sponsor','active','Bank Sponsor','bank@example.com'),('${SPONSOR_NEW}','sponsor','active','New Sponsor','new@example.com'),
      ('${PLAIN_TEACHER}','teacher','active','Unverified Teacher','plain@example.com'),('${MANAGED}','student','active','Little Child','child@example.com'),${profiles.join(",")};
    insert into public.sponsor_profiles values ('${SPONSOR_OK}','VERIFIED','Gold Bank'),('${SPONSOR_NEW}','PENDING','New Co');
    insert into public.institutions(id,name,region,district,verified_at) values ${SCHOOLS.map((s, i) => `('${s}','School ${i + 1} Academy','Greater Accra','District ${i + 1}', now())`).join(",")}, ('${UNVERIFIED_SCHOOL}','Unverified School','Volta','Ho', null);
    insert into public.student_profiles(user_id,grade_code,institution_id,managed_by) values ${learners.join(",")}, ('${MANAGED}','B7','${SCHOOLS[0]}','${staff(1)}');
    insert into public.institution_memberships values ${memberships.join(",")}, ('${UNVERIFIED_SCHOOL}','${PLAIN_TEACHER}','teacher','active'), ('${SCHOOLS[0]}','${MANAGED}','student','active');
    insert into public.curriculum_nodes(id,parent_id,node_type,title,code,grade_code) values ${nodes.join(",")};
    insert into public.questions(id,curriculum_node_id,source_grade_code,difficulty_label,question_text,option_a,option_b,option_c,option_d,correct_answer) ${questions.join(" union all ")};
  `;
}

export async function makeDb(upTo = MIGRATIONS.length) {
  const db = new PGlite();
  await db.exec(baseSql());
  for (const m of MIGRATIONS.slice(0, upTo)) await db.exec(migration(m));
  return db;
}

export function helpers(db: Db) {
  const as = async (user: string | null | "service") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
    await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
  };
  const rpc = async <T = any>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0] ?? {})[0] as T;
  const q = async <T = any>(sql: string, params: unknown[] = []) => { await db.exec("reset role"); return (await db.query<T>(sql, params)).rows; };
  const setting = async (key: string, value: unknown) => { await q("update public.platform_settings set value=$2::jsonb where key=$1", [key, JSON.stringify(value)]); };
  const on = async () => { await setting("flags.interschool", true); await setting("flags.interschool_public", true); await setting("flags.interschool_sponsorship", true); };
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const settings = (extra: Record<string, unknown> = {}) => ({ title: "Accra Maths Cup", registration_opens_at: days(-1), registration_closes_at: days(5), opens_at: days(0), ends_at: days(40), capacity: 100, expected_participants: 100, ...extra });
  const round = (n: number, subject: string, extra: Record<string, unknown> = {}) => ({ title: `Round ${n}`, opens_at: days(6 + n), closes_at: days(6.5 + n), duration_seconds: 600, sections: [{ subject_id: subject, count: 5 }], ...extra });
  // Creates a competition with one division per level, each with the given rounds, and publishes it (as the given organiser).
  const competition = async (organiser: string, opts: { settings?: Record<string, unknown>; levels?: number[]; rounds?: (subject: string, level: number) => unknown[]; host?: string | null; publish?: boolean; invite?: string[] } = {}) => {
    await as(organiser);
    const levels = opts.levels ?? [7];
    const c = await rpc<{ id: string; slug: string }>("select public.interschool_create($1,$2)", [JSON.stringify(settings(opts.settings)), opts.host ?? null]);
    const d = await rpc<{ divisions: Array<{ id: string }> }>("select public.interschool_set_divisions($1,$2)", [c.id, JSON.stringify(levels.map((l) => ({ level_codes: [`B${l}`], title: `Basic ${l}` })))]);
    for (let i = 0; i < levels.length; i++) {
      const subject = (SUBJECT as Record<string, string>)[`math${levels[i]}`];
      await rpc("select public.interschool_set_rounds($1,$2)", [d.divisions[i].id, JSON.stringify(opts.rounds ? opts.rounds(subject, levels[i]) : [round(1, subject)])]);
    }
    if (opts.publish !== false) {
      const check = await rpc<{ needs_approval: boolean; approved: boolean }>("select public.interschool_check($1)", [c.id]);
      if (check.needs_approval && !check.approved) { await rpc("select public.interschool_request_approval($1)", [c.id]); await as(ADMIN); await rpc("select public.interschool_decide($1,true,null)", [c.id]); await as(organiser); }
      await rpc("select public.interschool_publish($1)", [c.id]);
      if (opts.invite) await rpc("select public.interschool_invite($1,$2)", [c.id, opts.invite]);
    }
    return { ...c, divisions: d.divisions.map((x) => x.id) };
  };
  const nominate = async (competitionId: string, school: number, division: string, users: string[]) => { await as(staff(school)); return rpc<{ results: Array<{ ok: boolean; status?: string; error?: string; candidate_id?: string }> }>("select public.interschool_nominate($1,$2,$3,$4)", [competitionId, SCHOOLS[school - 1], division, users]); };
  const openRound = async (roundId: string, fromHours = -1, toHours = 1) => {
    await q("update quizbox_interschool.rounds set opens_at = now() + make_interval(hours => $2), closes_at = now() + make_interval(hours => $3) where id=$1", [roundId, fromHours, toHours]);
    await q("update quizbox_interschool.fixtures set scheduled_at = now() + make_interval(hours => $2), closes_at = now() + make_interval(hours => $3) where round_id=$1 and status='SCHEDULED'", [roundId, fromHours, toHours]);
  };
  const closeRound = async (roundId: string) => { await openRound(roundId, -2, -1); await q("update quizbox_interschool.sittings set started_at = now() - interval '110 minutes', expires_at = now() - interval '100 minutes' where round_id=$1", [roundId]); };
  const rounds = async (division: string) => (await q<{ id: string }>("select id from quizbox_interschool.rounds where division_id=$1 order by round_no", [division])).map((r) => r.id);
  // Takes a round as a learner, answering the first `right` questions correctly (by option text, as a real learner would see them) and the rest wrongly.
  const play = async (user: string, roundId: string, right: number, submit = true) => {
    await as(user);
    const view = await rpc<{ sitting_id: string; questions: Array<{ id: string; options: string[] }> }>("select public.interschool_start($1)", [roundId]);
    const answers = view.questions.map((question, i) => ({ question_id: question.id, choice: i < right ? question.options.findIndex((o) => o.startsWith("right")) : question.options.findIndex((o) => o.startsWith("wrong")) }));
    if (!submit) return { view, answers };
    await rpc("select public.interschool_submit($1,$2)", [view.sitting_id, JSON.stringify(answers)]);
    return { view, answers };
  };
  return { as, rpc, q, setting, on, days, settings, round, competition, nominate, openRound, closeRound, rounds, play };
}
