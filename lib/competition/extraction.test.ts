import { describe, expect, it } from "vitest";
import { CFB } from "xlsx";
import { extractSource } from "./ingestion";

function pdfFixture() {
  const text = "BT /F1 12 Tf 50 100 Td (Demo source: isolate power before maintenance.) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`];
  let content = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
function docxFixture() {
  // Use the existing SheetJS ZIP container, not another runtime/dependency.
  const archive = CFB.utils.cfb_new();
  const files: Record<string, string> = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Demo source: isolate power before maintenance.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
  };
  for (const [name, xml] of Object.entries(files)) CFB.utils.cfb_add(archive, name, Buffer.from(xml));
  return Buffer.from(CFB.write(archive, { type: "buffer", fileType: "zip" }));
}
describe("real parser adapters with deterministic local source documents", () => {
  it("extracts PDF text with its page identity", async () => { const result = await extractSource(pdfFixture(), "application/pdf"); expect(result[0].text).toContain("isolate power"); expect(result[0].page).toBe(1); });
  it("extracts DOCX text without inventing page numbers", async () => { const result = await extractSource(docxFixture(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); expect(result[0].text).toContain("isolate power"); expect(result[0].page).toBeNull(); });
  it("rejects invalid UTF-8 and binary TXT", async () => { await expect(extractSource(Buffer.from([0xff]), "text/plain")).rejects.toThrow(); await expect(extractSource(Buffer.from("a\0b"), "text/plain")).rejects.toThrow("INVALID_TEXT_SOURCE"); });
});
