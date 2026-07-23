"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  approveTemplate,
  setTemplateLifecycle,
  uploadTemplateVersion,
} from "@/modules/contracts/service";
import { completenessRuleSets } from "@/modules/clarification/rules";

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,99}$/u),
  description: z.string().trim().max(2000).nullable(),
  templateType: z.enum(["services", "consulting", "supply"]),
  version: z.string().trim().min(1).max(50),
  requiredRuleSet: z.string().refine((value) =>
    completenessRuleSets.some((item) => item.id === value),
  ),
  requiredPlaceholders: z.array(z.string()).min(1).max(100),
});

export async function uploadTemplateAction(formData: FormData) {
  const file = formData.get("file");
  const parsed = uploadSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    description: formData.get("description") || null,
    templateType: formData.get("template_type"),
    version: formData.get("version"),
    requiredRuleSet: formData.get("required_rule_set"),
    requiredPlaceholders: String(formData.get("required_placeholders") ?? "")
      .split(",").map((item) => item.trim()).filter(Boolean),
  });
  if (!parsed.success || !(file instanceof File) || file.size === 0 || file.size > 10_485_760) {
    redirect("/templates?error=Invalid template upload.");
  }
  let destination: string;
  try {
    const result = await uploadTemplateVersion({
      ...parsed.data,
      filename: file.name,
      mimeType: file.type,
      content: Buffer.from(await file.arrayBuffer()),
    });
    revalidatePath("/templates");
    destination = `/templates/${result.templateId}?success=uploaded`;
  } catch (error) {
    destination = `/templates?error=${encodeURIComponent(error instanceof Error ? error.message : "Template upload failed.")}`;
  }
  redirect(destination);
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
