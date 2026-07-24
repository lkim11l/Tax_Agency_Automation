export const templateUploadErrorCodes = [
  "TEMPLATE_DUPLICATE",
  "TEMPLATE_VALIDATION_FAILED",
  "TEMPLATE_STORAGE_UPLOAD_FAILED",
  "TEMPLATE_DB_INSERT_FAILED",
  "TEMPLATE_DB_CONSTRAINT_FAILED",
  "TEMPLATE_RLS_DENIED",
  "TEMPLATE_SCHEMA_MISMATCH",
  "TEMPLATE_ROLLBACK_FAILED",
] as const;

export type TemplateUploadErrorCode = (typeof templateUploadErrorCodes)[number];

export type SafeDatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export class TemplateUploadError extends Error {
  constructor(
    public readonly safeCode: TemplateUploadErrorCode,
    public readonly diagnostic: {
      supabaseCode?: string | null;
      table?: string;
      constraint?: string | null;
      httpStatus?: number | null;
      rollback?: "not_required" | "completed" | "failed";
    } = {},
  ) {
    super(safeCode);
    this.name = "TemplateUploadError";
  }
}

function constraintName(error: SafeDatabaseError) {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return source.match(/constraint ["']?([a-z0-9_]+)["']?/iu)?.[1] ?? null;
}

export function classifyTemplateDatabaseError(error: SafeDatabaseError) {
  const base = {
    supabaseCode: error.code ?? null,
    table: "contract_templates",
    constraint: constraintName(error),
  };
  if (error.code === "23505") {
    return new TemplateUploadError("TEMPLATE_DUPLICATE", base);
  }
  if (error.code === "42501") {
    return new TemplateUploadError("TEMPLATE_RLS_DENIED", base);
  }
  if (error.code?.startsWith("PGRST") || /schema cache|column .* does not exist/iu.test(error.message ?? "")) {
    return new TemplateUploadError("TEMPLATE_SCHEMA_MISMATCH", base);
  }
  if (error.code?.startsWith("23")) {
    return new TemplateUploadError("TEMPLATE_DB_CONSTRAINT_FAILED", base);
  }
  return new TemplateUploadError("TEMPLATE_DB_INSERT_FAILED", base);
}

export function templateUploadMessage(code: TemplateUploadErrorCode, locale = "ru") {
  const ru: Record<TemplateUploadErrorCode, string> = {
    TEMPLATE_DUPLICATE: "Шаблон с таким кодом и версией уже существует.",
    TEMPLATE_VALIDATION_FAILED: "Файл DOCX не прошёл безопасную проверку. Проверьте файл и заполнение полей.",
    TEMPLATE_STORAGE_UPLOAD_FAILED: "Не удалось сохранить файл шаблона. Повторите попытку.",
    TEMPLATE_DB_INSERT_FAILED: "Не удалось сохранить метаданные шаблона. Повторите попытку.",
    TEMPLATE_DB_CONSTRAINT_FAILED: "Метаданные шаблона нарушают ограничение базы данных.",
    TEMPLATE_RLS_DENIED: "Недостаточно прав для добавления шаблона.",
    TEMPLATE_SCHEMA_MISMATCH: "Схема базы данных не соответствует версии приложения.",
    TEMPLATE_ROLLBACK_FAILED: "Загрузка отменена не полностью. Сообщите администратору код операции.",
  };
  if (locale === "ru") return ru[code];
  return code.replaceAll("_", " ").toLowerCase();
}

export function normalizeDocxFilename(value: string) {
  const normalized = value.normalize("NFKC").trim().replace(/\.docx(?:\.docx)+$/iu, ".docx");
  if (!/\.docx$/iu.test(normalized)) {
    throw new TemplateUploadError("TEMPLATE_VALIDATION_FAILED");
  }
  return normalized;
}
