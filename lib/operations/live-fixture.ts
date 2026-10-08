// Self-contained live-acceptance fixtures for the Preview branch.
//
// Every run builds its own isolated world (market, authority, curriculum, indicator node, market mapping, users, class,
// attributed questions) under a unique run id, and tears it down in dependency order. Nothing depends on a permanent
// DEV_ACCEPTANCE_FIXTURE pool. All identifiers derive from the run id, so teardown and the stale-run sweeper never need
// wildcard deletes beyond the strict patterns below.
//
// Safety: Preview only. Connection settings come from the two Preview-only files (.env.branch.local and
// .env.preview-db.local), never from .env.local. The project ref is pinned, production is refused before any mutation,
// and credentials are never logged.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { assertNotProduction, PRODUCTION_PROJECT_REF } from "./safety";

export const PREVIEW_PROJECT_REF = "fngdtxayfoiffbcbmcum";
export const RUN_PREFIX = "QBRUN";
export const FIXTURE_EMAIL_DOMAIN = "e2e.quizbox.invalid";
const RUN_ID = /^[a-z0-9]{12}$/;

export type FixtureRole = "teacher" | "student" | "student2" | "admin" | "seller" | "sponsor";
const ROLE_ENUM: Record<FixtureRole, string> = { teacher: "teacher", student: "student", student2: "student", admin: "admin", seller: "student", sponsor: "sponsor" };

export interface FixtureUser { id: string; email: string; password: string; role: FixtureRole; teacherProfileId?: string }
export interface FixtureQuestion { id: string; externalId: string; correct: string; text: string }
export interface FixtureWorld {
  runId: string;
  url: string;
  market: { id: string; name: string };
  curriculum: { id: string; code: string };
  node: { id: string; code: string; title: string; curriculum_id: string; education_level: string; grade_code: string; canonical_grade_code: string; source_grade_code: string; subject_code: string };
  documentId: string;
  /** Second, run-scoped tenant (only when requested) for cross-tenant denial tests. */
  otherTenantId?: string;
  classroom: { id: string; joinCode: string; name: string };
  questions: FixtureQuestion[];
  users: Partial<Record<FixtureRole, FixtureUser>>;
  /** Signed-in anon-key client for a fixture user (RLS and RPC rules apply exactly as in the app). */
  client(role: FixtureRole): Promise<SupabaseClient>;
  /** Service-role client for verification reads only. */
  service: SupabaseClient;
}
export interface CreateOptions { roles?: FixtureRole[]; questionCount?: number; joinStudents?: boolean; otherTenant?: boolean; reviewerDomain?: boolean }

// ---- Target resolution and guards -------------------------------------------------------------------------------
interface Target { url: string; anonKey: string; serviceKey: string }
let cachedTarget: Target | undefined;
const jwtClaim = (jwt: string) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()); } catch { return {}; } };
const refOf = (url?: string) => { try { return new URL(url ?? "").hostname.split(".")[0]; } catch { return ""; } };

export function resolveTarget(): Target {
  if (cachedTarget) return cachedTarget;
  if (!existsSync(".env.branch.local")) throw new Error("FIXTURE_PREVIEW_ENV_MISSING");
  const branch = parseEnv(readFileSync(".env.branch.local", "utf8"));
  const url = branch.NEXT_PUBLIC_SUPABASE_URL, anonKey = branch.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceKey = branch.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("FIXTURE_PREVIEW_ENV_INCOMPLETE");
  const ref = refOf(url);
  if (ref === PRODUCTION_PROJECT_REF) throw new Error("FIXTURE_PRODUCTION_TARGET_REFUSED");
  if (ref !== PREVIEW_PROJECT_REF) throw new Error("FIXTURE_TARGET_NOT_PREVIEW");
  const service = jwtClaim(serviceKey);
  if (service.ref !== PREVIEW_PROJECT_REF || service.role !== "service_role") throw new Error("FIXTURE_SERVICE_KEY_NOT_PREVIEW");
  // An acceptance runner may already have set its own Supabase URL; it must be the same project.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && refOf(process.env.NEXT_PUBLIC_SUPABASE_URL) !== ref) throw new Error("FIXTURE_TARGET_MISMATCH");
  assertNotProduction({ ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, QB_ACCEPTANCE_PROJECT_REF: ref });
  return (cachedTarget = { url, anonKey, serviceKey });
}

// ---- SQL access (psql against the Preview database; needed for tables service_role cannot write) -----------------
let psqlPath: string | undefined;
function findPsql() {
  if (psqlPath) return psqlPath;
  for (const candidate of [process.env.QB_PSQL, "psql", "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe", "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe"]) {
    if (candidate && spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0) return (psqlPath = candidate);
  }
  throw new Error("FIXTURE_PSQL_UNAVAILABLE");
}
function dbEnvironment() {
  resolveTarget();
  if (!existsSync(".env.preview-db.local")) throw new Error("FIXTURE_PREVIEW_DB_ENV_MISSING");
  const db = parseEnv(readFileSync(".env.preview-db.local", "utf8"));
  const joined = `${db.user}${db.host}${db.database}`;
  if (joined.includes(PRODUCTION_PROJECT_REF)) throw new Error("FIXTURE_PRODUCTION_TARGET_REFUSED");
  if (!String(db.user).includes(PREVIEW_PROJECT_REF)) throw new Error("FIXTURE_DB_NOT_PREVIEW");
  return { PGHOST: db.host, PGPORT: db.port, PGDATABASE: db.database, PGUSER: db.user, PGPASSWORD: db.password, PGSSLMODE: "require" };
}
/** Runs one script in a single transaction and returns stdout. Error text from psql never contains credentials. */
export function previewSql(script: string, options: { idempotent?: boolean } = {}): string {
  const attempts = options.idempotent ? 4 : 1;
  let lastDetail = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = spawnSync(findPsql(), ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-1", "-f", "-"], {
      input: script, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...dbEnvironment() },
    });
    if (result.status === 0) return result.stdout;
    const lines = String(result.stderr ?? "").split(/\r?\n/).filter(Boolean);
    lastDetail = (lines.find((line) => /ERROR/.test(line)) ?? lines.slice(-2).join(" | ") ?? "") || result.error?.message || `exit ${result.status}`;
    // Only transport failures are retried, and only for idempotent scripts (reads and run-scoped teardown). SQL errors never are.
    const transient = !/ERROR/.test(lastDetail) && /connection to server was lost|server closed the connection|could not connect|timeout expired|SSL SYSCALL|terminating connection|connection.*(reset|refused)/i.test(String(result.stderr ?? "") + lastDetail);
    if (!transient || attempt === attempts) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * attempt);
  }
  throw new Error("FIXTURE_SQL_FAILED: " + lastDetail.slice(0, 300));
}
const sqlJson = <T>(query: string): T => JSON.parse(previewSql(`select coalesce(json_agg(t), '[]'::json) from (${query}) t;`, { idempotent: true }).trim());

// ---- Auth admin ---------------------------------------------------------------------------------------------------
async function adminCreateUser(email: string, password: string, metadata: Record<string, unknown>) {
  const { url, serviceKey } = resolveTarget();
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata }),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) throw new Error(`FIXTURE_AUTH_USER_FAILED_${response.status}`);
  return body.id as string;
}

// ---- Run identity -------------------------------------------------------------------------------------------------
export const newRunId = () => Date.now().toString(36).padStart(8, "0").slice(-8) + randomBytes(3).toString("hex").slice(0, 4).replace(/[^a-z0-9]/g, "0");
export function assertRunId(runId: string) { if (!RUN_ID.test(runId)) throw new Error("FIXTURE_INVALID_RUN_ID"); return runId; }
const runTimestamp = (runId: string) => parseInt(runId.slice(0, 8), 36);
const userEmail = (runId: string, role: FixtureRole) => `${RUN_PREFIX.toLowerCase()}-${runId}-${role}@${FIXTURE_EMAIL_DOMAIN}`;
const marketName = (runId: string) => `${RUN_PREFIX}-${runId}`;
const lit = (value: string) => { if (/[^\w\s.\-@:,()?/%]/.test(value)) throw new Error("FIXTURE_UNSAFE_LITERAL"); return `'${value}'`; };

// ---- Create -------------------------------------------------------------------------------------------------------
const QUESTION_BANK = [
  { text: "Which number is the sum of 2 and 3?", options: ["4", "5", "6", "7"], correct: "B" },
  { text: "Which number is the product of 3 and 4?", options: ["7", "10", "12", "14"], correct: "C" },
  { text: "Which number is half of 10?", options: ["5", "4", "6", "20"], correct: "A" },
  { text: "Which number is 9 minus 4?", options: ["3", "6", "4", "5"], correct: "D" },
];

export async function createFixtureWorld(options: CreateOptions = {}): Promise<FixtureWorld> {
  const target = resolveTarget();
  const runId = assertRunId(newRunId());
  const roles = options.roles ?? ["teacher", "student", "student2"];
  if (!roles.includes("teacher")) throw new Error("FIXTURE_TEACHER_REQUIRED");
  const questionCount = Math.min(Math.max(options.questionCount ?? 4, 1), QUESTION_BANK.length);
  const ids = { market: randomUUID(), authority: randomUUID(), curriculum: randomUUID(), node: randomUUID(), classroom: randomUUID(), teacherProfile: randomUUID(), document: randomUUID(), tenantB: randomUUID() };
  const questions: FixtureQuestion[] = QUESTION_BANK.slice(0, questionCount).map((q, index) => ({ id: randomUUID(), externalId: `${RUN_PREFIX}-${runId}-Q${index + 1}`, correct: q.correct, text: q.text }));
  const users: FixtureWorld["users"] = {};
  const created: string[] = [];
  try {
    // 1. Auth users. The signup trigger provisions a student profile (grade required); roles are adjusted below.
    for (const role of roles) {
      const password = randomBytes(18).toString("base64url");
      const email = userEmail(runId, role);
      const id = await adminCreateUser(email, password, { full_name: `${RUN_PREFIX} ${role} ${runId}`, grade: "B7", qbrun: runId });
      created.push(id);
      users[role] = { id, email, password, role };
    }
    const teacher = users.teacher!;
    teacher.teacherProfileId = ids.teacherProfile;
    // 2. Market world, memberships, class and attributed questions in one transaction.
    const roleRows = roles.map((role) => `(${lit(users[role]!.id)}::uuid,${lit(ROLE_ENUM[role])}::public.qb_role)`).join(",");
    const questionRows = questions.map((q, index) => {
      const spec = QUESTION_BANK[index];
      return `(${lit(q.id)}::uuid,${lit(q.externalId)},${lit(spec.text)},${lit(spec.options[0])},${lit(spec.options[1])},${lit(spec.options[2])},${lit(spec.options[3])},${lit(spec.correct)})`;
    }).join(",");
    previewSql(`
      insert into public.markets(id,country_id,name,default_currency_code,timezone,locale,status,is_test)
        select ${lit(ids.market)}::uuid,c.id,${lit(marketName(runId))},c.default_currency_code,c.timezone,c.locale,'ACTIVE',true
        from public.countries c order by (c.iso2_code='XT') desc, c.iso2_code limit 1;
      insert into public.curriculum_authorities(id,market_id,code,name) values(${lit(ids.authority)}::uuid,${lit(ids.market)}::uuid,${lit(`QR${runId}`)},${lit(`${RUN_PREFIX} authority ${runId}`)});
      insert into public.curricula(id,code,name,country,version,market_id,status) values(${lit(ids.curriculum)}::uuid,${lit(marketName(runId))},${lit(`${RUN_PREFIX} curriculum ${runId}`)},'Testland','1',${lit(ids.market)}::uuid,'ACTIVE');
      insert into public.curriculum_nodes(id,curriculum_id,node_type,code,identity_key,title,source_terminology,education_level,grade_code,source_grade_code,canonical_grade_code,subject_code,is_active)
        values(${lit(ids.node)}::uuid,${lit(ids.curriculum)}::uuid,'learning_indicator',${lit(`${RUN_PREFIX}-${runId}-LI1`)},${lit(`${RUN_PREFIX}-${runId}-LI1`)},'Add and subtract within 20','learning indicator','JHS','B7','B7','B7','Mathematics',true);
      insert into public.market_curricula(curriculum_id,market_id,authority_id,active) values(${lit(ids.curriculum)}::uuid,${lit(ids.market)}::uuid,${lit(ids.authority)}::uuid,true);
      update public.profiles p set role=r.role, default_market_id=${lit(ids.market)}::uuid, primary_market_id=${lit(ids.market)}::uuid, onboarding_completed_at=now()
        from (values ${roleRows}) as r(id,role) where p.id=r.id;
      insert into public.user_market_memberships(user_id,market_id,active) select r.id,${lit(ids.market)}::uuid,true from (values ${roleRows}) as r(id,role);
      insert into public.teacher_profiles(id,user_id,school_name) values(${lit(ids.teacherProfile)}::uuid,${lit(teacher.id)}::uuid,${lit(`${RUN_PREFIX} school ${runId}`)});
${users.seller ? `      insert into public.marketplace_sellers(seller_type,seller_entity_id,display_name) values('USER',${lit(users.seller.id)}::uuid,${lit(`${RUN_PREFIX} seller ${runId}`)});
` : ""}${users.sponsor ? `      insert into public.sponsor_profiles(user_id,organization_name,contact_name) values(${lit(users.sponsor.id)}::uuid,${lit(`${RUN_PREFIX} sponsor ${runId}`)},${lit(`${RUN_PREFIX} contact ${runId}`)});
` : ""}${options.otherTenant ? `      insert into public.tenants(id,code,name,market_id) values(${lit(ids.tenantB)}::uuid,${lit(`${marketName(runId)}-B`)},${lit(`${RUN_PREFIX} tenant B ${runId}`)},${lit(ids.market)}::uuid);
` : ""}${options.reviewerDomain && users.admin ? `      insert into public.sme_profiles(user_id,reviewer_status,reviewer_tier,payment_status,active) values(${lit(users.admin.id)}::uuid,'verified','standard','verified',true);
      insert into public.sme_domain_assignments(reviewer_id,subject_code,curriculum_id,market_id,can_review,can_approve,can_senior_review,active) values(${lit(users.admin.id)}::uuid,'Mathematics',${lit(ids.curriculum)}::uuid,${lit(ids.market)}::uuid,true,true,false,true);
` : ""}      insert into public.source_documents(id,title,source_kind,validation_status,rights_confirmed,checksum,content_text,approved_by,uploaded_by,market_id,curriculum_id,authority_id,document_type)
        values(${lit(ids.document)}::uuid,${lit(`${RUN_PREFIX} source ${runId}`)},'CURRICULUM','approved',true,${lit(`qbrun${runId}`)},'Run-scoped curriculum source for live acceptance',${lit(teacher.id)}::uuid,${lit(teacher.id)}::uuid,${lit(ids.market)}::uuid,${lit(ids.curriculum)}::uuid,${lit(ids.authority)}::uuid,'CURRICULUM');
      insert into public.classes(id,join_code,class_name,school_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status,academic_year,term)
        values(${lit(ids.classroom)}::uuid,${lit(`QR${runId.toUpperCase()}`)},${lit(`${RUN_PREFIX} ${runId}`)},${lit(`${RUN_PREFIX} school ${runId}`)},'Basic 7','B7',${lit(ids.teacherProfile)}::uuid,${lit(teacher.id)}::uuid,${lit(ids.teacherProfile)}::uuid,${lit(ids.curriculum)}::uuid,'active','2026','1');
      insert into public.questions(id,external_question_id,question_code,subject_code,subject_name,difficulty_code,difficulty_label,cognitive_level,marks,estimated_time_seconds,
          question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,explanation,hint,status,validation_status,source_type,source_storage_path,commercial_status,tags,version,rendering_version,
          question_content,curriculum_node_id,reviewed_by,reviewed_at,editorial_metadata,source_document_ids)
        select v.id,v.ext,v.ext,'Mathematics','Mathematics','easy','easy','remember',1,30,
          v.qt,v.a,v.b,v.c,v.d,v.ans,'SINGLE_CHOICE','Fixture explanation for ' || v.ext,'Fixture hint for ' || v.ext,'active','approved','QBRUN_FIXTURE','fixtures/qbrun','INTERNAL_ONLY',array['QBRUN_FIXTURE'],1,1,
          jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('type','text','text',v.qt))),${lit(ids.node)}::uuid,${lit(teacher.id)}::uuid,now(),'{"human_reviewed":true,"change_note":"run-scoped fixture"}'::jsonb,array[${lit(ids.document)}::uuid]
        from (values ${questionRows}) as v(id,ext,qt,a,b,c,d,ans);
    `);
    // Questions are authorized through the run's approved curriculum source document, so no legacy attribution row is created.
    // legacy_content_attributions is immutable history and must never be written by run-scoped fixtures.
    const attributed = sqlJson<{ n: number }[]>(`select count(*)::int n from public.legacy_content_attributions where question_id in (${questions.map((q) => lit(q.id)).join(",")})`)[0].n;
    if (attributed !== 0) throw new Error("FIXTURE_UNEXPECTED_IMMUTABLE_ATTRIBUTION");
  } catch (error) {
    try { destroyFixtureWorldSync(runId); } catch { /* the stale-run sweeper retries by run id */ }
    throw error;
  }
  const service = createClient(target.url, target.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const world: FixtureWorld = {
    runId, url: target.url, service, questions, users,
    market: { id: ids.market, name: marketName(runId) },
    curriculum: { id: ids.curriculum, code: marketName(runId) },
    node: { id: ids.node, code: `${RUN_PREFIX}-${runId}-LI1`, title: "Add and subtract within 20", curriculum_id: ids.curriculum, education_level: "JHS", grade_code: "B7", canonical_grade_code: "B7", source_grade_code: "B7", subject_code: "Mathematics" },
    documentId: ids.document, otherTenantId: options.otherTenant ? ids.tenantB : undefined,
    classroom: { id: ids.classroom, joinCode: `QR${runId.toUpperCase()}`, name: `${RUN_PREFIX} ${runId}` },
    async client(role) {
      const user = users[role];
      if (!user) throw new Error("FIXTURE_ROLE_NOT_CREATED");
      const client = createClient(target.url, target.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const login = await client.auth.signInWithPassword({ email: user.email, password: user.password });
      if (login.error) throw new Error("FIXTURE_LOGIN_FAILED");
      return client;
    },
  };
  if (options.joinStudents !== false) {
    for (const role of ["student", "student2"] as const) {
      if (!users[role]) continue;
      const client = await world.client(role);
      const joined = await client.rpc("qb_join_class", { p_join_code: world.classroom.joinCode });
      if (joined.error || joined.data?.error) throw new Error("FIXTURE_CLASS_JOIN_FAILED: " + (joined.error?.message ?? joined.data?.error));
    }
  }
  return world;
}

// ---- Teardown (dependency ordered, idempotent, scoped strictly to one run id) ---------------------------------------
export const TEARDOWN_ORDER = [
  "responses", "learning_events", "xp_transactions", "assessment_results", "gradebook", "attempts", "assignment_targets",
  "assignment_question_versions", "assessment_questions", "assignments", "assessments", "mastery_records", "notifications", "audit_logs",
  "class_memberships", "classes", "legacy_content_attributions + market_attribution_issues", "question_versions", "questions",
  "curriculum_nodes", "market_curricula", "curricula", "curriculum_authorities", "wallet/coin/qpoint rows", "user_market_memberships",
  "teacher_profiles/student_profiles", "profiles", "auth.users", "markets",
] as const;

function teardownScript(runId: string) {
  assertRunId(runId);
  const email = `${RUN_PREFIX.toLowerCase()}-${runId}-%@${FIXTURE_EMAIL_DOMAIN}`;
  return `
    create temp table _u on commit drop as select id from auth.users where email like ${lit(email)};
    create temp table _m on commit drop as select id from public.markets where name=${lit(marketName(runId))};
    create temp table _cu on commit drop as select id from public.curricula where code=${lit(marketName(runId))} or market_id in (select id from _m);
    create temp table _n on commit drop as select id from public.curriculum_nodes where curriculum_id in (select id from _cu);
    create temp table _b on commit drop as select id from public.content_import_batches where imported_by in (select id from _u);
    create temp table _q on commit drop as select id from public.questions where external_question_id like ${lit(`${RUN_PREFIX}-${runId}-%`)} or curriculum_node_id in (select id from _n) or import_batch_id in (select id from _b);
    create temp table _d on commit drop as select id from public.source_documents where title=${lit(`${RUN_PREFIX} source ${runId}`)} or market_id in (select id from _m);
    create temp table _c on commit drop as select id from public.classes where class_name=${lit(`${RUN_PREFIX} ${runId}`)} or teacher_user_id in (select id from _u) or curriculum_id in (select id from _cu);
    create temp table _as on commit drop as select assessment_id id from public.assignments where class_id in (select id from _c)
      union select id from public.assessments where owner_user_id in (select id from _u);
    create temp table _at on commit drop as select id from public.attempts where assessment_id in (select id from _as) or student_user_id in (select id from _u) or class_id in (select id from _c);
    delete from public.responses where attempt_id in (select id from _at) or question_id in (select id from _q);
    delete from public.learning_events where attempt_id in (select id from _at) or student_user_id in (select id from _u) or question_id in (select id from _q);
    delete from public.xp_transactions where attempt_id in (select id from _at) or student_user_id in (select id from _u);
    delete from public.assessment_results where attempt_id in (select id from _at);
    delete from public.gradebook where attempt_id in (select id from _at) or assessment_id in (select id from _as);
    delete from public.attempts where id in (select id from _at);
    delete from public.assignment_targets where class_id in (select id from _c);
    delete from public.assignment_question_versions where question_id in (select id from _q) or assignment_id in (select id from public.assignments where class_id in (select id from _c));
    delete from public.assessment_questions where question_id in (select id from _q) or assessment_id in (select id from _as);
    delete from public.assignments where class_id in (select id from _c) or assessment_id in (select id from _as);
    delete from public.assessments where id in (select id from _as);
    delete from public.mastery_records where student_user_id in (select id from _u) or curriculum_node_id in (select id from _n);
    delete from public.notifications where recipient_user_id in (select id from _u) or market_id in (select id from _m);
    delete from public.audit_logs where actor_user_id in (select id from _u);
    delete from public.class_memberships where class_id in (select id from _c) or student_user_id in (select id from _u);
    delete from public.classes where id in (select id from _c);
    delete from public.legacy_content_attributions where question_id in (select id from _q) or market_id in (select id from _m);
    delete from public.market_attribution_issues where entity='question' and record_id in (select id from _q);
    delete from public.question_import_staging where import_batch_id in (select id from _b);
    delete from public.question_versions where question_id in (select id from _q);
    delete from public.questions where id in (select id from _q);
    delete from public.content_import_batches where id in (select id from _b);
    delete from public.source_documents where id in (select id from _d);
    delete from public.marketplace_sellers where seller_entity_id in (select id from _u);
    delete from public.sponsor_profiles where user_id in (select id from _u);
    delete from public.tenants where code=${lit(`${marketName(runId)}-B`)};
    delete from public.sme_domain_assignments where reviewer_id in (select id from _u) or curriculum_id in (select id from _cu) or market_id in (select id from _m);
    delete from public.sme_profiles where user_id in (select id from _u);
    delete from public.curriculum_nodes where id in (select id from _n);
    delete from public.market_curricula where curriculum_id in (select id from _cu) or market_id in (select id from _m);
    delete from public.curricula where id in (select id from _cu);
    delete from public.curriculum_authorities where market_id in (select id from _m);
    delete from public.coin_transactions where actor_id in (select id from _u);
    delete from public.qpoint_transactions where user_id in (select id from _u);
    delete from public.wallets where user_id in (select id from _u);
    delete from public.user_market_memberships where user_id in (select id from _u) or market_id in (select id from _m);
    delete from public.teacher_profiles where user_id in (select id from _u);
    delete from public.student_profiles where user_id in (select id from _u);
    delete from public.profiles where id in (select id from _u);
    delete from auth.users where id in (select id from _u);
    delete from public.markets where id in (select id from _m);
  `;
}
function destroyFixtureWorldSync(runId: string) { previewSql(teardownScript(runId), { idempotent: true }); }

export interface LeftoverReport { runId: string; total: number; byTable: Record<string, number> }
export function countRunRows(runId: string): LeftoverReport {
  assertRunId(runId);
  const email = `${RUN_PREFIX.toLowerCase()}-${runId}-%@${FIXTURE_EMAIL_DOMAIN}`;
  const rows = sqlJson<Record<string, number>[]>(`select
    (select count(*) from auth.users where email like ${lit(email)})::int as auth_users,
    (select count(*) from public.profiles where email like ${lit(email)})::int as profiles,
    (select count(*) from public.markets where name=${lit(marketName(runId))})::int as markets,
    (select count(*) from public.curricula where code=${lit(marketName(runId))})::int as curricula,
    (select count(*) from public.curriculum_nodes where code like ${lit(`${RUN_PREFIX}-${runId}-%`)})::int as curriculum_nodes,
    (select count(*) from public.curriculum_authorities where code=${lit(`QR${runId}`)})::int as authorities,
    (select count(*) from public.classes where class_name=${lit(`${RUN_PREFIX} ${runId}`)})::int as classes,
    (select count(*) from public.content_import_batches b join auth.users u on u.id=b.imported_by where u.email like ${lit(email)})::int as import_batches,
    (select count(*) from public.sme_profiles p join auth.users u on u.id=p.user_id where u.email like ${lit(email)})::int as sme_profiles,
    (select count(*) from public.marketplace_sellers where display_name=${lit(`${RUN_PREFIX} seller ${runId}`)})::int as sellers,
    (select count(*) from public.sponsor_profiles where organization_name=${lit(`${RUN_PREFIX} sponsor ${runId}`)})::int as sponsors,
    (select count(*) from public.tenants where code=${lit(`${marketName(runId)}-B`)})::int as tenants,
    (select count(*) from public.source_documents where title=${lit(`${RUN_PREFIX} source ${runId}`)})::int as source_documents,
    (select count(*) from public.questions where external_question_id like ${lit(`${RUN_PREFIX}-${runId}-%`)})::int as questions,
    (select count(*) from public.legacy_content_attributions l join public.questions q on q.id=l.question_id where q.external_question_id like ${lit(`${RUN_PREFIX}-${runId}-%`)})::int as attributions,
    (select count(*) from public.assignments a join public.classes c on c.id=a.class_id where c.class_name=${lit(`${RUN_PREFIX} ${runId}`)})::int as assignments,
    (select count(*) from public.attempts a join auth.users u on u.id=a.student_user_id where u.email like ${lit(email)})::int as attempts,
    (select count(*) from public.xp_transactions x join auth.users u on u.id=x.student_user_id where u.email like ${lit(email)})::int as xp_transactions,
    (select count(*) from public.learning_events e join auth.users u on u.id=e.student_user_id where u.email like ${lit(email)})::int as learning_events,
    (select count(*) from public.mastery_records m join auth.users u on u.id=m.student_user_id where u.email like ${lit(email)})::int as mastery_records`);
  const byTable = rows[0] ?? {};
  return { runId, byTable, total: Object.values(byTable).reduce((sum, n) => sum + Number(n), 0) };
}

export async function destroyFixtureWorld(worldOrRunId: FixtureWorld | string): Promise<LeftoverReport> {
  const runId = typeof worldOrRunId === "string" ? worldOrRunId : worldOrRunId.runId;
  destroyFixtureWorldSync(runId);
  return countRunRows(runId);
}

/** Stale-run sweeper: finds only runs whose ids match the strict run pattern and are older than maxAgeMs. */
export function sweepStaleRuns(options: { maxAgeMs?: number; exclude?: string[] } = {}): { swept: string[]; stuck: string[] } {
  const maxAge = options.maxAgeMs ?? 60 * 60 * 1000;
  const marketRuns = sqlJson<{ name: string }[]>(`select name from public.markets where name ~ '^${RUN_PREFIX}-[a-z0-9]{12}$'`).map((r) => r.name.slice(RUN_PREFIX.length + 1));
  const userRuns = sqlJson<{ email: string }[]>(`select email from auth.users where email ~ '^${RUN_PREFIX.toLowerCase()}-[a-z0-9]{12}-[a-z0-9]+@${FIXTURE_EMAIL_DOMAIN.replace(/\./g, "\\.")}$'`).map((r) => r.email.split("-")[1]);
  const swept: string[] = [], stuck: string[] = [];
  for (const runId of new Set([...marketRuns, ...userRuns])) {
    if (!RUN_ID.test(runId) || options.exclude?.includes(runId)) continue;
    const started = runTimestamp(runId);
    if (!Number.isFinite(started) || started < Date.parse("2026-01-01") || started > Date.now() + 86_400_000 || Date.now() - started < maxAge) continue;
    // A run that cannot be cleared (for example one holding immutable history) is reported, never allowed to fail the suite.
    try { destroyFixtureWorldSync(runId); swept.push(runId); } catch { stuck.push(runId); }
  }
  return { swept, stuck };
}

export async function withFixtureWorld<T>(options: CreateOptions, run: (world: FixtureWorld) => Promise<T>): Promise<T> {
  const world = await createFixtureWorld(options);
  try { return await run(world); } finally { await destroyFixtureWorld(world); }
}

/** Adds one extra run-scoped question in a chosen editorial state/source namespace (removed by the run's teardown). */
export function insertRunQuestion(world: FixtureWorld, options: { sourceType: string; validationStatus?: "review" | "approved"; label: string }): string {
  const id = randomUUID();
  const external = `${RUN_PREFIX}-${world.runId}-${options.label}`;
  const status = options.validationStatus ?? "review";
  const teacher = world.users.teacher!;
  previewSql(`
    insert into public.questions(id,external_question_id,question_code,subject_code,subject_name,difficulty_code,difficulty_label,cognitive_level,marks,estimated_time_seconds,
        question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,explanation,hint,status,validation_status,source_type,source_storage_path,commercial_status,tags,version,rendering_version,
        question_content,curriculum_node_id,reviewed_by,reviewed_at,editorial_metadata,source_document_ids)
      values(${lit(id)}::uuid,${lit(external)},${lit(external)},'Mathematics','Mathematics','easy','easy','remember',1,30,
        ${lit(`Which number is the sum of 6 and 1 for ${external}?`)},'5','6','7','8','C','SINGLE_CHOICE','Fixture explanation for ${external}','Fixture hint for ${external}',${status === "approved" ? "'active'" : "'inactive'"},${lit(status)},${lit(options.sourceType)},'fixtures/qbrun','INTERNAL_ONLY',array['QBRUN_FIXTURE'],1,1,
        '{"blocks":[{"type":"text","text":"Run scoped fixture question"}]}'::jsonb,${lit(world.node.id)}::uuid,${status === "approved" ? `${lit(teacher.id)}::uuid` : "null"},${status === "approved" ? "now()" : "null"},${status === "approved" ? `'{"human_reviewed":true}'::jsonb` : "'{}'::jsonb"},array[${lit(world.documentId)}::uuid]);
  `);
  return id;
}
