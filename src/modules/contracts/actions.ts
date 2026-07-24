"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { safeBlockingMessage, safeGenerationErrorMessage } from "./messages";
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
        missingRenderFields: result.missingRenderFields,
      });
    }
    destination = target(
      parsed.data.applicationId,
      result.ready ? "success" : "error",
      result.ready
        ? "Заявка готова к формированию договора."
        : safeBlockingMessage(result.blockingReasons, result.missingRenderFields),
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
