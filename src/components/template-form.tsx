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
        Название
        <input name="name" required defaultValue={template?.name} />
      </label>
      <label className="field">
        Версия
        <input name="version" required defaultValue={template?.version ?? "0.1"} />
      </label>
      <label className="field field-wide">
        Описание
        <textarea name="description" rows={3} defaultValue={template?.description ?? ""} />
      </label>
      <label className="field">
        Статус
        <select
          name="status"
          defaultValue={
            template?.status === "archived" ? "archived" : "draft"
          }
        >
          <option value="draft">Черновик</option>
          <option value="archived">Архивный</option>
        </select>
      </label>
      <label className="field checkbox-field">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={template?.is_active ?? false}
        />
        Активен
      </label>
      <label className="field field-wide">
        Обязательные поля (через запятую)
        <input
          name="required_fields"
          defaultValue={template?.required_fields.join(", ") ?? ""}
        />
      </label>
      <p className="muted field-wide">
        Утверждённый статус доступен только для реально загруженного DOCX.
      </p>
      <div className="field-wide">
        <button type="submit">{template ? "Сохранить" : "Создать"}</button>
      </div>
    </form>
  );
}
