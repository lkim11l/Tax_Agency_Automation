import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { createSyntheticContractTemplate } from "../../../tests/fixtures/contract-docx";
import { contractPlaceholders, DOCX_MIME } from "./constants";
import { renderDocxTemplate, validateDocxTemplate } from "./docx";

const values = Object.fromEntries(
  contractPlaceholders.map((name) => [name, `value-${name}`]),
) as Record<(typeof contractPlaceholders)[number], string>;

describe("DOCX contract template security and rendering", () => {
  it("validates explicit placeholders in document, table, header, footer and split runs", () => {
    const report = validateDocxTemplate({
      content: createSyntheticContractTemplate(),
      mimeType: DOCX_MIME,
      requiredPlaceholders: [...contractPlaceholders],
    });
    expect(report.valid).toBe(true);
    expect(report.placeholders).toHaveLength(contractPlaceholders.length);
    expect(report.parts).toEqual(expect.arrayContaining([
      "word/document.xml",
      "word/header1.xml",
      "word/footer1.xml",
    ]));
  });

  it("renders every placeholder without changing the DOCX container", () => {
    const output = renderDocxTemplate({
      content: createSyntheticContractTemplate(),
      values,
    });
    const archive = unzipSync(output);
    const renderedXml = Object.entries(archive)
      .filter(([name]) => /^word\/(document|header\d+|footer\d+)\.xml$/u.test(name))
      .map(([, bytes]) => strFromU8(bytes))
      .join("");
    expect(renderedXml).not.toContain("{{");
    expect(renderedXml).toContain("value-client_legal_name");
    expect(output.subarray(0, 2).toString()).toBe("PK");
  });

  it("blocks unknown, missing and unsupported XML placeholders", () => {
    const archive = unzipSync(createSyntheticContractTemplate());
    archive["word/document.xml"] = strToU8(
      strFromU8(archive["word/document.xml"])
        .replace("{{client_kpp}}", "{{unknown_legal_value}}")
        .replace("</w:body>", "<w:bookmarkStart w:name=\"{{client_kpp}}\"/></w:body>"),
    );
    const report = validateDocxTemplate({
      content: Buffer.from(zipSync(archive)),
      mimeType: DOCX_MIME,
      requiredPlaceholders: [...contractPlaceholders],
    });
    expect(report.valid).toBe(false);
    expect(report.errors.join("|")).toContain("UNKNOWN_PLACEHOLDERS");
    expect(report.errors.join("|")).toContain("REQUIRED_PLACEHOLDERS_MISSING");
    expect(report.errors).toContain("PLACEHOLDER_UNSUPPORTED_XML");
  });

  it("reports duplicate placeholders without executing template expressions", () => {
    const archive = unzipSync(createSyntheticContractTemplate());
    archive["word/document.xml"] = strToU8(
      strFromU8(archive["word/document.xml"]).replace(
        "</w:body>",
        "<w:p><w:r><w:t>{{client_inn}}</w:t></w:r></w:p></w:body>",
      ),
    );
    const report = validateDocxTemplate({
      content: Buffer.from(zipSync(archive)),
      mimeType: DOCX_MIME,
      requiredPlaceholders: [],
    });
    expect(report.valid).toBe(true);
    expect(report.duplicates).toContain("client_inn");
    expect(report.warnings.join("|")).toContain("DUPLICATE_PLACEHOLDERS");
  });

  it("blocks malformed archives, macros, traversal entries and invalid MIME", () => {
    expect(validateDocxTemplate({
      content: Buffer.from("not-a-zip"),
      mimeType: DOCX_MIME,
      requiredPlaceholders: [],
    }).valid).toBe(false);
    const macroArchive = unzipSync(createSyntheticContractTemplate());
    macroArchive["word/vbaProject.bin"] = new Uint8Array([1, 2, 3]);
    expect(validateDocxTemplate({
      content: Buffer.from(zipSync(macroArchive)),
      mimeType: "application/octet-stream",
      requiredPlaceholders: [],
    }).errors).toEqual(expect.arrayContaining(["MIME_TYPE_INVALID", "MACROS_NOT_ALLOWED"]));

    const unsafe = unzipSync(createSyntheticContractTemplate());
    unsafe["../escape.xml"] = strToU8("unsafe");
    expect(validateDocxTemplate({
      content: Buffer.from(zipSync(unsafe)),
      mimeType: DOCX_MIME,
      requiredPlaceholders: [],
    }).valid).toBe(false);
  });

  it("blocks XML entities and refuses null rendering values", () => {
    const entityArchive = unzipSync(createSyntheticContractTemplate());
    entityArchive["word/document.xml"] = strToU8(
      strFromU8(entityArchive["word/document.xml"]).replace(
        "<w:document",
        "<!DOCTYPE x [<!ENTITY leak SYSTEM \"file:///secret\">]><w:document",
      ),
    );
    expect(validateDocxTemplate({
      content: Buffer.from(zipSync(entityArchive)),
      mimeType: DOCX_MIME,
      requiredPlaceholders: [],
    }).errors).toContain("XML_ENTITIES_NOT_ALLOWED");
    expect(() => renderDocxTemplate({
      content: createSyntheticContractTemplate(),
      values: { ...values, client_inn: "" },
    })).toThrow("PLACEHOLDER_VALUE_MISSING:client_inn");
  });
});
