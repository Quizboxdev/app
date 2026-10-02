import { SponsorRepository } from "@/lib/competition/repository";
import { ingestSource, SOURCE_MAX_BYTES, uploadSource, type SourceStorage } from "@/lib/competition/ingestion";
import { boundedRequest, sponsorError, sponsorRequestClient } from "@/lib/competition/request-client";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const client = await sponsorRequestClient(request);
    const repository = new SponsorRepository(client);
    const storage: SourceStorage = {
      async upload(bucket, path, bytes, mime) { const result = await client.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false }); if (result.error) throw new Error("SOURCE_UPLOAD_FAILED"); },
      async download(bucket, path) { const result = await client.storage.from(bucket).download(path); if (result.error || !result.data) throw new Error("SOURCE_DOWNLOAD_FAILED"); if (result.data.size > SOURCE_MAX_BYTES) throw new Error("SOURCE_TOO_LARGE"); return Buffer.from(await result.data.arrayBuffer()); },
    };
    if (request.headers.get("content-type")?.includes("application/json")) {
      const args = JSON.parse((await boundedRequest(request, 4096)).toString("utf8"));
      if (![args.sponsor, args.competition, args.document].every(v => typeof v === "string")) throw new Error("INVALID_SOURCE_REQUEST");
      const chunks = await ingestSource(repository, storage, args.sponsor, args.competition, args.document);
      return Response.json({ extracted: true, chunkCount: chunks.length, approvalStatus: "review" });
    }
    const bytes = await boundedRequest(request, SOURCE_MAX_BYTES + 65536);
    const form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: bytes }).formData();
    const file = form.get("file"); if (!(file instanceof File)) throw new Error("SOURCE_FILE_REQUIRED");
    const source = await uploadSource(repository, storage, { sponsor: String(form.get("sponsor") ?? ""), competition: String(form.get("competition") ?? ""), document: String(form.get("document") ?? "") || undefined, title: String(form.get("title") ?? file.name), market: String(form.get("market") ?? "") || null, rightsConfirmed: form.get("rightsConfirmed") === "true", mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return Response.json(source);
  } catch (error) { return sponsorError(error); }
}
