"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { checkContractEligibility, generateContract } from "./service";

function target(id: string, type: "error" | "success", message: string) {
  return `/applications/${id}?${type}=${encodeURIComponent(message)}`;
}

const requestSchema = z.object({
  applicationId: z.string().uuid(),
  templateId: z.string().uuid(),
  force: z.enum(["0", "1"]).default("0"),
  forceReason: z.string().trim().max(1000).optional(),
});

const STALE_FINGERPRINT_REASONS = new Set(["SOURCE_FINGERPRINT_MISMATCH", "RULE_SET_MISMATCH"]);

// Never surface internal blocking codes (GENERATION_BLOCKED:..., raw error
// messages) to the user — map every reason to a safe Russian description and
// log the technical detail server-side only.
function safeBlockingMessage(reasons: string[]): string {
  // Checked first and on its own: a template that failed the runtime
  // content re-verification (mock markers, highlighting, missing mandatory
  // placeholders, checksum mismatch, outdated schema) is a security
  // finding, not an ordinary "not ready yet" state — status=approved and
  // is_active=true never override this.
  if (reasons.includes("TEMPLATE_SECURITY_REVALIDATION_FAILED")) {
    return "Выбранный шаблон договора больше не соответствует требованиям безопасности. Администратору необходимо загрузить и одобрить новую версию шаблона.";
  }
  if (reasons.some((reason) => STALE_FINGERPRINT_REASONS.has(reason))) {
    return "Данные заявки изменились или были проверены по другому шаблону. Комплектность будет пересчитана автоматически.";
  }
  if (reasons.includes("TEMPLATE_NOT_APPROVED") || reasons.includes("TEMPLATE_VALIDATION_INVALID")) {
    return "Шаблон договора ещё не одобрен или не прошёл проверку.";
  }
  if (reasons.includes("UNRESOLVED_CONFLICT")) {
    return "В данных заявки есть неразрешённые конфликты значений — требуется проверка специалистом.";
  }
  if (reasons.includes("REVIEW_REQUIRED_FIELD") || reasons.includes("COMPLETENESS_FIELD_BLOCKED")) {
    return "Есть данные заявки, требующие проверки специалистом.";
  }
  if (reasons.includes("COMPLETENESS_STALE")) {
    return "Поступили новые данные заявки — требуется повторная обработка.";
  }
  if (reasons.includes("APPLICATION_NOT_READY")) {
    return "Не все обязательные данные заявки подтверждены.";
  }
  return "Формирование договора заблокировано проверками безопасности.";
}

function safeGenerationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("GENERATION_BLOCKED:")) {
    const reasons = message.slice("GENERATION_BLOCKED:".length).split(",");
    if (reasons.includes("TEMPLATE_SECURITY_REVALIDATION_FAILED")) {
      return safeBlockingMessage(reasons);
    }
    if (reasons.some((reason) => STALE_FINGERPRINT_REASONS.has(reason))) {
      // loadGenerationSource already tried an automatic recalculation before
      // returning this — if the mismatch survived that, it needs a human.
      return "Не удалось подготовить договор. Повторно обработайте заявку или обратитесь к администратору.";
    }
    return safeBlockingMessage(reasons);
  }
  return "Не удалось подготовить договор. Повторно обработайте заявку или обратитесь к администратору.";
}

export async function checkContractEligibilityAction(formData: FormData) {
  const parsed = requestSchema.safeParse({
    applicationId: formData.get("application_id"),
    templateId: formData.get("template_id"),
    force: "0",
  });
  if (!parsed.success) redirect("/applications?error=Некорректный запрос проверки готовности.");
  let destination: string;
  try {
    const result = await checkContractEligibility(parsed.data.applicationId, parsed.data.templateId);
    if (!result.ready) {
      console.error("checkContractEligibilityAction blocked", {
        applicationId: parsed.data.applicationId,
        templateId: parsed.data.templateId,
        blockingReasons: result.blockingReasons,
      });
    }
    destination = target(
      parsed.data.applicationId,
      result.ready ? "success" : "error",
      result.ready
        ? "Заявка готова к формированию договора."
        : safeBlockingMessage(result.blockingReasons),
    );
  } catch (error) {
    console.error("checkContractEligibilityAction failed", error);
    destination = target(
      parsed.data.applicationId,
      "error",
      "Не удалось проверить готовность заявки. Повторите попытку.",
    );
  }
  redirect(destination);
}

export async function generateContractAction(formData: FormData) {
  const parsed = requestSchema.safeParse({
    applicationId: formData.get("application_id"),
    templateId: formData.get("template_id"),
    force: formData.get("force") ?? "0",
    forceReason: formData.get("force_reason") || undefined,
  });
  if (!parsed.success || (parsed.data.force === "1" && (parsed.data.forceReason?.length ?? 0) < 2)) {
    redirect("/applications?error=Некорректный запрос формирования договора.");
  }
  let destination: string;
  try {
    const result = await generateContract({
      applicationId: parsed.data.applicationId,
      templateId: parsed.data.templateId,
      force: parsed.data.force === "1",
      forceReason: parsed.data.forceReason,
    });
    revalidatePath(`/applications/${parsed.data.applicationId}`);
    destination = target(
      parsed.data.applicationId,
      "success",
      result.cacheHit
        ? "Договор уже сформирован по текущим данным — возвращена существующая неизменяемая версия."
        : "Сформирована новая версия проекта договора для проверки специалистом.",
    );
  } catch (error) {
    console.error("generateContractAction failed", error);
    destination = target(
      parsed.data.applicationId,
      "error",
      safeGenerationErrorMessage(error),
    );
  }
  redirect(destination);
}
