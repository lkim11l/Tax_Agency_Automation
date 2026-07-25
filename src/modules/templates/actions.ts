"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getLocale } from "@/lib/i18n";
import { completenessRuleSets } from "@/modules/clarification/rules";
import {
  approveTemplate,
  setTemplateLifecycle,
  updateTemplateMetadata,
  uploadTemplateVersion,
} from "@/modules/contracts/service";
import {
  templateUploadMessage,
  TemplateUploadError,
  type TemplateUploadErrorCode,
} from "@/modules/templates/upload-errors";

export type TemplateUploadState = {
  status: "idle" | "error" | "success";
  message?: string;
  code?: TemplateUploadErrorCode;
  templateId?: string;
  operationId?: string;
};

// The admin provides only a name and a file. Code, version, template type,
// required rule set and the required-placeholder list are all derived
// automatically by uploadTemplateVersion (src/modules/contracts/service.ts)
// from the file's own content — see deriveAutoRequiredFields there for why.
// Use the "Редактировать шаблон" action on the template's page to correct
// the auto-picked template type / rule set before approval, if needed.
const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export async function uploadTemplateAction(
  _previous: TemplateUploadState,
  formData: FormData,
): Promise<TemplateUploadState> {
  const operationId = randomUUID();
  const locale = await getLocale();
  const file = formData.get("file");
  const parsed = uploadSchema.safeParse({
    name: formData.get("name"),
  });
  if (!parsed.success || !(file instanceof File) || file.size === 0 || file.size > 10_485_760) {
    return {
      status: "error",
      code: "TEMPLATE_VALIDATION_FAILED",
      message: templateUploadMessage("TEMPLATE_VALIDATION_FAILED", locale),
      operationId,
    };
  }
  try {
    const result = await uploadTemplateVersion({
      ...parsed.data,
      filename: file.name,
      mimeType: file.type,
      content: Buffer.from(await file.arrayBuffer()),
      operationId,
    });
    revalidatePath("/templates");
    return {
      status: "success",
      message: locale === "ru" ? "Шаблон загружен и проверен." : "Template uploaded and validated.",
      templateId: result.templateId,
      operationId,
    };
  } catch (error) {
    const code = error instanceof TemplateUploadError
      ? error.safeCode
      : "TEMPLATE_DB_INSERT_FAILED";
    return {
      status: "error",
      code,
      message: templateUploadMessage(code, locale),
      operationId,
    };
  }
}

export async function templateLifecycleAction(formData: FormData) {
  const parsed = z.object({
    templateId: z.string().uuid(),
    action: z.enum(["approve", "deactivate", "archive"]),
  }).safeParse({
    templateId: formData.get("template_id"),
    action: formData.get("lifecycle_action"),
  });
  if (!parsed.success) redirect("/templates?error=Invalid template action.");
  try {
    if (parsed.data.action === "approve") await approveTemplate(parsed.data.templateId);
    else await setTemplateLifecycle(parsed.data.templateId, parsed.data.action);
    revalidatePath("/templates");
    revalidatePath(`/templates/${parsed.data.templateId}`);
  } catch (error) {
    redirect(`/templates/${parsed.data.templateId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Template action failed.")}`);
  }
  redirect(`/templates/${parsed.data.templateId}?success=${parsed.data.action}`);
}

const updateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable(),
  templateType: z.enum(["services", "consulting", "supply"]).optional(),
  requiredRuleSet: z.string().refine((value) =>
    completenessRuleSets.some((item) => item.id === value),
  ).optional(),
  // Empty means "not provided" — updateTemplateMetadata re-derives the list
  // from the file's actual content in that case, same as upload does.
  requiredPlaceholders: z.array(z.string()).optional(),
});

export async function updateTemplateMetadataAction(formData: FormData) {
  const templateId = formData.get("template_id");
  const requiredPlaceholdersRaw = String(formData.get("required_placeholders") ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const parsed = updateSchema.safeParse({
    templateId,
    name: formData.get("name"),
    description: formData.get("description") || null,
    templateType: formData.get("template_type") || undefined,
    requiredRuleSet: formData.get("required_rule_set") || undefined,
    requiredPlaceholders: requiredPlaceholdersRaw.length ? requiredPlaceholdersRaw : undefined,
  });
  if (!parsed.success) {
    redirect(`/templates/${typeof templateId === "string" ? templateId : ""}?error=${encodeURIComponent("Некорректные данные формы.")}`);
  }
  try {
    await updateTemplateMetadata(parsed.data);
    revalidatePath("/templates");
    revalidatePath(`/templates/${parsed.data.templateId}`);
  } catch (error) {
    redirect(`/templates/${parsed.data.templateId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Template update failed.")}`);
  }
  redirect(`/templates/${parsed.data.templateId}?success=${encodeURIComponent("Шаблон обновлён.")}`);
}

export async function bulkArchiveTemplatesAction(formData: FormData) {
  const parsed = z.object({
    templateIds: z.array(z.string().uuid()).min(1),
  }).safeParse({
    templateIds: formData.getAll("template_ids"),
  });
  if (!parsed.success) redirect("/templates?error=Выберите хотя бы один шаблон.");
  const results = await Promise.allSettled(
    parsed.data.templateIds.map((templateId) => setTemplateLifecycle(templateId, "archive")),
  );
  const failedCount = results.filter((result) => result.status === "rejected").length;
  revalidatePath("/templates");
  if (failedCount > 0) {
    const okCount = results.length - failedCount;
    redirect(`/templates?error=${encodeURIComponent(`Архивировано: ${okCount}. Не удалось: ${failedCount}.`)}`);
  }
  redirect(`/templates?success=${encodeURIComponent(`Архивировано шаблонов: ${results.length}.`)}`);
}
