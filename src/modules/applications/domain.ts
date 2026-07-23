import { z } from "zod";

export const applicationStatuses = [
  "new",
  "processing",
  "needs_data_review",
  "waiting_for_client",
  "data_complete",
  "generating_contract",
  "contract_ready",
  "under_review",
  "needs_revision",
  "approved",
  "sending",
  "sent",
  "completed",
  "processing_error",
  "cancelled",
] as const;

export const applicationPriorities = ["low", "normal", "high", "urgent"] as const;
export const supportedCurrencies = ["RUB", "USD", "EUR", "KZT"] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];
export type ApplicationPriority = (typeof applicationPriorities)[number];

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );

const nullableUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid().nullable(),
);

const nullableDate = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD date format.")
    .nullable(),
);

const nullableAmount = z.preprocess(
  (value) => (value === "" || value === null ? null : Number(value)),
  z.number().finite().nonnegative("Amount cannot be negative.").nullable(),
);

export const applicationInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    received_at: z.coerce.date(),
    priority: z.enum(applicationPriorities),
    contract_subject: nullableText(2000),
    contract_amount: nullableAmount,
    currency: z.preprocess(
      (value) => (value === "" ? null : value),
      z.enum(supportedCurrencies).nullable(),
    ),
    performance_start_date: nullableDate,
    performance_end_date: nullableDate,
    payment_terms: nullableText(4000),
    counterparty_id: nullableUuid,
    assigned_to: nullableUuid,
    contract_template_id: nullableUuid,
    internal_notes: nullableText(10000),
  })
  .superRefine((value, context) => {
    if (
      value.performance_start_date &&
      value.performance_end_date &&
      value.performance_end_date < value.performance_start_date
    ) {
      context.addIssue({
        code: "custom",
        path: ["performance_end_date"],
        message: "End date cannot be earlier than start date.",
      });
    }

    if (value.contract_amount !== null && value.currency === null) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Currency is required when an amount is provided.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    received_at: value.received_at.toISOString(),
  }));

export type ApplicationInput = z.infer<typeof applicationInputSchema>;

export const statusChangeSchema = z.object({
  application_id: z.uuid(),
  status: z.enum(applicationStatuses),
  reason: nullableText(1000),
});

export const noteSchema = z.object({
  application_id: z.uuid(),
  note: z.string().trim().min(1, "Comment must not be empty.").max(4000),
});

export function applicationFormValues(formData: FormData) {
  return {
    title: formData.get("title"),
    received_at: formData.get("received_at"),
    priority: formData.get("priority"),
    contract_subject: formData.get("contract_subject"),
    contract_amount: formData.get("contract_amount"),
    currency: formData.get("currency"),
    performance_start_date: formData.get("performance_start_date"),
    performance_end_date: formData.get("performance_end_date"),
    payment_terms: formData.get("payment_terms"),
    counterparty_id: formData.get("counterparty_id"),
    assigned_to: formData.get("assigned_to"),
    contract_template_id: formData.get("contract_template_id"),
    internal_notes: formData.get("internal_notes"),
  };
}

export function isApplicationNumber(value: string): boolean {
  return /^REQ-\d{4}-\d{6,}$/.test(value);
}

export function formatValidationError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(" ");
}
