// Creates synthetic inter-school demonstration data in PREVIEW only: four schools, Basic 7 to 9, Mathematics and English, three rounds, a sponsored competition with a quotation and
// recorded (pretend) payment, a campaign link, an invited knockout between schools, and one completed round of results.
//
//   npx tsx scripts/interschool/demo-preview.ts --accounts <file outside the repository> [--site https://preview.quizbox.io] [--enable-flags] [--no-play]
//
// Run it AFTER the five inter-school migrations have been applied to Preview. Settings come only from .env.branch.local and .env.preview-db.local (in the current folder, or in
// QB_ENV_DIR); the Production project is refused before anything is written. Everything it creates is named DEMO and uses @e2e.quizbox.invalid addresses. The sign-in details are
// written to the --accounts file and are never printed. It does not delete anything: cancel the demonstration competitions from the screen when finished.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { previewSql, resolveTarget, FIXTURE_EMAIL_DOMAIN } from "../../lib/operations/live-fixture";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (name: string) => process.argv.includes(`--${name}`);
const accountsArg = arg("accounts");
if (!accountsArg) { console.error("Usage: npx tsx scripts/interschool/demo-preview.ts --accounts <file> [--site URL] [--enable-flags] [--no-play]"); process.exit(2); }
const accountsFile = resolve(accountsArg);
if (accountsFile.startsWith(process.cwd())) { console.error("Choose an accounts file outside the repository folder: it holds passwords."); process.exit(2); }
const site = (arg("site") ?? "https://preview.quizbox.io").replace(/\/+$/, "");
if (process.env.QB_ENV_DIR) process.chdir(process.env.QB_ENV_DIR);

const target = resolveTarget();                    // refuses anything that is not the Preview project
const run = `is${Date.now().toString(36).slice(-7)}`;
const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;
const LEVELS = ["B7", "B8", "B9"] as const, SUBJECTS = ["Mathematics", "English"] as const, SCHOOLS = 4, PER_LEVEL = 3, QUESTIONS = 24;
type Person = { id: string; email: string; password: string; label: string; role: "admin" | "teacher" | "student" | "sponsor"; school?: number; level?: string };

async function createUser(label: string, role: Person["role"], level = "B7"): Promise<Person> {
  const email = `qbdemo-${run}-${label}@${FIXTURE_EMAIL_DOMAIN}`, password = randomBytes(15).toString("base64url");
  const res = await fetch(`${target.url}/auth/v1/admin/users`, { method: "POST", headers: { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Demo ${label.replaceAll("-", " ")}`, grade: level, qbdemo: run } }) });
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !body.id) throw new Error(`DEMO_AUTH_USER_FAILED_${res.status}`);
  return { id: body.id, email, password, label, role };
}
async function signedIn(p: Person): Promise<SupabaseClient> {
  const client = createClient(target.url, target.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: p.email, password: p.password });
  if (error) throw new Error("DEMO_LOGIN_FAILED");
  return client;
}
async function call<T = any>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

// A synthetic question: arithmetic for Mathematics, word forms for English. Clearly demonstration material.
function question(level: string, subject: string, n: number) {
  if (subject === "Mathematics") { const a = n + Number(level.slice(1)), b = (n % 7) + 3; return { text: `DEMO ${level}: what is ${a} multiplied by ${b}?`, right: String(a * b), wrong: [String(a * b + b), String(a * b - a), String(a + b)] }; }
  const nouns = ["market", "school", "river", "farmer", "teacher", "lorry", "basket", "village", "doctor", "window", "garden", "harbour", "kitchen", "library", "painter", "station", "village green", "mango", "classroom", "bridge", "drummer", "fisher", "tailor", "carpenter"];
  const word = nouns[n % nouns.length];
  return { text: `DEMO ${level}: which sentence number ${n + 1} uses a capital letter and full stop correctly?`, right: `The ${word} is here.`, wrong: [`the ${word} is here.`, `The ${word} is here`, `the ${word} Is here`] };
}

async function main() {
  console.log(`Preview demonstration ${run}`);
  const admin = await createUser("admin", "admin"), sponsor = await createUser("sponsor", "sponsor");
  const teachers: Person[] = [], learners: Person[] = [];
  for (let s = 1; s <= SCHOOLS; s++) {
    teachers.push({ ...(await createUser(`teacher-school${s}`, "teacher")), school: s });
    for (const level of LEVELS) for (let n = 1; n <= PER_LEVEL; n++) learners.push({ ...(await createUser(`learner-s${s}-${level.toLowerCase()}-${n}`, "student", level)), school: s, level });
  }
  const people = [admin, sponsor, ...teachers, ...learners];
  console.log(`Created ${people.length} accounts`);

  const ids = { market: randomUUID(), authority: randomUUID(), curriculum: randomUUID(), document: randomUUID() };
  const schools = Array.from({ length: SCHOOLS }, () => randomUUID());
  const subjects = LEVELS.flatMap((level) => SUBJECTS.map((subject) => ({ level, subject, node: randomUUID(), indicator: randomUUID() })));
  const roleValues = people.map((p) => `(${lit(p.id)}::uuid, ${lit(p.role === "sponsor" ? "sponsor" : p.role)}::public.qb_role)`).join(",");
  const questionRows = subjects.flatMap((x) => Array.from({ length: QUESTIONS }, (_, n) => {
    const q = question(x.level, x.subject, n), at = n % 4, options = [...q.wrong]; options.splice(at, 0, q.right);
    const ext = `${run}-${x.level}-${x.subject.slice(0, 3)}-${n}`, difficulty = ["easy", "medium", "hard"][n % 3];
    return `(${lit(randomUUID())}::uuid,${lit(ext)},${lit(x.subject)},${lit(difficulty)},${lit(q.text)},${options.map(lit).join(",")},${lit("ABCD"[at])},${lit(x.level)},${lit(x.indicator)}::uuid)`;
  })).join(",\n");

  previewSql(`
    insert into public.markets(id,country_id,name,default_currency_code,timezone,locale,status,is_test)
      select ${lit(ids.market)}::uuid,c.id,${lit(`DEMO ${run}`)},c.default_currency_code,c.timezone,c.locale,'ACTIVE',true from public.countries c order by (c.iso2_code='XT') desc, c.iso2_code limit 1;
    insert into public.curriculum_authorities(id,market_id,code,name) values(${lit(ids.authority)}::uuid,${lit(ids.market)}::uuid,${lit(run)},${lit(`DEMO authority ${run}`)});
    insert into public.curricula(id,code,name,country,version,market_id,status) values(${lit(ids.curriculum)}::uuid,${lit(`DEMO-${run}`)},${lit(`DEMO curriculum ${run}`)},'Testland','1',${lit(ids.market)}::uuid,'ACTIVE');
    insert into public.market_curricula(curriculum_id,market_id,authority_id,active) values(${lit(ids.curriculum)}::uuid,${lit(ids.market)}::uuid,${lit(ids.authority)}::uuid,true);
    update public.profiles p set role=r.role, default_market_id=${lit(ids.market)}::uuid, primary_market_id=${lit(ids.market)}::uuid, onboarding_completed_at=now() from (values ${roleValues}) as r(id,role) where p.id=r.id;
    insert into public.user_market_memberships(user_id,market_id,active) select r.id,${lit(ids.market)}::uuid,true from (values ${roleValues}) as r(id,role) on conflict do nothing;
    insert into public.sponsor_profiles(user_id,organization_name,contact_name) select ${lit(sponsor.id)}::uuid,'DEMO Gold Bank','Demo contact' where not exists (select 1 from public.sponsor_profiles where user_id=${lit(sponsor.id)}::uuid);
    update public.sponsor_profiles set verification_status='VERIFIED' where user_id=${lit(sponsor.id)}::uuid;
    insert into public.institutions(id,name,region,district,verified_at) values ${schools.map((id, i) => `(${lit(id)}::uuid,${lit(`DEMO School ${i + 1} (${run})`)},${lit(i < 2 ? "Greater Accra" : "Ashanti")},${lit(`Demo District ${i + 1}`)},now())`).join(",")};
    insert into public.institution_memberships(institution_id,user_id,role) values ${[...teachers.map((t) => `(${lit(schools[t.school! - 1])}::uuid,${lit(t.id)}::uuid,'teacher')`), ...learners.map((l) => `(${lit(schools[l.school! - 1])}::uuid,${lit(l.id)}::uuid,'student')`)].join(",")};
    insert into public.teacher_profiles(user_id,school_name,institution_id) values ${teachers.map((t) => `(${lit(t.id)}::uuid,${lit(`DEMO School ${t.school}`)},${lit(schools[t.school! - 1])}::uuid)`).join(",")} on conflict (user_id) do update set institution_id=excluded.institution_id;
    insert into public.student_profiles(user_id,grade,grade_code,institution_id) values ${learners.map((l) => `(${lit(l.id)}::uuid,${lit(l.level!)}::public.qb_grade,${lit(l.level!)},${lit(schools[l.school! - 1])}::uuid)`).join(",")}
      on conflict (user_id) do update set grade=excluded.grade, grade_code=excluded.grade_code, institution_id=excluded.institution_id;
    insert into public.curriculum_nodes(id,curriculum_id,node_type,code,identity_key,title,source_terminology,education_level,grade_code,source_grade_code,canonical_grade_code,subject_code,is_active) values ${subjects.map((x) => {
      const code = `${run}-${x.level}-${x.subject.slice(0, 3)}`;
      return `(${lit(x.node)}::uuid,${lit(ids.curriculum)}::uuid,'subject',${lit(code)},${lit(code)},${lit(x.subject)},'subject','JHS',${lit(x.level)},${lit(x.level)},${lit(x.level)},${lit(x.subject)},true)`;
    }).join(",")};
    insert into public.curriculum_nodes(id,curriculum_id,parent_id,node_type,code,identity_key,title,source_terminology,education_level,grade_code,source_grade_code,canonical_grade_code,subject_code,is_active) values ${subjects.map((x) => {
      const code = `${run}-${x.level}-${x.subject.slice(0, 3)}-LI1`;
      return `(${lit(x.indicator)}::uuid,${lit(ids.curriculum)}::uuid,${lit(x.node)}::uuid,'learning_indicator',${lit(code)},${lit(code)},${lit(`DEMO ${x.subject} skills`)},'learning indicator','JHS',${lit(x.level)},${lit(x.level)},${lit(x.level)},${lit(x.subject)},true)`;
    }).join(",")};
    insert into public.source_documents(id,title,source_kind,validation_status,rights_confirmed,checksum,content_text,approved_by,uploaded_by,market_id,curriculum_id,authority_id,document_type)
      values(${lit(ids.document)}::uuid,${lit(`DEMO source ${run}`)},'CURRICULUM','approved',true,${lit(`demo${run}`)},'Synthetic demonstration source',${lit(admin.id)}::uuid,${lit(admin.id)}::uuid,${lit(ids.market)}::uuid,${lit(ids.curriculum)}::uuid,${lit(ids.authority)}::uuid,'CURRICULUM');
    insert into public.questions(id,external_question_id,question_code,subject_code,subject_name,difficulty_code,difficulty_label,cognitive_level,marks,estimated_time_seconds,question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,explanation,
        status,validation_status,source_type,source_storage_path,commercial_status,tags,version,rendering_version,question_content,curriculum_node_id,source_grade_code,canonical_grade_code,reviewed_by,reviewed_at,editorial_metadata,source_document_ids)
      select v.id,v.ext,v.ext,v.subject,v.subject,v.diff,v.diff,'remember',1,45,v.qt,v.a,v.b,v.c,v.d,v.ans,'SINGLE_CHOICE','Demonstration question.','active','approved','DEMO_FIXTURE','fixtures/demo','INTERNAL_ONLY',array['DEMO'],1,1,
        jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('type','text','text',v.qt))),v.node,v.grade,v.grade,${lit(admin.id)}::uuid,now(),'{"human_reviewed":true,"change_note":"synthetic demonstration"}'::jsonb,array[${lit(ids.document)}::uuid]
      from (values ${questionRows}) as v(id,ext,subject,diff,qt,a,b,c,d,ans,grade,node);
    ${has("enable-flags") ? "update public.platform_settings set value='true'::jsonb where scope_type='global' and key in ('flags.interschool','flags.interschool_public','flags.interschool_sponsorship','flags.interschool_certificates');" : ""}
  `);
  console.log("Created schools, memberships, curriculum and synthetic questions");

  const adminClient = await signedIn(admin), sponsorClient = await signedIn(sponsor);
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  await call(adminClient, "interschool_set_rate", { p_rate_minor: 500, p_setup_fee_minor: 0 });

  const cup = await call<{ id: string; slug: string }>(sponsorClient, "interschool_create", { p_settings: {
    title: `DEMO Gold Bank JHS Cup ${run}`, description: "Demonstration competition: Basic 7, 8 and 9 schools in Mathematics and English over three rounds.", participation: "OPEN", scale: "REGIONAL", funding: "SPONSORED", sponsor_name: "DEMO Gold Bank",
    expected_participants: 2000, capacity: 2000, max_per_school: 9, max_per_level_per_school: 3, registration_opens_at: at(-10), registration_closes_at: at(60 * 20), opens_at: at(0), ends_at: at(60 * 24 * 14), scoring_top_n: 2,
    rules: "Demonstration rules. One attempt per round.", prizes: "Demonstration prizes only." } });
  const set = await call<{ divisions: Array<{ id: string; level_codes: string[] }> }>(sponsorClient, "interschool_set_divisions", { p_id: cup.id, p_divisions: LEVELS.map((l) => ({ title: `Basic ${l.slice(1)}`, level_codes: [l] })) });
  for (const d of set.divisions) {
    const sections = subjects.filter((x) => x.level === d.level_codes[0]).map((x) => ({ subject_id: x.node, count: 5 }));
    await call(sponsorClient, "interschool_set_rounds", { p_division: d.id, p_rounds: [
      { title: "Preliminary", stage: "PRELIMINARY", opens_at: at(5), closes_at: at(60 * 24), duration_seconds: 900, sections, rule: "TOP_SCHOOLS", top_n: 3 },
      { title: "Semi-final", stage: "SEMI_FINAL", opens_at: at(60 * 24 * 3), closes_at: at(60 * 24 * 4), duration_seconds: 900, sections, rule: "TOP_LEARNERS", top_n: 4 },
      { title: "Final", stage: "FINAL", opens_at: at(60 * 24 * 7), closes_at: at(60 * 24 * 8), duration_seconds: 900, sections, rule: "ALL" }] });
  }
  await call(sponsorClient, "interschool_request_approval", { p_id: cup.id });
  await call(adminClient, "interschool_decide", { p_id: cup.id, p_approve: true, p_note: "Demonstration" });
  const quote = await call<{ id: string; total_minor: number }>(sponsorClient, "interschool_quote", { p_competition: cup.id });
  const invoice = await call<{ id: string; number: string }>(sponsorClient, "interschool_decide_quote", { p_quote: quote.id, p_accept: true });
  await call(adminClient, "interschool_fund_invoice", { p_invoice: invoice.id, p_action: "RECORD_PAYMENT", p_note: "DEMO payment, no money moved" });
  await call(sponsorClient, "interschool_publish", { p_id: cup.id });
  await call(adminClient, "interschool_set_listed", { p_id: cup.id, p_listed: true });
  console.log(`Sponsored cup published: quotation ${(quote.total_minor / 100).toFixed(2)} GHS, invoice ${invoice.number} recorded as paid (pretend)`);

  const teacherClients = await Promise.all(teachers.map(signedIn));
  for (let s = 0; s < SCHOOLS; s++) {
    await call(teacherClients[s], "interschool_school_respond", { p_id: cup.id, p_institution: schools[s], p_accept: true });
    for (const d of set.divisions) {
      const users = learners.filter((l) => l.school === s + 1 && l.level === d.level_codes[0]).map((l) => l.id);
      const out = await call<{ results: Array<{ ok: boolean; error?: string }> }>(teacherClients[s], "interschool_nominate", { p_id: cup.id, p_institution: schools[s], p_division: d.id, p_users: users });
      const bad = out.results.filter((r) => !r.ok); if (bad.length) throw new Error(`nomination refused: ${bad.map((b) => b.error).join(", ")}`);
    }
  }
  console.log(`Registered ${learners.length} learners from ${SCHOOLS} schools`);

  const head = await call<{ id: string; slug: string }>(teacherClients[0], "interschool_create", { p_host: schools[0], p_settings: {
    title: `DEMO Head to Head B8 ${run}`, participation: "INVITE", capacity: 40, expected_participants: 40, registration_opens_at: at(-10), registration_closes_at: at(60 * 24 * 2), opens_at: at(0), ends_at: at(60 * 24 * 20), school_scoring: "TOP_N", scoring_top_n: 2 } });
  const headSet = await call<{ divisions: Array<{ id: string }> }>(teacherClients[0], "interschool_set_divisions", { p_id: head.id, p_divisions: [{ title: "Basic 8", level_codes: ["B8"] }] });
  await call(teacherClients[0], "interschool_set_rounds", { p_division: headSet.divisions[0].id, p_rounds: [
    { title: "Fixture", format: "KNOCKOUT", stage: "FINAL", rule: "FIXTURE_WINNERS", opens_at: at(60 * 24 * 10), closes_at: at(60 * 24 * 11), duration_seconds: 600, sections: [{ subject_id: subjects.find((x) => x.level === "B8" && x.subject === "Mathematics")!.node, count: 5 }] }] });
  await call(teacherClients[0], "interschool_publish", { p_id: head.id });
  await call(teacherClients[0], "interschool_invite", { p_id: head.id, p_institutions: [schools[0], schools[1]] });
  for (const s of [0, 1]) {
    await call(teacherClients[s], "interschool_school_respond", { p_id: head.id, p_institution: schools[s], p_accept: true });
    await call(teacherClients[s], "interschool_nominate", { p_id: head.id, p_institution: schools[s], p_division: headSet.divisions[0].id, p_users: learners.filter((l) => l.school === s + 1 && l.level === "B8").map((l) => l.id) });
  }
  await call(teacherClients[0], "interschool_generate_fixtures", { p_division: headSet.divisions[0].id, p_method: "KNOCKOUT" });
  console.log("Invited head-to-head published with its fixture");

  writeFileSync(accountsFile, [`QuizBox PREVIEW demonstration ${run}. Delete this file when testing is finished.`, "", ...people.map((p) => `${p.label}\t${p.email}\t${p.password}`)].join("\r\n"), "utf8");
  console.log(`Sign-in details written to ${accountsFile}`);

  if (!has("no-play")) {
    const wait = new Date(at(0)).getTime(), opens = wait + 5.2 * 60_000;
    console.log("Waiting about five minutes for the preliminary round to open ...");
    await new Promise((r) => setTimeout(r, Math.max(0, opens - Date.now())));
    let taken = 0;
    for (const l of learners) {
      if (l.label.endsWith("-3")) continue;                                        // one learner per team does not sit, to show absences
      const client = await signedIn(l);
      const mine = await call<Array<{ competition: { id: string }; rounds: Array<{ round_id: string; round_no: number }> }>>(client, "interschool_mine");
      const round = mine.find((m) => m.competition.id === cup.id)!.rounds.find((r) => r.round_no === 1)!;
      const sitting = await call<{ sitting_id: string; questions: Array<{ id: string; options: string[] }> }>(client, "interschool_start", { p_round: round.round_id });
      await call(client, "interschool_submit", { p_sitting: sitting.sitting_id, p_answers: sitting.questions.map((q, i) => ({ question_id: q.id, choice: (i + l.school!) % q.options.length })) });
      taken++;
    }
    const ops = await call<{ rounds: Array<{ round_id: string; round_no: number }> }>(adminClient, "interschool_operations", { p_id: cup.id });
    for (const r of ops.rounds.filter((x) => x.round_no === 1)) await call(adminClient, "interschool_finalise_round", { p_round: r.round_id, p_force: true });
    console.log(`${taken} learners sat the preliminary round; results finalised early by the administrator`);
  }

  console.log(["", "Open these on Preview:", `  Campaign page     ${site}/inter-school/${cup.slug}`, `  QR campaign link  ${site}/inter-school/${cup.slug}?src=qr`, `  Flyer             ${site}/inter-school/${cup.slug}/flyer`,
    `  Organiser screen  ${site}/interschool/manage/${cup.id}`, `  Administration    ${site}/admin/interschool`, `  Head to head      ${site}/interschool/manage/${head.id}`].join("\n"));
}
main().catch((e) => { console.error(`Stopped: ${e instanceof Error ? e.message : e}`); process.exit(1); });
