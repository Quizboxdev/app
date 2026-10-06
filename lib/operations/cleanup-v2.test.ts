import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards for the production cleanup scripts (docs/uat). They are never run by tests; these checks keep the reviewed engine and the
// safety properties from drifting between the dry run and the execute script.
const read = (file: string) => readFileSync(file, "utf8").split("\r\n").join("\n");   // the SQL files are written with Windows line endings
const dry = read("docs/uat/production-cleanup-dry-run-v2.sql");
const exec = read("docs/uat/production-cleanup-v2.sql");

const slice = (from: string, to: string) => dry.slice(dry.indexOf(from), dry.indexOf(to));
const sets = dry.slice(dry.indexOf("-- >>> SETS BEGIN"), dry.indexOf("-- <<< SETS END") + "-- <<< SETS END".length);
const defs = slice("-- looser seed for assessments", "set transaction read only;").trimEnd() + "\n";
const run = slice("-- ------------------------------------------------------------ run the engine", "-- ------------------------------------------------------------ 2. proposals by table").trimEnd() + "\n";

describe("production-cleanup-v2.sql reuses the reviewed dry-run engine verbatim", () => {
  it("contains the dry-run's set definitions, engine definitions and engine run byte for byte", () => {
    expect(exec).toContain(sets);
    expect(exec).toContain(defs);
    expect(exec).toContain(run);
  });
  it("records the sha256 of exactly those slices in its header", () => {
    const digest = createHash("sha256").update(sets + defs + run).digest("hex");
    expect(exec).toContain(`sha256 of the concatenation = ${digest}`);
  });
});

describe("production-cleanup-v2.sql is reproducible from committed source", () => {
  const template = read("scripts/release/production-cleanup-v2.template.sql");
  const REVIEWED_ENGINE_SHA256 = "abfc43927d4a517f838e84fd61274ef5c4fb4aaed3b8ac9817a0fa231a2be6b5";
  it("equals template + the reviewed engine slices, exactly (the generator's assembly, re-stated)", () => {
    const digest = createHash("sha256").update(sets + defs + run).digest("hex");
    expect(digest).toBe(REVIEWED_ENGINE_SHA256);
    for (const placeholder of ["/*ENGINE_HASH*/", "/*SETS*/", "/*ENGINE_DEFS*/", "/*ENGINE_RUN*/", "/*VARIANT_NOTE*/\n", "/*FORCE_ROLLBACK*/", "/*END_OF_TRANSACTION*/\n"]) expect(template.split(placeholder).length - 1, placeholder).toBe(1);
    const header = `Engine slices copied verbatim from docs/uat/production-cleanup-dry-run-v2.sql (sets, definitions, run); sha256 of the concatenation = ${digest}`;
    const generated = template.replace("/*ENGINE_HASH*/", () => header).replace("/*SETS*/", () => sets).replace("/*ENGINE_DEFS*/", () => defs).replace("/*ENGINE_RUN*/", () => run)   // function replacers: the SQL contains $$ / $f$
      .replace("/*VARIANT_NOTE*/\n", () => "").replace("/*FORCE_ROLLBACK*/", () => "false").replace("/*END_OF_TRANSACTION*/\n", () => "commit;   -- reached only if every assertion above passed\n");
    expect(exec).toBe(generated);
    expect(readFileSync("docs/uat/production-cleanup-v2.sql", "utf8")).toBe(generated.split("\n").join("\r\n"));   // checked in with CRLF, like the generator writes it
  });
  it("derives the diagnostic variant from the same text: only the mode flag, a banner and the final statement differ", () => {
    const variant = read("docs/uat/production-cleanup-v2-diagnostic.sql");
    const normalised = variant
      .split("\n").filter((l) => !l.startsWith("-- *** DIAGNOSTIC VARIANT") && !l.startsWith("-- *** It is not the cleanup")).join("\n")
      .replace("insert into _diag_cfg values (true);", () => "insert into _diag_cfg values (false);")
      .replace(/do \$diag_end\$[\s\S]*?end \$diag_end\$;\n/, () => "commit;   -- reached only if every assertion above passed\n");
    expect(normalised).toBe(exec);
    expect(readFileSync("docs/uat/production-cleanup-v2-diagnostic.sql", "utf8")).toContain("\r\n");
  });
  it("is what scripts/release/build-cleanup-v2.py --check reports (skipped when python is unavailable)", () => {
    const py = ["python", "python3"].map((cmd) => spawnSync(cmd, ["scripts/release/build-cleanup-v2.py", "--check"], { encoding: "utf8" })).find((r) => !r.error);
    if (!py) return;
    expect(py.stdout + py.stderr).toContain("OK:");
    expect(py.status).toBe(0);
  });
  it("keeps the per-table pins and the aggregate in the template", () => {
    expect(template).toContain("('rows_proposed_for_deletion', 1154)");
    const pins = [...template.slice(template.indexOf("insert into _expect_table values")).split(";")[0].matchAll(/\('([a-z_]+\.[a-z_]+)', (\d+)\)/g)];
    expect(pins).toHaveLength(37);
    expect(pins.reduce((a, m) => a + Number(m[2]), 0)).toBe(1154);
  });
});

describe("market-discovery diagnostics (reporting only) and the always-rollback variant", () => {
  const variant = read("docs/uat/production-cleanup-v2-diagnostic.sql");
  const strip = (text: string) => text.replace(/--[^\n]*/g, "");
  const ex = strip(exec), va = strip(variant);
  it("exempts only admin.test from the test-market membership check and asserts its membership is kept", () => {
    for (const code of [ex, va]) {
      expect(code).toContain("um.user_id not in (select id from s_users_rm) and um.user_id not in (select id from auth.users where lower(email) = 'admin.test@quizbox.local'))::text, '0');");
      expect(code).toContain("perform pg_temp.assert_eq('post: admin.test retained test-market membership unchanged', (select count(*) from public.user_market_memberships um join auth.users u on u.id = um.user_id join public.markets m on m.id = um.market_id where lower(u.email) = 'admin.test@quizbox.local' and m.is_test and um.active)::text, '1');");
      expect(code.indexOf("post: admin.test retained test-market membership unchanged")).toBeGreaterThan(code.indexOf("post: active memberships of non-test users in retained test markets"));
      expect(code.indexOf("post: admin.test retained test-market membership unchanged")).toBeLessThan(code.indexOf("end $post$;"));
    }
  });
  it("the diagnostic variant can never commit", () => {
    expect(va).not.toMatch(/^\s*commit\s*;/im);
    expect(va).not.toMatch(/commit\s*;/i);
    expect(va).toContain("DIAGNOSTIC_ROLLBACK");
    expect(va).toContain("insert into _diag_cfg values (true);");
    expect(ex).toContain("insert into _diag_cfg values (false);");
    expect(variant.startsWith("-- ====")).toBe(true);
    expect(variant).toContain("DIAGNOSTIC VARIANT");
  });
  it("captures the market-discovery state immediately before the existing assertion, which is kept", () => {
    for (const code of [ex, va]) {
      const capture = code.indexOf("perform pg_temp.diag_snap('after');");
      const assertion = code.indexOf("perform pg_temp.assert_eq('post: test markets visible in ordinary market discovery (qb_signup_markets)',");
      expect(capture).toBeGreaterThan(-1);
      expect(assertion).toBeGreaterThan(capture);
      expect(code.slice(capture, assertion)).not.toMatch(/(insert\s+into|update|delete\s+from)\s+(public|auth|quizbox_[a-z_]+)\./i);   // between capture and assertion nothing but temp-table notes / the abort
      expect(code).toContain("(select count(*) from jsonb_array_elements(public.qb_signup_markets()) e where (e->>'market_id') is not null and (e->>'market_id')::uuid in (select id from public.markets where is_test))::text, '0');");
    }
    expect(ex).toContain("CLEANUP_ABORTED: post: test markets visible in ordinary market discovery (qb_signup_markets)");   // the real script still aborts, now with the diagnostics in the message
    expect(ex.indexOf("select pg_temp.diag_snap('before');")).toBeGreaterThan(ex.indexOf("select pg_temp.snap('before');"));
    expect(ex.indexOf("select pg_temp.diag_snap('before');")).toBeLessThan(ex.indexOf("do $del$"));
  });
  it("reports every requested item and touches no real table", () => {
    for (const item of ["signup_test_market_rows", "market_row", "country_row", "feature_flag_rows", "fp_markets", "fp_countries", "fp_feature_flags", "fp_qb_signup_markets_def", "pg_get_functiondef", "rows_changed_by_the_transaction",
      "'triggers'", "function_uses_dynamic_sql", "'foreign_keys'", "on_delete", "on_update", "functions_mentioning_feature_flags", "lateral_pick", "country_markets_before", "country_markets_after", "'iso2_code'", "'status'", "'country_id'", "to_jsonb(f)"]) expect(ex, item).toContain(item);
    const diagnostics = ex.slice(ex.indexOf("create temp table _diag_cfg"), ex.indexOf("-- rows anywhere in the database that reference admin.test"));
    expect(diagnostics).not.toMatch(/(update|delete\s+from|truncate|alter|drop)\s+(public|auth|quizbox_[a-z_]+)\./i);
    expect(diagnostics).not.toMatch(/insert\s+into\s+(public|auth|quizbox_[a-z_]+)\./i);
    expect(ex).not.toMatch(/insert\s+into\s+public\.feature_flags|TEST_MARKETS_VISIBLE'\s*,\s*true/i);   // the script never adds the flag
  });
});

describe("dry run v2 previews the auth revocation plan (read-only reporting)", () => {
  const section = dry.slice(dry.indexOf("AUTH REVOCATION PLAN preview"));
  const norm = (text: string) => text.replace(/\s+/g, " ").replace(/\(select a from ids\)::uuid\[\]/g, "$1").replace(/unnest\(\(select a from ids\)\)/g, "unnest($1)");
  const freeze = exec.slice(exec.indexOf("create function pg_temp.freeze_revocation()"), exec.indexOf("create function pg_temp.del_row"));
  it("uses the same matching rules as freeze_revocation() in the execute script", () => {
    const conds = [...freeze.matchAll(/\(\d, '(auth\.[a-z_]+)',\s+'([^']+)'\)/g)];
    expect(conds.map((m) => m[1])).toEqual(["auth.refresh_tokens", "auth.mfa_amr_claims", "auth.sessions", "auth.one_time_tokens"]);
    for (const [, table, cond] of conds) expect(norm(section), table).toContain(norm(`from ${table} c where ${cond}`));
    expect(dry).toContain("from _usr where not deletable");   // the retained removable test users
  });
  it("reports per-table counts, TOTAL and the three must-be-zero checks", () => {
    for (const item of ["'auth.sessions'", "'auth.refresh_tokens'", "'auth.one_time_tokens'", "'auth.mfa_amr_claims'", "'TOTAL'", "revocation rows belonging to admin.test (must be 0)", "revocation rows belonging to a genuine / non-retained user (must be 0)", "revocation rows referenced by an out-of-plan row (must be 0)"]) expect(section, item).toContain(item);
  });
  it("is not added to the fixed cleanup pins and does not alter the reviewed engine", () => {
    expect(exec.slice(exec.indexOf("insert into _expect_table values"), exec.indexOf("-- <<<", exec.indexOf("insert into _expect_table values")))).not.toMatch(/revoc/i);
    expect(dry.indexOf("AUTH REVOCATION PLAN preview")).toBeGreaterThan(dry.indexOf("-- ------------------------------------------------------------ 2. proposals by table"));
  });
});

describe("dry run v2 is read-only", () => {
  it("switches the transaction to READ ONLY before the engine runs and never commits", () => {
    expect(dry.indexOf("set transaction read only;")).toBeGreaterThan(-1);
    expect(dry.indexOf("set transaction read only;")).toBeLessThan(dry.indexOf("select pg_temp.seed("));
    expect(dry).not.toMatch(/^\s*commit\s*;/im);
    expect(dry).not.toMatch(/^[ \t]*(delete from|update|truncate|drop|alter)[ \t]+(?!_|pg_temp)/im);   // only temp working tables may be written
  });
});

describe("execute script safety properties", () => {
  const code = exec.replace(/--[^\n]*/g, "");
  it("is one transaction that commits only after the post assertions", () => {
    expect(code.match(/^\s*begin\s*;/gim)?.length).toBe(1);
    expect(code.match(/^\s*commit\s*;/gim)?.length).toBe(1);
    expect(code.indexOf("do $post$")).toBeGreaterThan(-1);
    expect(code.indexOf("do $post$")).toBeLessThan(code.search(/^\s*commit\s*;/im));
    expect(code.indexOf("do $pre$")).toBeLessThan(code.indexOf("do $del$"));   // all pre-flight assertions run before the first delete
  });
  it("never disables or alters triggers, RLS or replication role, and never truncates", () => {
    expect(code).not.toMatch(/disable\s+trigger/i);
    expect(code).not.toMatch(/enable\s+trigger/i);
    expect(code).not.toMatch(/session_replication_role/i);
    expect(code).not.toMatch(/(enable|disable|force|no\s+force)\s+row\s+level\s+security/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdrop\s+(trigger|policy|table|schema|function)\b(?![^;]*pg_temp)/i);
  });
  it("has no hard-coded delete from any immutable table, the audit tables, or admin.test", () => {
    for (const table of ["legacy_content_attributions", "content_contexts", "compensation_policy_versions", "sme_review_events", "reviewer_earnings", "reviewer_earning_states", "official_results", "participations", "registrations", "snapshots", "review_events", "candidate_history", "chunks", "audit_logs", "analytics_events", "admin_actions"]) {
      expect(code, table).not.toMatch(new RegExp(`delete\\s+from\\s+[\\w.]*${table}\\b`, "i"));
    }
    expect(code).not.toMatch(/delete\s+from\s+auth\.users/i);
  });
  it("deletes only through the two frozen sets, by primary key identity", () => {
    const deletes = (code.match(/delete\s+from[^;]*/gi) ?? []).map((d) => d.replace(/\s+/g, " "));
    // engine bookkeeping on its own working tables, the pk-addressed row deleter, and the frozen-set work lists: nothing else may delete anything
    const allowed = [/^delete from _c using doomed d where _c\.t = /i, /^delete from % without a primary key/i, /^delete from %s c using jsonb_populate_record\(null::%s, \$1\) j where %s/i, /^delete from _left where id = r\.id$/i, /^delete from _revoke_left where id = r\.id$/i];
    for (const statement of deletes) expect(allowed.some((re) => re.test(statement)), statement).toBe(true);
    expect(code).not.toMatch(/delete\s+from\s+(auth|public|quizbox_[a-z_]+)\./i);   // no hard-coded delete from any real table: sessions/tokens go through the frozen revocation set too
  });
  it("never addresses a destructive target by ctid and requires a primary key for every planned table", () => {
    expect(code).not.toMatch(/where\s+ctid/i);
    expect(code).not.toMatch(/ctid\s*=\s*%L/i);
    expect(code).not.toMatch(/create temp table _(plan|left|revoke|revoke_left)[^;]*tid/i);   // the frozen sets carry primary keys only
    const firstDelete = code.indexOf("do $del$");
    const outsideEngine = code.slice(code.indexOf("-- ------------------------------------------------------------ execute-only infrastructure"));
    // the engine's ctid is read only to translate its proposal into primary keys / pre-flight checks, all before the first DELETE
    for (const m of outsideEngine.matchAll(/ctid/g)) expect(code.indexOf(outsideEngine) + (m.index ?? 0)).toBeLessThan(firstDelete);
    expect(code).toContain("planned table % has no primary key");
    expect(code).toContain("planned tables without a primary key: %");
    expect(code).toContain("revocation table % has no primary key");
    expect(code).toContain("auth-revocation tables without a primary key: %");
    expect(code.indexOf("planned tables without a primary key: %")).toBeLessThan(firstDelete);
    expect(code.indexOf("select pg_temp.freeze_revocation();")).toBeLessThan(firstDelete);
  });
  it("aborts on unexpected counts, genuine links and collateral damage", () => {
    for (const marker of ["rows proposed for deletion", "closure self-check", "CLEANUP_ABORTED: rows disappeared", "immutable table % changed", "pre: plan rows in immutable", "pre: admin.test in the plan", "triggers fingerprint unchanged", "admin.test@quizbox.local rows byte-identical"]) expect(exec, marker).toContain(marker.replace("triggers fingerprint unchanged", "fingerprint unchanged"));
  });
  it("states the approved production expectations", () => {
    expect(exec).toContain("('rows_proposed_for_deletion', 1154)");
    expect(exec).toContain("('removable_users_retained', 11)");
    expect(exec).toContain("('fixture_attempts_retained_by_competition_history', 13)");
    expect(exec).toContain("('fixture_questions_retained', 43)");
  });
  it("pins the reviewed dry-run per table and rejects any unlisted table", () => {
    const block = exec.slice(exec.indexOf("insert into _expect_table values"), exec.indexOf("-- <<<", exec.indexOf("insert into _expect_table values")));
    const pins = new Map([...block.matchAll(/\('([a-z_]+\.[a-z_]+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])] as const));
    const reviewed: Record<string, number> = {
      "public.competitions": 1, "quizbox_competition.bank_items": 14, "quizbox_competition.drafts": 1, "quizbox_competition.leaderboard": 13, "quizbox_competition.organization_members": 2, "quizbox_competition.sponsor_organizations": 1,
      "public.sme_domain_assignments": 1, "public.sponsor_profiles": 1,
      "public.assessment_questions": 106, "public.assessment_results": 24, "public.assessments": 60, "public.assignment_question_versions": 106, "public.assignment_targets": 82, "public.assignments": 60, "public.attempts": 61,
      "public.class_memberships": 10, "public.classes": 7, "public.gradebook": 24, "public.learning_events": 71, "public.mastery_records": 5, "public.notifications": 94, "public.question_versions": 38, "public.responses": 77, "public.xp_transactions": 101,
      "auth.identities": 7, "auth.mfa_amr_claims": 44, "auth.refresh_tokens": 44, "auth.sessions": 44, "auth.users": 7,
      "public.institution_memberships": 2, "public.profiles": 7, "public.student_profiles": 3, "public.teacher_profiles": 3, "public.tenant_memberships": 9, "public.user_capabilities": 2, "public.user_market_memberships": 20, "public.marketplace_sellers": 2,
    };
    expect(Object.fromEntries(pins)).toEqual(reviewed);
    expect([...pins.values()].reduce((a, b) => a + b, 0)).toBe(1154);
    expect(code).toContain("(UNLISTED TABLE)");
    expect(code).toContain("per-table plan differs from the reviewed dry-run");
    expect(code).toContain("pre: no table outside the per-table pins is in the plan");
    expect(code).toContain("pre: per-table pins sum to the aggregate");
  });
  it("keeps the auth revocation plan separate from the reviewed cleanup plan and counts both in the collateral guard", () => {
    const frozen = code.indexOf("select pg_temp.freeze_revocation();");
    expect(frozen).toBeGreaterThan(-1);
    expect(frozen).toBeLessThan(code.indexOf("select pg_temp.snap('before');"));   // frozen before the before-snapshot
    expect(code.indexOf("do $prefrozen$")).toBeLessThan(code.indexOf("select pg_temp.snap('before');"));
    expect(code.indexOf("select pg_temp.snap('before');")).toBeLessThan(code.indexOf("do $del$"));
    expect(code).toContain("coalesce(p.planned, 0) + coalesce(rv.revoked, 0) as planned");   // cleanup deletes + revocation deletes, nothing more
    expect(code).toContain("CLEANUP PLAN: rows frozen for deletion (reviewed number)");
    expect(code).toContain("AUTH REVOCATION PLAN: rows frozen for deletion (separately authorised, not in the reviewed number)");
    expect(exec).toContain("AUTH REVOCATION PLAN (retained test accounts; separately authorised, NOT in the reviewed 1,154)");
    expect(code).toContain("pre: revocation rows that overlap the cleanup plan");
    expect(code).toContain("tables outside the revocation set reference session/token tables");
    const disable = code.slice(code.indexOf("do $disable$"), code.indexOf("end $disable$"));
    expect(disable).not.toMatch(/auth\.(sessions|one_time_tokens|refresh_tokens)/i);   // sessions/tokens are removed only through the frozen revocation set
    expect(code.indexOf("do $revoke$")).toBeGreaterThan(code.indexOf("do $disable$"));
    for (const check of ["post: revocation rows still present", "post: retained test users with a live session", "post: retained test users with a refresh token", "post: retained test users with a one-time token", "post: retained test users able to authenticate (not banned)"]) expect(code, check).toContain(check);
  });
  it("is marked as not yet authorised", () => {
    expect(exec).toContain("NOT YET AUTHORISED TO RUN");
  });
});

describe("superseded v1 scripts stay disabled", () => {
  it.each(["docs/uat/production-cleanup.sql", "docs/uat/production-cleanup-dry-run.sql"])("%s carries the SUPERSEDED banner", (file) => {
    expect(read(file).startsWith("-- !!! SUPERSEDED")).toBe(true);
  });
});
