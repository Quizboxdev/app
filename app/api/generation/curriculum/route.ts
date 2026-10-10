import { boundedRequest } from "@/lib/competition/request-client";
import { authorizeCaller, generateCurriculum, MAX_PROMPT_CHARS } from "@/lib/generation/adapter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Content Factory's generation endpoint (QUIZBOX_GENERATION_ENDPOINT). Protected by a shared secret, not a user session:
// only the factory run route calls it, server to server. See lib/generation/adapter.ts.
export async function POST(request: Request) {
  try {
    authorizeCaller(request.headers.get("authorization"), process.env);
    const body = JSON.parse((await boundedRequest(request, MAX_PROMPT_CHARS + 20_000)).toString("utf8"));
    return Response.json(await generateCurriculum(process.env, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : "GENERATION_FAILED";
    return Response.json({ error: code }, { status: code === "AUTH_REQUIRED" ? 401 : code === "GENERATION_PROVIDER_RATE_LIMITED" ? 429 : code.startsWith("INVALID_") ? 400 : 502 });
  }
}
