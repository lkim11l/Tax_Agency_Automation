import { z } from "zod";

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required.").max(200),
  description: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().max(2000).nullable(),
  ),
  version: z.string().trim().min(1, "Version is required.").max(50),
  status: z.enum(["draft", "archived"]),
  required_fields: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  is_active: z.boolean(),
});

export type TemplateInput = z.infer<typeof templateSchema>;

export function templateFormValues(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description"),
    version: formData.get("version"),
    status: formData.get("status"),
    required_fields: formData.get("required_fields"),
    is_active: formData.get("is_active") === "on",
  };
}
