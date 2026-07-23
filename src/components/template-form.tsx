import type { TemplateListItem } from "@/modules/templates/repository";

export function TemplateForm({
  action,
  template,
}: {
  action: (formData: FormData) => void | Promise<void>;
  template?: TemplateListItem;
}) {
  return (
    <form action={action} className="form-grid">
      {template ? <input type="hidden" name="template_id" value={template.id} /> : null}
      <label className="field">
        Name
        <input name="name" required defaultValue={template?.name} />
      </label>
      <label className="field">
        Version
        <input name="version" required defaultValue={template?.version ?? "0.1"} />
      </label>
      <label className="field field-wide">
        Description
        <textarea name="description" rows={3} defaultValue={template?.description ?? ""} />
      </label>
      <label className="field">
        Status
        <select
          name="status"
          defaultValue={
            template?.status === "archived" ? "archived" : "draft"
          }
        >
          <option value="draft">draft</option>
          <option value="archived">archived</option>
        </select>
      </label>
      <label className="field checkbox-field">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={template?.is_active ?? false}
        />
        Active metadata
      </label>
      <label className="field field-wide">
        Required fields (comma separated)
        <input
          name="required_fields"
          defaultValue={template?.required_fields.join(", ") ?? ""}
        />
      </label>
      <p className="muted field-wide">
        DOCX upload and generation are not available in Phase 1. Approved status
        requires a real storage path and is intentionally not offered here.
      </p>
      <div className="field-wide">
        <button type="submit">{template ? "Save metadata" : "Create metadata"}</button>
      </div>
    </form>
  );
}
