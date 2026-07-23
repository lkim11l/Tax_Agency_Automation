import { createHash } from "node:crypto";

import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";

import type { AttachmentDescriptor } from "./types";

export function descriptor(
  filename: string,
  mimeType: string,
  content: Buffer,
): AttachmentDescriptor {
  return {
    attachmentId: "00000000-0000-4000-8000-000000000001",
    applicationId: "00000000-0000-4000-8000-000000000002",
    originalFilename: filename,
    sanitizedFilename: filename,
    mimeType,
    sizeBytes: content.length,
    storagePath: `tests/${filename}`,
    checksum: createHash("sha256").update(content).digest("hex"),
  };
}

export function syntheticDocx() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Test contract</w:t></w:r></w:p>
    <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>INN</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1234567890</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`;
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(relationships),
      "word/document.xml": strToU8(document),
    }),
  );
}

export async function syntheticXlsx() {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet("Request");
  first.addRow(["Field", "Value"]);
  first.addRow(["Amount", 1250.5]);
  first.addRow(["Date", new Date("2026-07-23T00:00:00.000Z")]);
  first.getCell("B4").value = { formula: "SUM(B2:B3)" };
  const second = workbook.addWorksheet("Empty");
  second.getCell("A1").value = null;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function syntheticPdf(text = "Phase 3 PDF text") {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
