import { z } from "zod";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );

export const counterpartySchema = z.object({
  legal_name: z.string().trim().min(1, "Legal name is required.").max(300),
  short_name: optionalText(200),
  inn: z.preprocess(
    (value) => (value === "" ? null : value),
    z
      .string()
      .regex(/^\d{10}(\d{2})?$/, "INN must contain 10 or 12 digits.")
      .nullable(),
  ),
  kpp: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().regex(/^\d{9}$/, "KPP must contain 9 digits.").nullable(),
  ),
  ogrn: z.preprocess(
    (value) => (value === "" ? null : value),
    z
      .string()
      .regex(/^\d{13}(\d{2})?$/, "OGRN must contain 13 or 15 digits.")
      .nullable(),
  ),
  legal_address: optionalText(1000),
  actual_address: optionalText(1000),
  bank_name: optionalText(300),
  bank_account: optionalText(50),
  correspondent_account: optionalText(50),
  bik: optionalText(20),
  signer_name: optionalText(200),
  signer_position: optionalText(200),
  signer_authority: optionalText(500),
  contact_name: optionalText(200),
  contact_email: z.preprocess(
    (value) => (value === "" ? null : value),
    z.email().nullable(),
  ),
  contact_phone: optionalText(50),
});

export type CounterpartyInput = z.infer<typeof counterpartySchema>;

export function counterpartyFormValues(formData: FormData) {
  return Object.fromEntries(
    [
      "legal_name",
      "short_name",
      "inn",
      "kpp",
      "ogrn",
      "legal_address",
      "actual_address",
      "bank_name",
      "bank_account",
      "correspondent_account",
      "bik",
      "signer_name",
      "signer_position",
      "signer_authority",
      "contact_name",
      "contact_email",
      "contact_phone",
    ].map((key) => [key, formData.get(key)]),
  );
}
