"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { recalculateCompleteness } from "@/modules/clarification/service";
import { getRuleSet } from "@/modules/clarification/rules";
import { recordSafeFieldAcceptances } from "@/modules/extraction/acceptance";

import { processApplication, ruleSetForApplication } from "./processing";

function target(applicationId: string, type: "error" | "success", message: string) {
  return `/applications/${applicationId}?${type}=${encodeURIComponent(message)}`;
}

function applicationId(formData: FormData) {
  return z.string().uuid().safeParse(formData.get("application_id"));
}

export async function processApplicationAction(formData: FormData) {
  const parsed = applicationId(formData);
  if (!parsed.success) redirect("/applications?error=Некорректная заявка.");
  let message: string;
  try {
    const context = await getOperationalContext();
    const result = await processApplication({
      applicationId: parsed.data,
      actorId: context.profile.id,
    });
    revalidatePath(`/applications/${parsed.data}`);
    message = result.claimed
      ? "Заявка успешно обработана."
      : result.cacheHit
        ? "Заявка уже обработана по текущим данным."
        : "Обработка этой заявки уже выполняется.";
  } catch (error) {
    console.error("processApplicationAction failed", error);
    redirect(target(
      parsed.data,
      "error",
      "Не удалось обработать заявку. Повторите попытку.",
    ));
  }
  redirect(target(parsed.data, "success", message));
}

export async function bulkAcceptSafeFieldsAction(formData: FormData) {
  const parsed = applicationId(formData);
  if (!parsed.success) redirect("/applications?error=Некорректная заявка.");
  let accepted = 0;
  let ready = false;
  try {
    const context = await getOperationalContext();
    const admin = createAdminClient();
    const ruleSetId = await ruleSetForApplication(parsed.data, admin);
    const requiredFieldNames = new Set(
      getRuleSet(ruleSetId).rules.filter((rule) => rule.required).map((rule) => rule.fieldName),
    );
    const result = await recordSafeFieldAcceptances({
      applicationId: parsed.data,
      actorId: context.profile.id,
      method: "bulk",
      admin,
      requiredFieldNames,
    });
    accepted = result.preview.eligible.length;
    const completeness = await recalculateCompleteness({
      applicationId: parsed.data,
      ruleSetId,
      initiatedBy: context.profile.id,
      admin,
    });
    ready = completeness.ready;
    await admin
      .from("applications")
      .update({ status: ready ? "data_complete" : "needs_data_review" })
      .eq("id", parsed.data);
    revalidatePath(`/applications/${parsed.data}`);
  } catch (error) {
    console.error("bulkAcceptSafeFieldsAction failed", error);
    redirect(target(
      parsed.data,
      "error",
      "Не удалось подтвердить данные. Повторите попытку.",
    ));
  }
  redirect(target(
    parsed.data,
    "success",
    `Подтверждено безопасных полей: ${accepted}. Комплектность пересчитана${ready ? " — данные готовы." : "."}`,
  ));
}
