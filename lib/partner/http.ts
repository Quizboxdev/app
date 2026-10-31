import type { NextResponse } from "next/server";
import { errorResponse } from "./errors";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isRef = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 200 && !/[\u0000-\u001f]/.test(v);

// Reads a small JSON body with a hard size limit. Returns the raw text too, because signed requests need the exact bytes.
export async function readJsonBody(req: Request, maxBytes: number): Promise<{ ok: true; raw: string; json: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false, response: errorResponse("UNSUPPORTED_MEDIA_TYPE") };
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, response: errorResponse("PAYLOAD_TOO_LARGE") };
  const raw = await req.text();
  if (Buffer.byteLength(raw) > maxBytes) return { ok: false, response: errorResponse("PAYLOAD_TOO_LARGE") };
  try {
    const json = JSON.parse(raw);
    if (json === null || typeof json !== "object" || Array.isArray(json)) return { ok: false, response: errorResponse("INVALID_REQUEST") };
    return { ok: true, raw, json };
  } catch { return { ok: false, response: errorResponse("INVALID_REQUEST") }; }
}

// Reads the raw text of a signed request (size-limited) without parsing it, so the signature can be checked before any parsing.
export async function readRawBody(req: Request, maxBytes: number): Promise<{ ok: true; raw: string } | { ok: false; response: NextResponse }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false, response: errorResponse("UNSUPPORTED_MEDIA_TYPE") };
  if (Number(req.headers.get("content-length") ?? "0") > maxBytes) return { ok: false, response: errorResponse("PAYLOAD_TOO_LARGE") };
  const raw = await req.text();
  if (Buffer.byteLength(raw) > maxBytes) return { ok: false, response: errorResponse("PAYLOAD_TOO_LARGE") };
  return { ok: true, raw };
}
