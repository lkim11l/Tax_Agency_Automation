import { strToU8, zipSync } from "fflate";

import { contractPlaceholders } from "../../src/modules/contracts/constants";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function paragraph(text: string, style?: string) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function tableRow(label: string, placeholder: string) {
  return `<w:tr>
    <w:tc><w:tcPr><w:tcW w:w="3300" w:type="dxa"/></w:tcPr>${paragraph(label)}</w:tc>
    <w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${paragraph(`{{${placeholder}}}`)}</w:tc>
  </w:tr>`;
}

export function createSyntheticContractTemplate() {
  const bodyPlaceholders = contractPlaceholders.filter(
    (name) => !["application_number", "contract_number", "client_legal_name"].includes(name),
  );
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
        <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
        <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
      </Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="${r}/styles" Target="styles.xml"/>
        <Relationship Id="rId2" Type="${r}/header" Target="header1.xml"/>
        <Relationship Id="rId3" Type="${r}/footer" Target="footer1.xml"/>
      </Relationships>`),
    "word/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="${w}">
        <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
        <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
      </w:styles>`),
    "word/header1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:hdr xmlns:w="${w}">${paragraph("Tax Agency Automation | Заявка {{application_number}}")}</w:hdr>`),
    "word/footer1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:ftr xmlns:w="${w}">${paragraph("Договор {{contract_number}} | Для внутреннего согласования")}</w:ftr>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="${w}" xmlns:r="${r}">
        <w:body>
          ${paragraph("ДОГОВОР ОКАЗАНИЯ УСЛУГ", "Title")}
          ${paragraph("Версия для обязательной проверки и согласования человеком.")}
          <w:p><w:r><w:t>{{client_</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>legal_name}}</w:t></w:r></w:p>
          <w:tbl>
            <w:tblPr><w:tblW w:w="9300" w:type="dxa"/><w:tblBorders>
              <w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>
              <w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>
              <w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>
            </w:tblBorders></w:tblPr>
            ${bodyPlaceholders.map((name) => tableRow(name.replaceAll("_", " "), name)).join("")}
          </w:tbl>
          <w:p><w:r><w:t>Подпись клиента: ____________________</w:t></w:r></w:p>
          <w:sectPr>
            <w:pgSz w:w="11906" w:h="16838"/>
            <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/>
            <w:headerReference w:type="default" r:id="rId2"/>
            <w:footerReference w:type="default" r:id="rId3"/>
          </w:sectPr>
        </w:body>
      </w:document>`),
  };
  return Buffer.from(zipSync(entries, { level: 6 }));
}
