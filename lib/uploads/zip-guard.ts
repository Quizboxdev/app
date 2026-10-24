// Protection against "zip bombs" in uploaded Word and Excel files (audit QB-AUD-014). A .docx or .xlsx is a zip file: a tiny upload can expand to gigabytes when it is read, using all the server's memory.
// Before any reader opens the file, this reads only the zip's table of contents (the central directory, a few bytes per entry, nothing is decompressed) and refuses a file that declares too many entries,
// too much total or per-entry content, or an absurd squeeze ratio. A reader that opens the file afterwards is also protected against a table of contents that lies, because an honest file always passes
// and a dishonest one is limited by the reader's own memory limits and the upload size cap.
export const ZIP_LIMITS = { maxEntries: 2000, maxTotalBytes: 80 * 1024 * 1024, maxEntryBytes: 40 * 1024 * 1024, maxRatio: 200 } as const;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// Throws "NOT_A_ZIP" when it is not a readable zip, "ZIP_TOO_LARGE" when it would expand too far, "ZIP_SUSPICIOUS" for a squeeze ratio no real document has.
export function assertSafeZip(bytes: Uint8Array, limits: { maxEntries: number; maxTotalBytes: number; maxEntryBytes: number; maxRatio: number } = ZIP_LIMITS): { entries: number; totalBytes: number } {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("NOT_A_ZIP");
  // The end-of-central-directory record is in the last 22 bytes plus an optional comment of up to 65,535 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("NOT_A_ZIP");
  const entries = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) throw new Error("ZIP_TOO_LARGE");                      // zip64: far beyond any document we accept
  if (entries > limits.maxEntries) throw new Error("ZIP_TOO_LARGE");
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== 0x02014b50) throw new Error("NOT_A_ZIP");
    const compressed = u32(bytes, offset + 20), size = u32(bytes, offset + 24);
    const nameLen = u16(bytes, offset + 28), extraLen = u16(bytes, offset + 30), commentLen = u16(bytes, offset + 32);
    if (size > limits.maxEntryBytes) throw new Error("ZIP_TOO_LARGE");
    total += size;
    if (total > limits.maxTotalBytes) throw new Error("ZIP_TOO_LARGE");
    if (size > 1024 * 1024 && size / Math.max(compressed, 1) > limits.maxRatio) throw new Error("ZIP_SUSPICIOUS");   // small entries may compress a lot (empty pages); large ones may not
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, totalBytes: total };
}

// For spreadsheets, which may be old-style .xls (not a zip) or .csv: only a zip is inspected.
export const assertSafeIfZip = (bytes: Uint8Array) => { if (bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b) assertSafeZip(bytes); };
