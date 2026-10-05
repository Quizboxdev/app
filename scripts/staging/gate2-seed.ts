// Gate 2 staging seed: real auth users + a small deterministic School dataset on the NON-PRODUCTION preview branch only.
//   npx tsx scripts/staging/gate2-seed.ts             dry run: guards + read-only discovery, nothing written
//   npx tsx scripts/staging/gate2-seed.ts --apply     create identities and dataset (idempotent)
//   npx tsx scripts/staging/gate2-seed.ts --cleanup   remove everything this script created
// Uses only the branch's service-role key through REST/Auth admin (no DDL, no database password). Test credentials go to
// .env.gate2.local (gitignored) and are never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ASSIGNMENTS, CLASSES, EVIDENCE, GRADES, SCHOOLS, USERS, email, gid, type UserKey } from "./gate2-dataset";

const apply = process.argv.includes("--apply"), cleanup = process.argv.includes("--cleanup");
const parseEnv = (file: string) => Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const env = parseEnv(".env.branch.local");
const BRANCH = "fngdtxayfoiffbcbmcum";
const claim = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// ---- Guards: refuse unless every signal says "this exact preview branch, and not production".
const urlRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const guards = [
  [urlRef === BRANCH, "URL host is the preview branch"],
  [env.QUIZBOX_SPONSOR_BRANCH_REF === BRANCH, "QUIZBOX_SPONSOR_BRANCH_REF matches"],
  [env.QB_ENVIRONMENT === "branch", "QB_ENVIRONMENT=branch"],
  [env.QB_PRODUCTION_PROJECT_REF && env.QB_PRODUCTION_PROJECT_REF !== urlRef, "declared production ref differs from target"],
  [claim(env.SUPABASE_SERVICE_ROLE_KEY).ref === BRANCH && claim(env.SUPABASE_SERVICE_ROLE_KEY).role === "service_role", "service-role key is bound to the branch"],
] as const;
for (const [ok, label] of guards) { console.log(`${ok ? "ok  " : "FAIL"} guard: ${label}`); if (!ok) { console.error("Refusing to continue."); process.exit(2); } }

const BASE = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function http(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...H, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null };
}
async function must(label: string, p: ReturnType<typeof http>) { const r = await p; if (!r.ok) { console.error(`FAIL ${label}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`); throw new Error(label); } return r.json; }
const get = (path: string) => must(`GET ${path.slice(0, 60)}`, http("GET", path));
const upsert = (table: string, rows: unknown[], conflict = "id") => rows.length ? must(`upsert ${table}`, http("POST", `/rest/v1/${table}?on_conflict=${conflict}`, rows, { Prefer: "resolution=merge-duplicates,return=minimal" })) : null;
const inList = (ids: string[]) => `in.(${ids.join(",")})`;

const userIds = Object.fromEntries(Object.keys(USERS).map((k) => [k, gid(`user-${k}`)])) as Record<UserKey, string>;
const spId = (k: UserKey) => gid(`student-profile-${k}`), tpId = (k: UserKey) => gid(`teacher-profile-${k}`);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

async function discover() {
  // service_role has no privileges on public.markets on this branch, so the market comes from the curriculum row.
  const curricula = await get("/rest/v1/curricula?select=id,code,market_id&status=eq.ACTIVE&market_id=not.is.null&limit=1");
  const markets = [{ id: curricula[0]?.market_id }];
  const nodes = await get("/rest/v1/curriculum_nodes?select=id,code,title&node_type=eq.learning_indicator&is_active=eq.true&limit=3");
  const questions = await get("/rest/v1/questions?select=id&status=eq.active&limit=8");
  console.log(`discovery: market=${markets[0]?.id ? "found" : "MISSING"} curriculum=${curricula[0]?.id ? "found" : "MISSING"} indicator nodes=${nodes.length}/3 questions=${questions.length}/8`);
  if (!markets[0] || !curricula[0] || nodes.length < 3 || questions.length < 8) throw new Error("branch lacks the reference data the dataset needs (market, curriculum, 3 indicators, 8 questions)");
  return { market: markets[0].id as string, curriculum: curricula[0].id as string, nodes: nodes as Array<{ id: string; code: string; title: string }>, questions: (questions as Array<{ id: string }>).map((q) => q.id) };
}

function credentials() {
  const file = ".env.gate2.local", existing = existsSync(file) ? parseEnv(file) : {};
  const out: Record<string, string> = {};
  for (const k of ["adminA", "adminB", "teacherA", "outsider"] as UserKey[]) {
    const key = k.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase();
    out[`GATE2_${key}_EMAIL`] = email(k); out[`GATE2_${key}_PASSWORD`] = existing[`GATE2_${key}_PASSWORD`] ?? randomBytes(18).toString("base64url");
  }
  return { file, out };
}

async function seed() {
  const ref = await discover();
  if (!apply) { console.log(`dry run only. would create ${Object.keys(USERS).length} users, 2 schools, ${Object.keys(CLASSES).length} classes, ${GRADES.length} grade rows. Re-run with --apply.`); return; }
  const { file, out } = credentials();
  writeFileSync(file, `# Gate 2 staging identities (preview branch ${BRANCH} only). Generated; not committed.\nGATE2_SUPABASE_URL=${BASE}\nGATE2_ANON_KEY=${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}\n` + Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

  // 1. Auth users (learners get throwaway passwords nobody needs).
  for (const [k, u] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
    const envKey = `GATE2_${k.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}_PASSWORD`;
    const password = out[envKey] ?? randomBytes(18).toString("base64url");
    const made = await http("POST", "/auth/v1/admin/users", { id: userIds[k], email: email(k), password, email_confirm: true, user_metadata: { full_name: u.name, gate2: true } });
    if (!made.ok) {
      if (!/already|exists|registered/i.test(JSON.stringify(made.json))) { console.error("FAIL auth user", k, made.status, JSON.stringify(made.json).slice(0, 300)); throw new Error("auth"); }
      if (out[envKey]) await must(`reset password ${k}`, http("PUT", `/auth/v1/admin/users/${userIds[k]}`, { password }));
    }
  }
  console.log(`ok   auth users: ${Object.keys(USERS).length}`);

  // 2. Profiles, market membership, role profiles.
  const profiles = (Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>).map(([k, u]) => ({ id: userIds[k], role: u.role, full_name: u.name, email: email(k), status: "active", country: "Ghana", onboarding_completed_at: daysAgo(30), default_market_id: ref.market, primary_market_id: ref.market }));
  await upsert("profiles", profiles);
  await upsert("user_market_memberships", profiles.map((p) => ({ user_id: p.id, market_id: ref.market, active: true })), "user_id,market_id");
  const students = (Object.keys(USERS) as UserKey[]).filter((k) => USERS[k].role === "student");
  await upsert("student_profiles", students.map((k) => ({ id: spId(k), user_id: userIds[k], subjects: [] })));
  const teachers = (["teacherA", "adminB"] as UserKey[]);
  await upsert("teacher_profiles", teachers.map((k) => ({ id: tpId(k), user_id: userIds[k], school_name: SCHOOLS[USERS[k].school as "A" | "B"].name, subjects: [], grade_codes: [], education_levels: [] })));
  console.log("ok   profiles, student/teacher profiles");

  // 3. Schools and memberships.
  await upsert("institutions", Object.values(SCHOOLS).map((s) => ({ id: s.id, name: s.name })));
  const members = (Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>).filter(([, u]) => "institutionRole" in u && u.institutionRole).map(([k, u]) => ({ id: gid(`member-${k}`), institution_id: SCHOOLS[u.school as "A" | "B"].id, user_id: userIds[k], role: u.institutionRole, status: "active" }));
  await upsert("institution_memberships", members);
  console.log("ok   institutions + memberships");

  // 4. Classes, rosters.
  const classRows = Object.entries(CLASSES).map(([k, c]) => ({ id: gid(`class-${k}`), class_name: c.name, grade_label: c.grade, grade_code: c.grade, join_code: `G2-${k.toUpperCase()}`, teacher_id: tpId(c.teacher), teacher_user_id: userIds[c.teacher], primary_teacher_id: tpId(c.teacher), institution_id: SCHOOLS[c.school].id, curriculum_id: ref.curriculum, status: "active", academic_year: "2026", term: "1" }));
  await upsert("classes", classRows);
  const roster = Object.entries(CLASSES).flatMap(([k, c]) => c.learners.map((l) => ({ id: gid(`membership-${k}-${l}`), class_id: gid(`class-${k}`), student_id: spId(l), student_user_id: userIds[l], student_email: email(l), student_name: USERS[l].name, status: "active", joined_at: daysAgo(20) })));
  await upsert("class_memberships", roster);
  console.log(`ok   classes ${classRows.length}, memberships ${roster.length}`);

  // 5. Assessments, assignments, targets.
  await upsert("assessments", Object.entries(ASSIGNMENTS).map(([k, a]) => ({ id: gid(`assessment-${k}`), owner_role: "teacher", owner_user_id: userIds[CLASSES[a.cls].teacher], subject_code: a.subject[0], subject_name: a.subject[1], question_count: 5 })));
  await upsert("assignments", Object.entries(ASSIGNMENTS).map(([k, a]) => ({ id: gid(`assignment-${k}`), assessment_id: gid(`assessment-${k}`), class_id: gid(`class-${a.cls}`), teacher_id: tpId(CLASSES[a.cls].teacher), teacher_user_id: userIds[CLASSES[a.cls].teacher], subject_code: a.subject[0], subject_name: a.subject[1], grade: CLASSES[a.cls].grade, title: a.title, question_count: 5, curriculum_node_ids: [], status: "published", published_at: daysAgo(14), due_at: new Date(Date.now() + a.dueDays * 864e5).toISOString() })));
  await upsert("assignment_targets", Object.entries(ASSIGNMENTS).flatMap(([k, a]) => a.targets.map((l) => ({ id: gid(`target-${k}-${l}`), assignment_id: gid(`assignment-${k}`), class_id: gid(`class-${a.cls}`), student_id: spId(l), membership_id: gid(`membership-${a.cls}-${l}`), status: "active" }))));
  console.log("ok   assessments, assignments, targets");

  // 6. Attempts + gradebook rows (one attempt per grade row).
  const gradeRows = GRADES.map((g, i) => ({ g, i, attempt: gid(`attempt-grade-${i}`) }));
  await upsert("attempts", gradeRows.map(({ g, attempt }) => ({ id: attempt, assessment_id: gid(`assessment-${g.asg}`), assignment_id: gid(`assignment-${g.asg}`), class_id: gid(`class-${g.cls}`), student_id: spId(g.learner), student_user_id: userIds[g.learner], status: "submitted", started_at: daysAgo(g.daysAgo + 1) })));
  await upsert("gradebook", gradeRows.map(({ g, i, attempt }) => ({ id: gid(`grade-${i}`), result_id: gid(`result-${i}`), assessment_id: gid(`assessment-${g.asg}`), attempt_id: attempt, assignment_id: gid(`assignment-${g.asg}`), class_id: gid(`class-${g.cls}`), student_id: spId(g.learner), student_user_id: userIds[g.learner], student_email: email(g.learner), student_name: USERS[g.learner].name, score: g.pct / 10, total_marks: 10, percentage: g.pct, status: g.status, graded_at: daysAgo(g.daysAgo) })));
  console.log(`ok   attempts + gradebook ${gradeRows.length}`);

  // 7. Learning evidence: one attempt per (learner, indicator); one response + event per question.
  const classOf = (l: UserKey) => (Object.entries(CLASSES).find(([, c]) => (c.learners as UserKey[]).includes(l)) ?? [])[0] as string;
  const plan = ([["x", ref.nodes[0].id], ["y", ref.nodes[1].id], ["z", ref.nodes[2].id]] as const).flatMap(([key, node]) => {
    const e = EVIDENCE[key]; let correctLeft = e.correct;
    return e.learners.map((l, li) => {
      const correctHere = key === "y" ? [2, 2, 2, 1, 1][li] : Math.min(correctLeft, e.perLearner); correctLeft -= correctHere;
      return { key, node, learner: l, attempt: gid(`attempt-ev-${key}-${l}`), correct: correctHere, count: e.perLearner };
    });
  });
  await upsert("attempts", plan.map((p) => ({ id: p.attempt, assessment_id: gid("assessment-mathDue"), class_id: gid(`class-${classOf(p.learner)}`), student_id: spId(p.learner), student_user_id: userIds[p.learner], status: "submitted", started_at: daysAgo(5) })));
  const responses = plan.flatMap((p) => Array.from({ length: p.count }, (_, n) => ({ id: gid(`response-${p.key}-${p.learner}-${n}`), attempt_id: p.attempt, question_id: ref.questions[n], is_correct: n < p.correct, answered_at: daysAgo(4) })));
  await upsert("responses", responses);
  await upsert("learning_events", plan.flatMap((p) => Array.from({ length: p.count }, (_, n) => ({ id: gid(`event-${p.key}-${p.learner}-${n}`), student_user_id: userIds[p.learner], class_id: gid(`class-${classOf(p.learner)}`), attempt_id: p.attempt, response_id: gid(`response-${p.key}-${p.learner}-${n}`), question_id: ref.questions[n], curriculum_node_id: p.node, mode: "ASSESSMENT", is_correct: n < p.correct }))));
  console.log(`ok   evidence: ${plan.length} attempts, ${responses.length} responses/events`);
  writeFileSync(".gate2-nodes.json", JSON.stringify({ x: ref.nodes[0], y: ref.nodes[1], z: ref.nodes[2] }, null, 2));
  console.log("seed complete. credentials: .env.gate2.local (not printed)");
}

async function remove() {
  const ids = (prefix: string, keys: string[]) => keys.map((k) => gid(`${prefix}-${k}`));
  const attempts = [...GRADES.map((_, i) => gid(`attempt-grade-${i}`)), ...(["x", "y", "z"] as const).flatMap((key) => EVIDENCE[key].learners.map((l) => gid(`attempt-ev-${key}-${l}`)))];
  const users = Object.keys(USERS).map((k) => userIds[k as UserKey]);
  const del = async (table: string, filter: string) => { const r = await http("DELETE", `/rest/v1/${table}?${filter}`, undefined, { Prefer: "return=minimal" }); console.log(`${r.ok ? "ok  " : "warn"} delete ${table}${r.ok ? "" : ` HTTP ${r.status}`}`); };
  await del("learning_events", `attempt_id=${inList(attempts)}`);
  await del("responses", `attempt_id=${inList(attempts)}`);
  await del("gradebook", `attempt_id=${inList(attempts)}`);
  await del("attempts", `id=${inList(attempts)}`);
  await del("assignment_targets", `class_id=${inList(Object.keys(CLASSES).map((k) => gid(`class-${k}`)))}`);
  await del("assignments", `id=${inList(ids("assignment", Object.keys(ASSIGNMENTS)))}`);
  await del("assessments", `id=${inList(ids("assessment", Object.keys(ASSIGNMENTS)))}`);
  await del("class_memberships", `class_id=${inList(Object.keys(CLASSES).map((k) => gid(`class-${k}`)))}`);
  await del("classes", `id=${inList(Object.keys(CLASSES).map((k) => gid(`class-${k}`)))}`);
  await del("institution_memberships", `institution_id=${inList(Object.values(SCHOOLS).map((s) => s.id))}`);
  await del("institutions", `id=${inList(Object.values(SCHOOLS).map((s) => s.id))}`);
  await del("mastery_records", `student_user_id=${inList(users)}`);
  await del("user_market_memberships", `user_id=${inList(users)}`);
  await del("student_profiles", `user_id=${inList(users)}`);
  await del("teacher_profiles", `user_id=${inList(users)}`);
  await del("profiles", `id=${inList(users)}`);
  for (const id of users) await http("DELETE", `/auth/v1/admin/users/${id}`);
  console.log("cleanup finished (auth users deleted)");
}

(cleanup ? remove() : seed()).catch((e) => { console.error(String(e)); process.exitCode = 1; });
