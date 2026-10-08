import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Each case makes several round trips to the (sometimes slow) Preview database.
vi.setConfig({ testTimeout: 90_000 });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFixtureWorld, destroyFixtureWorld, previewSql, resolveTarget, type FixtureWorld } from "./live-fixture";

// Security regression for the anonymous login-failure telemetry path (migration 20261010110000). Abuse simulations run inside
// transactions that roll back, so they leave no rows. Only the end-to-end gateway test writes (two rows) and removes exactly those.
const asSource = (ip: string, calls: string) => `select set_config('request.headers','{"cf-connecting-ip":"${ip}"}',true); ${calls}`;
const call = (code: string, times: number) => Array.from({ length: times }, () => `select public.qb_auth_failure('${code}');`).join("\n");
const sourceOf = (ip: string) => `left(encode(extensions.digest('${ip}:'||current_date::text,'sha256'),'hex'),16)`;
const rowsFor = (ip: string) => `(select count(*) from public.system_events where event_type='AUTH_FAILURE' and details->>'source'=${sourceOf(ip)})`;
const lines = (out: string) => out.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^(COMMIT|ROLLBACK|BEGIN|WARNING|INSERT)/.test(line));
const lastLine = (out: string) => lines(out).slice(-1)[0];

describe.skipIf(process.env.QB_LIVE_ACCEPTANCE !== "1")("anonymous telemetry hardening (qb_auth_failure / system_events)", () => {
  let world: FixtureWorld, anon: SupabaseClient, admin: SupabaseClient;
  const started = new Date().toISOString();
  beforeAll(async () => {
    world = await createFixtureWorld({ roles: ["admin", "teacher"] });
    admin = await world.client("admin");
    const target = resolveTarget();
    anon = createClient(target.url, target.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }, 180_000);
  afterAll(async () => { if (world) await destroyFixtureWorld(world); }, 120_000);

  it("revokes every direct table privilege from anon and authenticated, keeping service_role", () => {
    const out = previewSql(`select (select count(*) from (values ('anon'),('authenticated')) r(r), (values ('select'),('insert'),('update'),('delete'),('truncate'),('references'),('trigger')) p(p) where has_table_privilege(r.r,'public.system_events',p.p))||','||has_table_privilege('service_role','public.system_events','select');`, { idempotent: true });
    expect(lastLine(out)).toBe("0,true");
  });
  it("denies direct reads and writes through the API for anon and for an authenticated user", async () => {
    for (const client of [anon, admin]) {
      expect((await client.from("system_events").select("id").limit(1)).error).not.toBeNull();
      expect((await client.from("system_events").insert({ event_type: "AUTH_FAILURE", entity_type: "auth", severity: "warn", details: {} })).error).not.toBeNull();
    }
  });
  it("still serves operational health to admins through the definer RPC", async () => {
    expect((await admin.rpc("qb_admin_operations_health")).error).toBeNull();
  });
  it("keeps the anonymous RPC path working end to end and stores only a constrained code", async () => {
    const count = () => Number(lastLine(previewSql(`select count(*) from public.system_events where event_type='AUTH_FAILURE';`, { idempotent: true })));
    const before = count();
    expect((await anon.rpc("qb_auth_failure", { p_code: "invalid_credentials" })).error).toBeNull();
    expect((await anon.rpc("qb_auth_failure", { p_code: "Jane Doe is a free text name" })).error).toBeNull();
    const rows = JSON.parse(lastLine(previewSql(`select coalesce(json_agg(details order by created_at),'[]') from (select details, created_at from public.system_events where event_type='AUTH_FAILURE' and created_at>='${started}' order by created_at desc limit 2) t;`, { idempotent: true })));
    expect(rows.map((r: any) => r.code).sort()).toEqual(["AUTH_FAILED", "invalid_credentials"]);
    expect(JSON.stringify(rows)).not.toMatch(/Jane|Doe|\d+\.\d+\.\d+\.\d+/);
    expect(rows.every((r: any) => /^[0-9a-f]{16}$/.test(r.source))).toBe(true);
    // remove exactly the rows this test wrote (this source, this window)
    previewSql(`delete from public.system_events where event_type='AUTH_FAILURE' and created_at>='${started}' and details->>'source'='${rows[0].source}';`, { idempotent: true });
    expect(count()).toBe(before);
  });
  it("constrains p_code to known Supabase codes (rolled-back simulation)", () => {
    const out = previewSql(`${asSource("198.51.100.10", `select public.qb_auth_failure('over_request_rate_limit'); select public.qb_auth_failure('<script>alert(1)</script>'); select public.qb_auth_failure(null);`)}
      select string_agg(details->>'code',',' order by created_at) from public.system_events where event_type='AUTH_FAILURE' and details->>'source'=${sourceOf("198.51.100.10")};
      rollback;`, { idempotent: true });
    expect(lastLine(out)).toBe("over_request_rate_limit,AUTH_FAILED,AUTH_FAILED");
  });
  it("caps a single source at 10 events per minute and never blinds other sources (rolled-back simulation)", () => {
    const out = previewSql(`${asSource("198.51.100.20", call("invalid_credentials", 40))}
      ${asSource("198.51.100.21", call("invalid_credentials", 1))}
      select ${rowsFor("198.51.100.20")}||','||${rowsFor("198.51.100.21")};
      rollback;`, { idempotent: true });
    expect(lastLine(out)).toBe("10,1");
  });
  it("keeps the global 120/minute backstop and stores only a digest of the source (rolled-back simulation)", () => {
    const sources = Array.from({ length: 14 }, (_, i) => `198.51.100.${100 + i}`);
    const out = previewSql(`${sources.map((ip) => asSource(ip, call("invalid_credentials", 10))).join("\n")}
      select (select count(*) from public.system_events where event_type='AUTH_FAILURE' and details->>'source' in (${sources.map((ip) => sourceOf(ip)).join(",")}))||','||(select count(*) from public.system_events where event_type='AUTH_FAILURE' and details::text ~ '198[.]51[.]100');
      rollback;`, { idempotent: true });
    const [total, leaked] = lastLine(out).split(",").map(Number);
    expect(total).toBeLessThanOrEqual(120);
    expect(total).toBeGreaterThan(0);
    expect(leaked).toBe(0);
  });
  it("purges only expired AUTH_FAILURE rows, in bounded batches (rolled-back simulation)", () => {
    const out = lines(previewSql(`insert into public.system_events(event_type,entity_type,severity,details,created_at)
        select 'AUTH_FAILURE','auth','warn','{"code":"AUTH_FAILED","source":"qbrunpurge00000"}'::jsonb, now()-interval '40 days'-(g||' seconds')::interval from generate_series(1,5) g;
      insert into public.system_events(event_type,entity_type,severity,details,created_at) values('AUTH_FAILURE','auth','warn','{"code":"AUTH_FAILED","source":"qbrunpurge00001"}'::jsonb, now()-interval '1 day');
      insert into public.system_events(event_type,entity_type,severity,details,created_at) values('SOMETHING_ELSE','x','info','{"source":"qbrunpurge00002"}'::jsonb, now()-interval '90 days');
      select quizbox_private.purge_auth_failures(interval '30 days', 2);
      select (select count(*) from public.system_events where details->>'source'='qbrunpurge00000')||','||(select count(*) from public.system_events where details->>'source'='qbrunpurge00001')||','||(select count(*) from public.system_events where details->>'source'='qbrunpurge00002');
      rollback;`, { idempotent: true }));
    expect(out[0]).toBe("2"); // exactly one bounded batch removed
    expect(out[1]).toBe("3,1,1"); // 3 expired rows left, the recent AUTH_FAILURE kept, other event types untouched
  });
  it("keeps the helper objects private and the function grants unchanged", () => {
    const out = previewSql(`select has_function_privilege('anon','public.qb_auth_failure(text)','execute')||','||has_function_privilege('authenticated','public.qb_auth_failure(text)','execute')||','||has_function_privilege('anon','quizbox_private.purge_auth_failures(interval,integer)','execute')||','||has_table_privilege('anon','quizbox_private.auth_failure_budget','select');`, { idempotent: true });
    expect(lastLine(out)).toBe("true,true,false,false");
  });
  it("teardown leaves zero rows from the run", async () => { expect((await destroyFixtureWorld(world)).total).toBe(0); }, 120_000);
});
