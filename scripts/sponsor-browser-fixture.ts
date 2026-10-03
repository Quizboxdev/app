// Local-only browser acceptance infrastructure: real SQL/RPC persistence,
// mocked external Auth and storage, no hosted Supabase or paid inference.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDeliveryFixture } from "../lib/competition/fixtures/database";
import { SponsorRepository } from "../lib/competition/repository";
import { uploadSource, ingestSource, type SourceStorage } from "../lib/competition/ingestion";
import type { SupabaseClient } from "@supabase/supabase-js";

async function main() {
  if (!process.argv.includes("--local-only") || process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("LOCAL_FIXTURE_ONLY");
  const { db, market } = await createDeliveryFixture();
  const userId = "00000000-0000-4000-8000-000000000001";
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "demo@example.invalid", email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {} };
  const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 })).toString("base64url"), "isolated-fixture-only"].join(".");
  const session = { access_token: jwt, refresh_token: "isolated-fixture-only", token_type: "bearer", expires_in: 86400, user };
  const actor = async (id = userId) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
  await actor();
  const rpc = async (name: string, data: Record<string, unknown>) => {
    const allowed = ["qb_sponsor_workspace", "qb_list_content_markets", "qb_content_market_context", "qb_select_content_market", "qb_list_content_sources", "qb_sme_context"];
    if (!allowed.includes(name) || Object.keys(data).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error("FIXTURE_RPC_DENIED");
    const keys = Object.keys(data);
    return (await db.query<{ data: unknown }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) data`, keys.map(key => typeof data[key] === "object" && data[key] !== null && !Array.isArray(data[key]) ? JSON.stringify(data[key]) : data[key]))).rows[0].data;
  };
  const repository = new SponsorRepository({ async rpc(name: string, args: Record<string, unknown>) { try { return { data: await rpc(name, args), error: null }; } catch (cause) { return { data: null, error: { message: (cause as Error).message } }; } } } as unknown as Pick<SupabaseClient, "rpc">);
  const country = (await db.query<{ country_id: string }>("select country_id from markets where id=$1", [market])).rows[0].country_id;
  const sponsor = (await repository.createOrganization({ organization_name: "QuizBox Demo Sponsor", organization_type: "education", country_id: country, market_id: market, contact_name: "Demo", contact_email: "demo@example.invalid" })).sponsor_id;
  await actor("00000000-0000-4000-8000-000000000002"); await repository.call("sponsor_status", sponsor, { status: "active" }); await actor();
  const objects = new Map<string, Buffer>();
  const storage: SourceStorage = { async upload(_bucket, path, bytes) { objects.set(path, bytes); }, async download(_bucket, path) { const bytes = objects.get(path); if (!bytes) throw new Error("OBJECT_MISSING"); return bytes; } };
  let queue: Promise<unknown> = Promise.resolve();
  const server = createServer((request, response) => {
    queue = queue.catch(() => {}).then(async () => {
      response.setHeader("Access-Control-Allow-Origin", "http://localhost:3002"); response.setHeader("Access-Control-Allow-Headers", "*"); response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); response.setHeader("Content-Type", "application/json");
      if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
      const url = new URL(request.url ?? "/", "http://127.0.0.1:54329");
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > 1500000) throw new Error("FIXTURE_REQUEST_TOO_LARGE"); chunks.push(chunk); }
      try {
        if (url.pathname.startsWith("/storage/v1/object/")) {
          const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/".length)); const key = path.slice(path.indexOf("/") + 1);
          if (request.method === "POST") { objects.set(key, Buffer.concat(chunks)); response.end(JSON.stringify({ Key: path })); return; }
          const bytes = objects.get(key); if (!bytes) throw new Error("OBJECT_MISSING"); response.setHeader("Content-Type", "text/plain"); response.end(bytes); return;
        }
        const body = length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        let data: unknown;
        if (url.pathname === "/auth/v1/token") data = session;
        else if (url.pathname === "/auth/v1/user") data = user;
        else if (url.pathname === "/auth/v1/logout") data = {};
        else if (url.pathname === "/__fixture/state") { await db.exec("reset role"); data = (await db.query("select configuration,competition_id,revision from quizbox_competition.drafts order by created_at desc")).rows; }
        else if (url.pathname === "/__fixture/approve") {
          await actor("00000000-0000-4000-8000-000000000002"); await db.exec("reset role");
          const result = await db.query("update source_documents set validation_status='approved',approved_by=$1 where id in (select id from quizbox_competition.documents where competition_id=$2) and validation_status='review' returning id", ["00000000-0000-4000-8000-000000000002", body.competition]); data = result.rows;
        } else if (url.pathname === "/__fixture/source") {
          await actor(); const drafts = await repository.drafts(sponsor); const draft = drafts.find(d => d.competition_id === body.competition);
          if (!draft) throw new Error("FIXTURE_DRAFT_REQUIRED");
          const source = await uploadSource(repository, storage, { sponsor, competition: draft.competition_id, title: "Browser acceptance handbook", market, rightsConfirmed: true, mime: "text/plain", bytes: Buffer.from("Isolate power before maintenance. A safety switch disconnects power.") });
          await ingestSource(repository, storage, sponsor, draft.competition_id, source.id);
          await actor("00000000-0000-4000-8000-000000000002"); await db.exec("reset role"); await db.query("update source_documents set validation_status='approved',approved_by=$1 where id=$2", ["00000000-0000-4000-8000-000000000002", source.id]); data = { id: source.id };
        } else if (url.pathname === "/generate") {
          data = [{ id: randomUUID(), competitionId: body.input.competitionId, jobId: body.input.jobId, sourceDocumentId: body.chunks[0].documentId, sourceChunkId: body.chunks[0].id, stem: "Should power be isolated before maintenance?", options: ["True", "False"], correctAnswer: 0, explanation: "The handbook requires isolation.", difficulty: "easy", cognitiveLevel: "recall", subject: "Computing", curriculumId: null, educationLevel: "SHS", model: "fixture", status: "GENERATED", approvedVersionId: null }];
        } else if (url.pathname.startsWith("/rest/v1/rpc/")) { await actor(); data = await rpc(url.pathname.split("/").pop()!, body); }
        else if (url.pathname === "/rest/v1/profiles") { await actor(); await db.exec("reset role"); data = (await db.query("select * from profiles where id=$1", [userId])).rows[0]; }
        else if (url.pathname === "/rest/v1/marketplace_sellers") data = [];
        else { response.writeHead(404); data = { code: "FIXTURE_ENDPOINT_NOT_IMPLEMENTED", message: "FIXTURE_ENDPOINT_NOT_IMPLEMENTED" }; }
        response.end(JSON.stringify(data));
      } catch (cause) { response.writeHead(400); response.end(JSON.stringify({ code: "FIXTURE_RPC_ERROR", message: (cause as Error).message })); }
    }).catch(() => { if (!response.headersSent) response.writeHead(400); if (!response.writableEnded) response.end(JSON.stringify({ message: "FIXTURE_REQUEST_FAILED" })); });
  });
  await new Promise<void>(resolve => server.listen(54329, "127.0.0.1", resolve));
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3002"], { stdio: "inherit", windowsHide: true, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329", NEXT_PUBLIC_SUPABASE_ANON_KEY: "isolated-fixture-only", SUPABASE_SERVICE_ROLE_KEY: "", QUIZBOX_SPONSOR_ENGINE_ENABLED: "true", QUIZBOX_GENERATION_PROVIDER: "mock", QUIZBOX_GENERATION_MODEL: "fixture", QUIZBOX_GENERATION_ENDPOINT: "http://127.0.0.1:54329/generate", QUIZBOX_GENERATION_API_KEY: "" } });
  const stop = async () => { child.kill(); server.close(); await db.close(); };
  process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
  child.once("exit", () => { server.close(); void db.close(); });
  console.log("ISOLATED_BROWSER_FIXTURE http://localhost:3002/login (mock Auth; no hosted traffic)");
}
void main().catch(() => { console.error("LOCAL_BROWSER_FIXTURE_FAILED"); process.exitCode = 1; });
