// Local-only fake Supabase for visual QA: serves deterministic fixtures for auth, PostgREST tables and RPCs.
// Never forwards anything; the app is pointed here via NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<port>.
import { createServer, type Server } from "node:http";

// A route may need interaction before it is measured (drill into a tree, answer a question, move a stepper).
export type QaStep = { clickText: string } | { click: string } | { select: string; value: string } | { fill: string; value: string } | { wait: number };
export type QaRoute = { path: string; label: string; steps?: QaStep[] };

export type QaFixture = {
  role: string;
  user: { id: string; email: string };
  tables: Record<string, unknown[]>;
  rpc: Record<string, (args: any) => unknown>;
  routes: Array<string | QaRoute>;
};

// PostgREST-style filters used by the app: eq, neq, is.null, not.is.null, in.(..). Anything else (ilike, or, order) is ignored.
export function filterRows(rows: any[], params: URLSearchParams) {
  const skip = new Set(["select", "order", "limit", "offset", "or", "and"]);
  return rows.filter((row) => [...params.entries()].every(([key, value]) => {
    if (skip.has(key)) return true;
    const cell = row[key];
    if (value.startsWith("eq.")) return String(cell) === value.slice(3);
    if (value.startsWith("neq.")) return String(cell) !== value.slice(4);
    if (value === "is.null") return cell == null;
    if (value === "not.is.null") return cell != null;
    if (value.startsWith("in.(")) return value.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(cell));
    return true;
  }));
}

export const FIXTURE_PORT = 54399;
export const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;

export type FixtureServer = { server: Server; unhandled: string[]; mutations: string[]; close: () => Promise<void> };

export async function startFixtureServer(fixture: QaFixture, origin: string): Promise<FixtureServer> {
  const unhandled: string[] = [], mutations: string[] = [];
  const authUser = { id: fixture.user.id, aud: "authenticated", role: "authenticated", email: fixture.user.email, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "*, authorization, apikey, content-type, prefer, accept-profile, content-profile, x-client-info");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS");
    response.setHeader("Access-Control-Expose-Headers", "Content-Range");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const url = new URL(request.url ?? "/", FIXTURE_URL);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => { response.writeHead(status, { "Content-Type": "application/json", ...headers }); response.end(JSON.stringify(body)); };

    if (url.pathname === "/auth/v1/user") return send(200, authUser);
    if (url.pathname === "/auth/v1/token") return send(200, { access_token: "qa", refresh_token: "qa", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: authUser });
    if (url.pathname === "/auth/v1/logout") { response.writeHead(204); response.end(); return; }

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([\w]+)$/);
    if (rpc) {
      const handler = fixture.rpc[rpc[1]];
      if (!handler) { unhandled.push(`rpc ${rpc[1]}`); return send(404, { code: "PGRST202", message: `QA fixture has no rpc ${rpc[1]}` }); }
      let args: any = {}; try { args = raw ? JSON.parse(raw) : {}; } catch { /* empty */ }
      try { return send(200, handler(args) ?? null); } catch (error) { return send(400, { code: "P0001", message: (error as Error).message }); }
    }
    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (table) {
      if (request.method !== "GET" && request.method !== "HEAD") { mutations.push(`${request.method} ${table[1]}`); return send(200, []); }
      const rows = fixture.tables[table[1]];
      if (!rows) { unhandled.push(`table ${table[1]}`); return send(404, { code: "42P01", message: `QA fixture has no table ${table[1]}` }); }
      const matched = filterRows(rows, url.searchParams);
      const offset = Number(url.searchParams.get("offset") ?? 0), limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : matched.length;
      const page = matched.slice(offset, offset + limit);
      const headers = { "Content-Range": `${page.length ? offset : "*"}${page.length ? `-${offset + page.length - 1}` : ""}/${matched.length}` };
      if ((request.headers.accept ?? "").includes("vnd.pgrst.object")) {
        return page.length === 1 ? send(200, page[0], headers) : send(406, { code: "PGRST116", details: "The result contains 0 rows", message: "JSON object requested, multiple (or no) rows returned" });
      }
      return send(200, page, headers);
    }
    unhandled.push(`${request.method} ${url.pathname}`);
    send(404, { message: "QA fixture: unhandled" });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(FIXTURE_PORT, "127.0.0.1", resolve); });
  return { server, unhandled, mutations, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

export function sessionCookie(fixture: QaFixture) {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: fixture.user.id, aud: "authenticated", role: "authenticated", exp })}.qa`;
  const user = { id: fixture.user.id, aud: "authenticated", role: "authenticated", email: fixture.user.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  // @supabase/ssr 0.5 stores the session as "base64-" + base64url(JSON) under sb-<host label>-auth-token (host 127.0.0.1 -> "127").
  return { name: "sb-127-auth-token", value: "base64-" + b64({ access_token: jwt, refresh_token: "qa", token_type: "bearer", expires_in: 3600, expires_at: exp, user }) };
}
