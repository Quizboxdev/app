import sharp from "sharp";
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export async function validateImage(bytes: Buffer, mime: string) {
  const formats: Record<string,string> = { "image/png":"png", "image/jpeg":"jpeg", "image/webp":"webp" };
  if (!formats[mime] || !bytes.length || bytes.length > MEDIA_MAX_BYTES) throw new Error("QB_INVALID_MEDIA");
  const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
  const info = await image.metadata();
  if (info.format !== formats[mime] || !info.width || !info.height || info.width > 4096 || info.height > 4096 || (info.pages ?? 1) > 1) throw new Error("QB_INVALID_MEDIA");
  // Re-encoding removes embedded metadata and rejects incomplete pixel data.
  const normalized = await image.rotate().png().toBuffer({ resolveWithObject: true });
  if (normalized.data.length > MEDIA_MAX_BYTES) throw new Error("QB_INVALID_MEDIA");
  return { bytes: normalized.data, width: normalized.info.width, height: normalized.info.height, mime: "image/png" };
}
