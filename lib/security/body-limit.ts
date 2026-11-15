// Reads a request body but never more than `max` bytes. Returns the text, or null when the body is larger than that (it stops reading at once, so a huge post is not held in memory).
// Used by the public telemetry routes, which anyone can post to (security assessment 2026-11-14, finding L-02).
export async function readBodyCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}
