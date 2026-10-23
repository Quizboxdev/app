import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractPolicyText, tidyMarkdown } from "./extract";

const enc = (s: string) => new TextEncoder().encode(s);
async function docx(paragraphs: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("policy file to text", () => {
  it("reads plain text and markdown files", async () => {
    expect(await extractPolicyText("terms.txt", enc("  Hello world  "))).toBe("Hello world");
    expect(await extractPolicyText("TERMS.MD", enc("# Title\n\ntext"))).toBe("# Title\n\ntext");
  });
  it("reads a Word file and keeps headings and bold", async () => {
    const bytes = await docx('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Terms of Use</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Important</w:t></w:r><w:r><w:t> text here.</w:t></w:r></w:p>');
    const text = await extractPolicyText("terms.docx", bytes);
    expect(text).toContain("Terms of Use");
    expect(text).toContain("**Important**");
  });
  it("refuses a file that is not what its name says, and unsupported types", async () => {
    await expect(extractPolicyText("fake.pdf", enc("not a pdf"))).rejects.toThrow("NOT_A_PDF");
    await expect(extractPolicyText("fake.docx", enc("not a zip"))).rejects.toThrow("NOT_A_DOCX");
    await expect(extractPolicyText("macro.exe", enc("MZ"))).rejects.toThrow("UNSUPPORTED_TYPE");
    await expect(extractPolicyText("noextension", enc("x"))).rejects.toThrow("UNSUPPORTED_TYPE");
  });
  it("tidies converted text: no stray HTML, backslash escapes removed, bold in our format", () => {
    expect(tidyMarkdown('<a id="_Toc1"></a>1\\. Scope\n\n\n\n__Bold__ and \\* star')).toBe("1. Scope\n\n**Bold** and * star");
  });
});
