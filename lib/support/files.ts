// Attachments to a support request: images (PNG, JPEG, WebP) and PDF, at most 5 MB each and 3 at a time. The type is decided by what is inside the file, never by its name or by the type the browser claims,
// so a program renamed to .png is refused. Files are stored under a random name; only a cleaned version of the original name is kept for display.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 3;
export type SupportMime = "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
export const EXTENSION: Record<SupportMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function sniffMime(bytes: Uint8Array): SupportMime | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";   // RIFF....WEBP
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";                                         // %PDF-
  return null;
}

export type FileCheck = { ok: true; mime: SupportMime; ext: string } | { ok: false; code: "EMPTY" | "TOO_BIG" | "BAD_TYPE" };
export function checkFile(bytes: Uint8Array): FileCheck {
  if (bytes.length === 0) return { ok: false, code: "EMPTY" };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, code: "TOO_BIG" };
  const mime = sniffMime(bytes);
  return mime ? { ok: true, mime, ext: EXTENSION[mime] } : { ok: false, code: "BAD_TYPE" };
}

export const FILE_MESSAGES = { EMPTY: "One of the files is empty.", TOO_BIG: "A file is larger than 5 MB.", BAD_TYPE: "Only images (PNG, JPEG, WebP) and PDF files can be attached." } as const;

// What is shown to people and staff as the file's name: no folders, no control characters, not too long.
export function displayName(name: string, ext: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "attachment";
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${ext}`;
}
