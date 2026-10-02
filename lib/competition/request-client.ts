import { createClient } from "@supabase/supabase-js";
import { sponsorEngineEnabled } from "./local-gate";

export async function sponsorRequestClient(request: Request) {
  if (!sponsorEngineEnabled(process.env)) throw new Error("SPONSOR_ENGINE_DISABLED");
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new Error("AUTH_REQUIRED");
  return client;
}
export function sponsorError(error: unknown) {
  const message = error instanceof Error ? error.message : "SPONSOR_REQUEST_FAILED";
  const safe = /^[A-Z][A-Z0-9_]{2,100}$/.test(message) ? message : "SPONSOR_REQUEST_FAILED";
  return Response.json({ error: safe }, { status: safe === "SPONSOR_ENGINE_DISABLED" ? 404 : safe === "AUTH_REQUIRED" ? 401 : /DENIED|REQUIRED/.test(safe) ? 403 : 400 });
}
export async function boundedRequest(request: Request, max: number) {
  const reader = request.body?.getReader(); if (!reader) throw new Error("EMPTY_REQUEST");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > max) { await reader.cancel(); throw new Error("REQUEST_TOO_LARGE"); } chunks.push(chunk.value); }
  return Buffer.concat(chunks);
}
