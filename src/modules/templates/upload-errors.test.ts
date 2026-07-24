import { describe, expect, it } from "vitest";

import {
  classifyTemplateDatabaseError,
  normalizeDocxFilename,
  TemplateUploadError,
} from "./upload-errors";

describe("template upload diagnostics", () => {
  it("maps duplicate constraints without exposing database details", () => {
    const error = classifyTemplateDatabaseError({
      code: "23505",
      message: 'duplicate key violates unique constraint "contract_templates_code_version_key"',
    });
    expect(error.safeCode).toBe("TEMPLATE_DUPLICATE");
    expect(error.diagnostic.constraint).toBe("contract_templates_code_version_key");
  });

  it("maps RLS and schema mismatch errors", () => {
    expect(classifyTemplateDatabaseError({ code: "42501" }).safeCode).toBe("TEMPLATE_RLS_DENIED");
    expect(classifyTemplateDatabaseError({ code: "PGRST204" }).safeCode).toBe("TEMPLATE_SCHEMA_MISMATCH");
  });

  it("normalizes repeated DOCX extensions and rejects other files", () => {
    expect(normalizeDocxFilename(" contract.docx.docx ")).toBe("contract.docx");
    expect(() => normalizeDocxFilename("contract.pdf")).toThrow(TemplateUploadError);
  });
});
