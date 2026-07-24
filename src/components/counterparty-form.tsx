import type { CounterpartyInput } from "@/modules/counterparties/domain";

const fields: Array<{
  name: keyof CounterpartyInput;
  label: string;
  type?: string;
}> = [
  { name: "legal_name", label: "Полное наименование" },
  { name: "short_name", label: "Краткое наименование" },
  { name: "inn", label: "ИНН" },
  { name: "kpp", label: "КПП" },
  { name: "ogrn", label: "ОГРН" },
  { name: "legal_address", label: "Юридический адрес" },
  { name: "actual_address", label: "Фактический адрес" },
  { name: "bank_name", label: "Банк" },
  { name: "bank_account", label: "Расчётный счёт" },
  { name: "correspondent_account", label: "Корреспондентский счёт" },
  { name: "bik", label: "БИК" },
  { name: "signer_name", label: "ФИО подписанта" },
  { name: "signer_position", label: "Должность подписанта" },
  { name: "signer_authority", label: "Основание полномочий" },
  { name: "contact_name", label: "Контактное лицо" },
  { name: "contact_email", label: "Контактный email", type: "email" },
  { name: "contact_phone", label: "Контактный телефон", type: "tel" },
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
          {counterparty ? "Сохранить контрагента" : "Создать контрагента"}
        </button>
      </div>
    </form>
  );
}
