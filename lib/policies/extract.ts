import mammoth from "mammoth";
import { assertSafeZip } from "@/lib/uploads/zip-guard";
import { pdfPages } from "@/lib/pdf";

// Text from an uploaded Word, PDF or text file, for the policy editor. A Word file keeps its headings, lists and bold (as the simple formatting the editor uses); a PDF gives plain text.
// The file must be what its name says. Errors are short codes the route turns into sentences.
export const tidyMarkdown = (md: string) => md.replace(/<[^>]*>/g, "").replace(/__(.+?)__/g, "**$1**").replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();

// mammoth converts to Markdown at run time but its type file does not list the call.
const toMarkdown = (buffer: Buffer) => (mammoth as unknown as { convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string }> }).convertToMarkdown({ buffer });

export async function extractPolicyText(name: string, bytes: Uint8Array): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") { if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("NOT_A_PDF"); return (await pdfPages(bytes)).map((p) => p.text).join("\n\n").trim(); }
  if (ext === "docx") { if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("NOT_A_DOCX"); assertSafeZip(bytes); return tidyMarkdown((await toMarkdown(Buffer.from(bytes))).value); }
  if (ext === "txt" || ext === "md") return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  throw new Error("UNSUPPORTED_TYPE");
}
