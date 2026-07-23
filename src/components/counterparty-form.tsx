import type { CounterpartyInput } from "@/modules/counterparties/domain";

const fields: Array<{
  name: keyof CounterpartyInput;
  label: string;
  type?: string;
}> = [
  { name: "legal_name", label: "Legal name" },
  { name: "short_name", label: "Short name" },
  { name: "inn", label: "INN" },
  { name: "kpp", label: "KPP" },
  { name: "ogrn", label: "OGRN" },
  { name: "legal_address", label: "Legal address" },
  { name: "actual_address", label: "Actual address" },
  { name: "bank_name", label: "Bank name" },
  { name: "bank_account", label: "Bank account" },
  { name: "correspondent_account", label: "Correspondent account" },
  { name: "bik", label: "BIK" },
  { name: "signer_name", label: "Signer name" },
  { name: "signer_position", label: "Signer position" },
  { name: "signer_authority", label: "Signer authority" },
  { name: "contact_name", label: "Contact name" },
  { name: "contact_email", label: "Contact email", type: "email" },
  { name: "contact_phone", label: "Contact phone", type: "tel" },
];

export function CounterpartyForm({
  action,
  counterparty,
}: {
  action: (formData: FormData) => void | Promise<void>;
  counterparty?: CounterpartyInput & { id: string };
}) {
  return (
    <form action={action} className="form-grid">
      {counterparty ? (
        <input type="hidden" name="counterparty_id" value={counterparty.id} />
      ) : null}
      {fields.map((field) => (
        <label className="field" key={field.name}>
          {field.label}
          <input
            name={field.name}
            type={field.type ?? "text"}
            required={field.name === "legal_name"}
            defaultValue={counterparty?.[field.name] ?? ""}
          />
        </label>
      ))}
      <div className="field-wide">
        <button type="submit">
          {counterparty ? "Save counterparty" : "Create counterparty"}
        </button>
      </div>
    </form>
  );
}
