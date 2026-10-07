// Server-only PDF text extraction. pdf-parse (pdfjs) needs its worker and canvas polyfills set up before first use, and a
// static top-level import crashes the whole route on serverless hosts (500 HTML instead of the route's JSON error).
// Loading it lazily here means a PDF problem fails only the request that needs a PDF, with a readable code.
type PdfPage = { num: number; text: string };

let loader: Promise<typeof import("pdf-parse")> | null = null;
async function loadPdfParse() {
  loader ??= (async () => {
    // pdf-parse/worker installs the DOMMatrix/ImageData/Path2D polyfills (@napi-rs/canvas) and ships the pdfjs worker inline.
    const worker = await import("pdf-parse/worker");
    const pdf = await import("pdf-parse");
    pdf.PDFParse.setWorker(worker.getData());
    return pdf;
  })().catch((error) => { loader = null; console.error("[pdf] pdf-parse could not be loaded", error); throw new Error("PDF_ENGINE_UNAVAILABLE"); });
  return loader;
}

export async function pdfPages(data: Buffer | Uint8Array): Promise<PdfPage[]> {
  const { PDFParse } = await loadPdfParse();
  const { CanvasFactory } = await import("pdf-parse/worker");
  const parser = new PDFParse({ data, CanvasFactory });
  try { return (await parser.getText()).pages.map((page) => ({ num: page.num, text: page.text })); }
  finally { await parser.destroy(); }
}
