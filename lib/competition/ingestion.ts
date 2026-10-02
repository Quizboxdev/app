import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { chunkExtract, type Chunk } from "./lifecycle";
import type { SponsorRepository } from "./repository";

export const SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const mimes = new Set(["text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
export type Extractor = (bytes: Buffer, mime: string) => Promise<Array<{ text: string; page: number | null; chapter: string | null; section: string | null; heading: string | null }>>;
export const extractSource: Extractor = async (bytes, mime) => {
  if (!bytes.length || bytes.length > SOURCE_MAX_BYTES || !mimes.has(mime)) throw new Error("INVALID_SOURCE_UPLOAD");
  if (mime === "application/pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("INVALID_PDF_SIGNATURE");
    const parser = new PDFParse({ data: bytes });
    try { const result = await parser.getText(); return result.pages.map(page => ({ text: page.text, page: page.num, chapter: null, section: null, heading: null })); }
    finally { await parser.destroy(); }
  }
  if (mime.includes("wordprocessingml")) {
    if (!bytes.subarray(0, 2).equals(Buffer.from("PK"))) throw new Error("INVALID_DOCX_SIGNATURE");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return [{ text: result.value, page: null, chapter: null, section: null, heading: null }];
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("INVALID_TEXT_SOURCE");
  return [{ text, page: null, chapter: null, section: null, heading: null }];
};
export interface SourceStorage {
  upload(bucket: string, path: string, bytes: Buffer, mime: string): Promise<void>;
  download(bucket: string, path: string): Promise<Buffer>;
}
export async function uploadSource(repository: SponsorRepository, storage: SourceStorage, args: { sponsor: string; competition: string; document?: string; title: string; market: string | null; rightsConfirmed: boolean; mime: string; bytes: Buffer }) {
  if (!args.rightsConfirmed || !args.title.trim() || !args.bytes.length || args.bytes.length > SOURCE_MAX_BYTES || !mimes.has(args.mime)) throw new Error("INVALID_SOURCE_UPLOAD");
  // Registration is authorized in SQL before bytes can be written to storage.
  const checksum = createHash("sha256").update(args.bytes).digest("hex");
  let source: { id: string; bucket: string; path: string };
  if (args.document) {
    const existing = await repository.source(args.sponsor, args.competition, args.document);
    if (existing.checksum !== checksum || existing.mime_type !== args.mime) throw new Error("SOURCE_UPLOAD_RETRY_MISMATCH");
    source = await repository.call("retry_upload", args.sponsor, { competition_id: args.competition, document_id: args.document });
  } else source = await repository.registerSource(args.sponsor, args.competition, { title: args.title, market_id: args.market, mime_type: args.mime, rights_confirmed: true, checksum });
  try { await storage.upload(source.bucket, source.path, args.bytes, args.mime); }
  catch (error) {
    // A storage write may succeed even when its response is lost. Verify it;
    // never replace immutable source bytes just to retry a network response.
    const stored = await storage.download(source.bucket, source.path).catch(() => null);
    if (!stored || createHash("sha256").update(stored).digest("hex") !== checksum) {
      await repository.call("fail_upload", args.sponsor, { competition_id: args.competition, document_id: source.id });
      throw error;
    }
  }
  return source;
}
export async function ingestSource(repository: SponsorRepository, storage: SourceStorage, sponsor: string, competition: string, document: string, extractor: Extractor = extractSource): Promise<Array<Chunk & { checksum: string }>> {
  const source = await repository.source(sponsor, competition, document);
  const claim = await repository.claimExtraction(sponsor, competition, document);
  try {
    const bytes = await storage.download(source.bucket, source.path);
    if (createHash("sha256").update(bytes).digest("hex") !== source.checksum) throw new Error("SOURCE_CHECKSUM_MISMATCH");
    const sections = await extractor(bytes, source.mime_type);
    if (sections.reduce((n, s) => n + s.text.length, 0) > 1_000_000) throw new Error("SOURCE_EXTRACT_TOO_LARGE");
    const chunks = chunkExtract(document, sections.filter(s => s.text.trim())).map(chunk => ({ ...chunk, checksum: createHash("sha256").update(chunk.text).digest("hex") }));
    if (chunks.length > 300) throw new Error("SOURCE_EXTRACT_TOO_LARGE");
    await repository.finishExtraction(sponsor, competition, document, claim.token, chunks);
    return chunks;
  } catch (error) {
    await repository.failExtraction(sponsor, competition, document, claim.token).catch(() => undefined);
    throw error;
  }
}
