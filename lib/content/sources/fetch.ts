import { createHash, randomUUID } from "node:crypto";
import { pdfPages } from "../../pdf";

// Server-side fetch of official curriculum PDFs. Only hosts configured as the authority's official domains are
// contacted (checked again on every redirect); bodies are size-capped and must be real PDFs. Nothing is approved here.
export const SOURCE_FETCH_MAX_BYTES = 50 * 1024 * 1024;
export type SourceRpc = <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
export type ClaimedSource = { id: string; token: string; url: string; title: string; market_id: string; official_domains: string[] };
export type SourceStore = (path: string, bytes: Buffer) => Promise<void>;

export function officialHost(url: string, domains: string[]) {
  let parsed: URL; try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return false;
  const host = parsed.hostname.toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export async function fetchOfficialPdf(url: string, domains: string[], request: typeof fetch = fetch): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!officialHost(current, domains)) throw new Error("HOST_NOT_OFFICIAL");
    const response = await request(current, { redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "QuizBox-CurriculumSources/1.0", Accept: "application/pdf" } });
    if (response.status >= 300 && response.status < 400) { const next = response.headers.get("location"); if (!next) throw new Error("FETCH_REDIRECT_INVALID"); current = new URL(next, current).toString(); continue; }
    if (response.status === 404) throw new Error("PDF_NOT_FOUND");
    if (!response.ok) throw new Error("FETCH_FAILED");
    const declared = Number(response.headers.get("content-length") ?? 0); if (declared > SOURCE_FETCH_MAX_BYTES) throw new Error("SOURCE_TOO_LARGE");
    const reader = response.body?.getReader(); if (!reader) throw new Error("FETCH_FAILED");
    const parts: Uint8Array[] = []; let size = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > SOURCE_FETCH_MAX_BYTES) { await reader.cancel(); throw new Error("SOURCE_TOO_LARGE"); } parts.push(chunk.value); }
    const bytes = Buffer.concat(parts);
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("NOT_A_PDF");
    return bytes;
  }
  throw new Error("FETCH_TOO_MANY_REDIRECTS");
}

export async function extractPdfText(bytes: Buffer) {
  const pages = await pdfPages(bytes);
  return { text: pages.map((p) => p.text).join("\n\n").slice(0, 3_000_000), pages: pages.length };
}

const code = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message) ? error.message : "FETCH_FAILED";

// One bounded execution: claim up to `limit` verified official PDFs and run each through fetch -> hash -> store -> extract.
export async function fetchClaimedSources(rpc: SourceRpc, store: SourceStore, filter: { market_id?: string; job_id?: string; limit?: number }, request: typeof fetch = fetch) {
  const claimed = await rpc<ClaimedSource[]>("qb_curriculum_sources", { p_action: "claim_fetch", p_data: filter });
  const outcomes: Array<{ id: string; title: string; status: string; error?: string; pages?: number }> = [];
  for (const source of claimed) {
    try {
      const bytes = await fetchOfficialPdf(source.url, source.official_domains, request);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const { text, pages } = await extractPdfText(bytes);
      if (text.replace(/\s+/g, "").length < 200) throw new Error("EXTRACTION_EMPTY");
      const path = `${source.market_id}/${randomUUID()}.pdf`;
      await store(path, bytes);
      const done = await rpc<{ status: string }>("qb_curriculum_sources", { p_action: "finish_fetch", p_data: { id: source.id, token: source.token, sha256, bytes: bytes.length, pages, storage_path: path, text } });
      outcomes.push({ id: source.id, title: source.title, status: done.status, pages });
    } catch (error) {
      const failure = code(error);
      await rpc("qb_curriculum_sources", { p_action: "fail_fetch", p_data: { id: source.id, token: source.token, error_code: failure } }).catch(() => undefined);
      outcomes.push({ id: source.id, title: source.title, status: "FETCH_FAILED", error: failure });
    }
  }
  return { claimed: claimed.length, outcomes };
}
