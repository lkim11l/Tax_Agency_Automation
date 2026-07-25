import { PLACEHOLDER_LABELS, type ContractPlaceholder } from "./constants";

// Pure presentation logic, deliberately kept out of actions.ts ("use server"
// — every export from that file must be an async Server Action, so a plain
// synchronous formatter can't live there and still be unit-testable without
// a Next.js server-action runtime).

const REQUIRED_RENDER_VALUE_MISSING_PREFIX = "REQUIRED_RENDER_VALUE_MISSING:";
const OUTPUT_CONTENT_SAFETY_PREFIX = "OUTPUT_CONTENT_SAFETY_FAILED:";
const STALE_FINGERPRINT_REASONS = new Set(["SOURCE_FINGERPRINT_MISMATCH", "RULE_SET_MISMATCH"]);

export function missingFieldsMessage(fieldList: string): string {
  const labels = fieldList
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => PLACEHOLDER_LABELS[name as ContractPlaceholder] ?? name);
  return `Для формирования договора не хватает данных: ${labels.join(", ")}.`;
}

// Never surface internal blocking codes (GENERATION_BLOCKED:..., raw error
// messages) to the user — map every reason to a safe Russian description and
// log the technical detail server-side only.
export function safeBlockingMessage(reasons: string[], missingRenderFields?: string[]): string {
  // Checked first and on its own: a template that failed the runtime
  // content re-verification (mock markers, highlighting, missing mandatory
  // placeholders, checksum mismatch, outdated schema) is a security
  // finding, not an ordinary "not ready yet" state — status=approved and
  // is_active=true never override this.
  if (reasons.includes("TEMPLATE_SECURITY_REVALIDATION_FAILED")) {
    return "Выбранный шаблон договора больше не соответствует требованиям безопасности. Администратору необходимо загрузить и одобрить новую версию шаблона.";
  }
  // The template file itself already passed its own security check — this
  // means a FIELD VALUE from the application's data rendered into something
  // that looks like a mock/test placeholder (e.g. a bank name of "тестовый
  // банк"). The fix is in the application's data, not the template.
  if (reasons.includes("OUTPUT_CONTENT_SAFETY_FAILED")) {
    return "В данных заявки есть значения, похожие на тестовые заглушки (например, наименование банка вида «тестовый банк»). Договор с такими данными не формируется — проверьте и исправьте реквизиты в заявке.";
  }
  if (reasons.some((reason) => STALE_FINGERPRINT_REASONS.has(reason))) {
    return "Данные заявки изменились или были проверены по другому шаблону. Комплектность будет пересчитана автоматически.";
  }
  if (reasons.includes("TEMPLATE_NOT_APPROVED") || reasons.includes("TEMPLATE_VALIDATION_INVALID")) {
    return "Шаблон договора ещё не одобрен или не прошёл проверку.";
  }
  // This is the exact field-level detail an eligibility check can now give a
  // specialist before they even attempt generation (see
  // checkContractEligibility in ./service.ts) — show it instead of the
  // vaguer "not all data confirmed" message whenever we actually know which
  // fields are missing.
  if (reasons.includes("REQUIRED_RENDER_VALUE_MISSING") && missingRenderFields?.length) {
    return missingFieldsMessage(missingRenderFields.join(","));
  }
  if (reasons.includes("UNRESOLVED_CONFLICT")) {
    return "В данных заявки есть неразрешённые конфликты значений — требуется проверка специалистом.";
  }
  if (
    reasons.includes("REVIEW_REQUIRED_FIELD") ||
    reasons.includes("COMPLETENESS_FIELD_BLOCKED") ||
    reasons.includes("APPLICATION_HAS_BLOCKING_FIELDS")
  ) {
    return "Есть данные заявки, требующие проверки специалистом.";
  }
  if (reasons.includes("COMPLETENESS_STALE")) {
    return "Поступили новые данные заявки — требуется повторная обработка.";
  }
  if (reasons.includes("APPLICATION_NOT_READY")) {
    return "Не все обязательные данные заявки подтверждены.";
  }
  if (reasons.includes("SIGNER_NAME_DECLENSION_UNRELIABLE")) {
    return "Не удалось надёжно просклонять ФИО подписанта в родительном падеже. Проверьте, что ФИО указано как «Фамилия Имя Отчество» и имя есть в списке распознаваемых — иначе укажите данные вручную или обратитесь к администратору для расширения словаря склонений.";
  }
  if (reasons.includes("SIGNER_POSITION_DECLENSION_UNRELIABLE")) {
    return "Не удалось надёжно просклонять должность подписанта в родительном падеже — такой должности нет в списке распознаваемых. Обратитесь к администратору, чтобы добавить её.";
  }
  if (reasons.includes("SIGNER_AUTHORITY_DECLENSION_UNRELIABLE")) {
    return "Не удалось надёжно просклонять основание полномочий подписанта (устав, доверенность, приказ). Проверьте формулировку в данных заявки.";
  }
  if (reasons.includes("AMOUNT_WORDS_UNSUPPORTED_CURRENCY")) {
    return "Сумма договора указана не в рублях — сумма прописью поддерживается только для рублей (RUB).";
  }
  if (reasons.includes("CONTRACT_AMOUNT_INVALID")) {
    return "Сумма договора в данных заявки некорректна (отрицательная или нечисловая).";
  }
  if (reasons.includes("MAPPING_VALIDATION_FAILED")) {
    return "Не удалось подготовить данные для договора из-за неожиданной ошибки проверки. Обратитесь к администратору.";
  }
  return "Формирование договора заблокировано проверками безопасности.";
}

export function safeGenerationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("GENERATION_BLOCKED:")) {
    // generateContract joins independent blocking reasons with ";" — never
    // "," — because REQUIRED_RENDER_VALUE_MISSING:<field1>,<field2> is one
    // reason carrying a comma-separated *field list*, and it can appear
    // alongside other bare reasons in the same message. Splitting everything
    // on "," (the old bug) turned "<field1>" into an unmatched pseudo-reason
    // that matched nothing and silently fell through to the fully generic
    // message below, no matter how well-diagnosed the actual failure was.
    const rawReasons = message.slice("GENERATION_BLOCKED:".length).split(";");
    const missingFieldsReason = rawReasons.find((reason) => reason.startsWith(REQUIRED_RENDER_VALUE_MISSING_PREFIX));
    const missingRenderFields = missingFieldsReason
      ?.slice(REQUIRED_RENDER_VALUE_MISSING_PREFIX.length)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (missingRenderFields?.length) {
      console.error("generateContract blocked: required render values missing", {
        fields: missingRenderFields,
      });
    }
    const contentSafetyReason = rawReasons.find((reason) => reason.startsWith(OUTPUT_CONTENT_SAFETY_PREFIX));
    if (contentSafetyReason) {
      console.error("generateContract blocked: output content safety check failed", {
        code: contentSafetyReason.slice(OUTPUT_CONTENT_SAFETY_PREFIX.length),
      });
    }
    const reasons = rawReasons.map((reason) => {
      if (reason.startsWith(REQUIRED_RENDER_VALUE_MISSING_PREFIX)) return "REQUIRED_RENDER_VALUE_MISSING";
      if (reason.startsWith(OUTPUT_CONTENT_SAFETY_PREFIX)) return "OUTPUT_CONTENT_SAFETY_FAILED";
      return reason;
    });
    if (reasons.includes("TEMPLATE_SECURITY_REVALIDATION_FAILED")) {
      return safeBlockingMessage(reasons, missingRenderFields);
    }
    if (reasons.some((reason) => STALE_FINGERPRINT_REASONS.has(reason))) {
      // loadGenerationSource already tried an automatic recalculation before
      // returning this — if the mismatch survived that, it needs a human.
      return "Не удалось подготовить договор. Повторно обработайте заявку или обратитесь к администратору.";
    }
    return safeBlockingMessage(reasons, missingRenderFields);
  }
  return "Не удалось подготовить договор. Повторно обработайте заявку или обратитесь к администратору.";
}
