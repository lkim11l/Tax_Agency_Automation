import type { ApplicationDetail } from "@/modules/applications/repository";
import { applicationPriorities, supportedCurrencies } from "@/modules/applications/domain";

type Option = { id: string; label: string };

export function ApplicationForm({
  action,
  application,
  counterparties,
  profiles,
  templates,
}: {
  action: (formData: FormData) => void | Promise<void>;
  application?: ApplicationDetail;
  counterparties: Option[];
  profiles: Option[];
  templates: Option[];
}) {
  return (
    <form action={action} className="form-grid">
      {application ? (
        <input type="hidden" name="application_id" value={application.id} />
      ) : null}

      <label className="field field-wide">
        Title
        <input name="title" required maxLength={200} defaultValue={application?.title} />
      </label>

      <label className="field">
        Received at
        <input
          type="datetime-local"
          name="received_at"
          required
          defaultValue={
            application?.received_at.slice(0, 16) ??
            new Date().toISOString().slice(0, 16)
          }
        />
      </label>

      <label className="field">
        Priority
        <select name="priority" defaultValue={application?.priority ?? "normal"}>
          {applicationPriorities.map((priority) => (
            <option value={priority} key={priority}>
              {priority}
            </option>
          ))}
        </select>
      </label>

      <label className="field field-wide">
        Contract subject
        <textarea
          name="contract_subject"
          rows={3}
          defaultValue={application?.contract_subject ?? ""}
        />
      </label>

      <label className="field">
        Amount
        <input
          type="number"
          name="contract_amount"
          min="0"
          step="0.01"
          defaultValue={application?.contract_amount ?? ""}
        />
      </label>

      <label className="field">
        Currency
        <select name="currency" defaultValue={application?.currency ?? ""}>
          <option value="">Not specified</option>
          {supportedCurrencies.map((currency) => (
            <option value={currency} key={currency}>
              {currency}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Performance start
        <input
          type="date"
          name="performance_start_date"
          defaultValue={application?.performance_start_date ?? ""}
        />
      </label>

      <label className="field">
        Performance end
        <input
          type="date"
          name="performance_end_date"
          defaultValue={application?.performance_end_date ?? ""}
        />
      </label>

      <label className="field field-wide">
        Payment terms
        <textarea
          name="payment_terms"
          rows={3}
          defaultValue={application?.payment_terms ?? ""}
        />
      </label>

      <label className="field">
        Counterparty
        <select
          name="counterparty_id"
          defaultValue={application?.counterparty_id ?? ""}
        >
          <option value="">Not assigned</option>
          {counterparties.map((option) => (
            <option value={option.id} key={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Responsible specialist
        <select name="assigned_to" defaultValue={application?.assigned_to ?? ""}>
          <option value="">Not assigned</option>
          {profiles.map((option) => (
            <option value={option.id} key={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field field-wide">
        Contract template metadata
        <select
          name="contract_template_id"
          defaultValue={application?.contract_template_id ?? ""}
        >
          <option value="">Not selected</option>
          {templates.map((option) => (
            <option value={option.id} key={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field field-wide">
        Internal notes
        <textarea
          name="internal_notes"
          rows={5}
          defaultValue={application?.internal_notes ?? ""}
        />
      </label>

      <div className="field-wide">
        <button type="submit">{application ? "Save application" : "Create application"}</button>
      </div>
    </form>
  );
}
