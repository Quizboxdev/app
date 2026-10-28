import sharp from "sharp";

export const BRAND_IMAGE_MAX_INPUT_BYTES = 4_000_000;
export const SUBJECT_IMAGE_VARIANTS = {
  discovery: { width: 960, height: 600, maxBytes: 150_000 },
  mobile: { width: 640, height: 640, maxBytes: 110_000 },
} as const;
export const SPONSOR_LOGO_VARIANT = { width: 160, height: 160, maxBytes: 24_000 } as const;

type InputFormat = "jpeg" | "png" | "webp";
const ACCEPTED: Record<string, InputFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export type BrandImageError = "INVALID_IMAGE" | "IMAGE_TOO_LARGE";
export type FocalPoint = { x: number; y: number };

function inputPipeline(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > BRAND_IMAGE_MAX_INPUT_BYTES) throw new Error("IMAGE_TOO_LARGE" satisfies BrandImageError);
  if (!ACCEPTED[mime]) throw new Error("INVALID_IMAGE" satisfies BrandImageError);
  return sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" }).rotate();
}

function validateFocalPoint(focal: FocalPoint) {
  if (![focal.x, focal.y].every((value) => Number.isInteger(value) && value >= 0 && value <= 100)) {
    throw new Error("INVALID_IMAGE" satisfies BrandImageError);
  }
}

function cropForAspect(width: number, height: number, aspect: number, focal: FocalPoint) {
  if (width / height > aspect) {
    const cropWidth = Math.max(1, Math.min(width, Math.round(height * aspect)));
    const left = Math.max(0, Math.min(width - cropWidth, Math.round((focal.x / 100) * width - cropWidth / 2)));
    return { left, top: 0, width: cropWidth, height };
  }
  const cropHeight = Math.max(1, Math.min(height, Math.round(width / aspect)));
  const top = Math.max(0, Math.min(height - cropHeight, Math.round((focal.y / 100) * height - cropHeight / 2)));
  return { left: 0, top, width, height: cropHeight };
}

async function metadataFor(bytes: Buffer, mime: string) {
  const expected = ACCEPTED[mime];
  const metadata = await inputPipeline(bytes, mime).metadata();
  if (!expected || metadata.format !== expected || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
    throw new Error("INVALID_IMAGE" satisfies BrandImageError);
  }
  const swapped = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  return { width: swapped ? metadata.height! : metadata.width, height: swapped ? metadata.width! : metadata.height };
}

async function encodeWithinBudget(image: ReturnType<typeof sharp>, maxBytes: number, width: number, height: number, fit: "cover" | "inside") {
  for (const quality of [82, 78, 74, 70, 66, 62, 58]) {
    const result = await image.clone().resize(width, height, {
      fit,
      withoutEnlargement: true,
    }).webp({ quality, effort: 6, alphaQuality: 100, smartSubsample: true }).toBuffer({ resolveWithObject: true });
    if (result.data.byteLength <= maxBytes) {
      return { bytes: result.data, width: result.info.width, height: result.info.height, mime: "image/webp" as const };
    }
  }
  throw new Error("IMAGE_TOO_LARGE" satisfies BrandImageError);
}

export async function optimizeSubjectImage(bytes: Buffer, mime: string, variant: keyof typeof SUBJECT_IMAGE_VARIANTS, focal: FocalPoint = { x: 50, y: 50 }) {
  validateFocalPoint(focal);
  const dimensions = await metadataFor(bytes, mime);
  const spec = SUBJECT_IMAGE_VARIANTS[variant];
  const crop = cropForAspect(dimensions.width, dimensions.height, spec.width / spec.height, focal);
  const image = inputPipeline(bytes, mime).extract(crop);
  return encodeWithinBudget(image, spec.maxBytes, spec.width, spec.height, "cover");
}

export async function optimizeSponsorLogo(bytes: Buffer, mime: string) {
  await metadataFor(bytes, mime);
  return encodeWithinBudget(inputPipeline(bytes, mime), SPONSOR_LOGO_VARIANT.maxBytes, SPONSOR_LOGO_VARIANT.width, SPONSOR_LOGO_VARIANT.height, "inside");
}

export const optimizeSubjectImagePair = async (bytes: Buffer, mime: string, focal: FocalPoint = { x: 50, y: 50 }) => ({
  discovery: await optimizeSubjectImage(bytes, mime, "discovery", focal),
  mobile: await optimizeSubjectImage(bytes, mime, "mobile", focal),
});
