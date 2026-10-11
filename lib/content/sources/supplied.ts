import { createHash, randomUUID } from "node:crypto";
import { extractPdfText, SOURCE_FETCH_MAX_BYTES, type SourceRpc, type SourceStore } from "./fetch";

// A Super Admin supplies the official PDF for one registry row (the server fetch could not reach the official host). The file is
// checked, fingerprinted and recorded through the same claim and finish_fetch steps as a fetched file, so it ends in NEEDS_REVIEW and
// the normal review, rights attestation and activation still apply. Nothing is approved here.
export type SuppliedOutcome = { id: string; title: string; status: string; sha256: string; pages: number };
type Extract = (bytes: Buffer) => Promise<{ text: string; pages: number }>;

// storedPath: the file was already placed in the bucket by the browser (files over the request limit); it is read back and verified here,
// and recorded under that same path. The SQL step checks the path belongs to the row's market.
export async function acceptSuppliedPdf(rpc: SourceRpc, store: SourceStore, registryId: string, bytes: Buffer, extract: Extract = extractPdfText, options: { storedPath?: string } = {}): Promise<SuppliedOutcome> {
  if (bytes.length === 0) throw new Error("EMPTY_REQUEST");
  if (bytes.length > SOURCE_FETCH_MAX_BYTES) throw new Error("SOURCE_TOO_LARGE");
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("NOT_A_PDF");
  // Read the file before claiming the row, so an unreadable file never touches the registry.
  const { text, pages } = await extract(bytes);
  if (text.replace(/\s+/g, "").length < 200) throw new Error("EXTRACTION_EMPTY");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const claim = await rpc<{ id: string; token: string; title: string; market_id: string }>("qb_source_claim_file", { p_id: registryId });
  try {
    const path = options.storedPath ?? `${claim.market_id}/${randomUUID()}.pdf`;
    if (!options.storedPath) await store(path, bytes);
    const done = await rpc<{ status: string }>("qb_curriculum_sources", { p_action: "finish_fetch", p_data: { id: claim.id, token: claim.token, sha256, bytes: bytes.length, pages, storage_path: path, text } });
    return { id: claim.id, title: claim.title, status: done.status, sha256, pages };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message) ? error.message : "FETCH_FAILED";
    await rpc("qb_curriculum_sources", { p_action: "fail_fetch", p_data: { id: claim.id, token: claim.token, error_code: code } }).catch(() => undefined);
    throw new Error(code);
  }
}
