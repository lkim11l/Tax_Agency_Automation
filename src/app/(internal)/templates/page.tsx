import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import { BulkArchiveSubmitButton, SelectAllCheckbox } from "@/components/template-bulk-actions";
import { TemplateUploadForm } from "@/components/template-upload-form";
import { getOperationalContext } from "@/lib/auth/context";
import {
  formatDateTime,
  getLocale,
  localizeStatus,
  localizeTemplateType,
} from "@/lib/i18n";
import { completenessRuleSets } from "@/modules/clarification/rules";
import { contractPlaceholders, PLACEHOLDER_SCHEMA_VERSION } from "@/modules/contracts/constants";
import { bulkArchiveTemplatesAction, uploadTemplateAction } from "@/modules/templates/actions";
import { listTemplates } from "@/modules/templates/repository";

export const metadata: Metadata = { title: "Шаблоны договоров" };

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const feedback = await searchParams;
  const [templates, { profile }, locale] = await Promise.all([
    listTemplates(),
    getOperationalContext(),
    getLocale(),
  ]);
  const ru = locale === "ru";
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{ru ? "Шаблоны договоров" : "Contract templates"}</h2>
          <p className="muted">
            {ru
              ? "Версии DOCX. Загрузка не означает юридического утверждения."
              : "Versioned DOCX templates. Upload does not imply legal approval."}
          </p>
        </div>
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      {profile.role === "admin" ? (
        <section className="panel section-gap">
          <h3>{ru ? "Загрузить новую версию" : "Upload new template version"}</h3>
          <TemplateUploadForm
            action={uploadTemplateAction}
            ruleSets={completenessRuleSets}
            placeholders={[...contractPlaceholders]}
            ru={ru}
          />
        </section>
      ) : (
        <p className="muted">
          {ru
            ? "Загрузка и изменение шаблонов доступны администратору."
            : "Template upload and lifecycle actions require an administrator."}
        </p>
      )}
      {templates.length === 0 ? (
        <section className="panel empty-state section-gap">
          <h3>{ru ? "Шаблонов пока нет" : "No templates yet"}</h3>
          <p>{ru ? "Администратор может загрузить первый проверенный DOCX-шаблон." : "An administrator can upload the first validated DOCX template."}</p>
        </section>
      ) : (
        <form action={bulkArchiveTemplatesAction} className="section-gap">
          {profile.role === "admin" ? (
            <div className="inline-actions bulk-actions-bar">
              <BulkArchiveSubmitButton
                name="template_ids"
                className="button-danger"
                emptyMessage={ru ? "Выберите хотя бы один шаблон." : "Select at least one template."}
                confirmMessageTemplate={
                  ru
                    ? "Выбрано шаблонов: {count}. Они будут перемещены в архив и станут недоступны для формирования новых договоров. Уже сформированные договоры не изменятся. Продолжить?"
                    : "{count} template(s) selected. They will be archived and no longer selectable for new contract generation. Contracts already generated are unaffected. Continue?"
                }
              >
                {ru ? "Архивировать выбранные" : "Archive selected"}
              </BulkArchiveSubmitButton>
            </div>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {profile.role === "admin" ? (
                    <th className="checkbox-column"><SelectAllCheckbox name="template_ids" /></th>
                  ) : null}
                  <th>{ru ? "Название" : "Name"}</th>
                  <th>{ru ? "Тип" : "Type"}</th>
                  <th>{ru ? "Версия" : "Version"}</th>
                  <th>{ru ? "Статус" : "Status"}</th>
                  <th>SHA-256</th>
                  <th>{ru ? "Проверка" : "Validation"}</th>
                  <th>{ru ? "Совместимость" : "Compatibility"}</th>
                  <th>{ru ? "Обновлено" : "Updated"}</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => {
                  const schemaOutdated = template.placeholder_schema_version !== PLACEHOLDER_SCHEMA_VERSION;
                  return (
                  <tr key={template.id} className={schemaOutdated ? "row-attention" : undefined}>
                    {profile.role === "admin" ? (
                      <td className="checkbox-column">
                        {template.status !== "archived" ? (
                          <input type="checkbox" name="template_ids" value={template.id} aria-label={ru ? `Выбрать ${template.name}` : `Select ${template.name}`} />
                        ) : null}
                      </td>
                    ) : null}
                    <td><Link href={`/templates/${template.id}`}>{template.name}</Link></td>
                    <td>{template.template_type ? localizeTemplateType(template.template_type, locale) : "—"}</td>
                    <td>{template.version}</td>
                    <td>
                      <div className="status-stack">
                        <span className={`badge badge-${template.status}`}>{localizeStatus(template.status, locale)}</span>
                        <span className={`badge badge-sub badge-${template.legal_approval_status}`}>{localizeStatus(template.legal_approval_status, locale)}</span>
                      </div>
                    </td>
                    <td><code>{template.checksum?.slice(0, 12) ?? "—"}</code></td>
                    <td>{template.validation_report?.valid ? (ru ? "Пройдена" : "Passed") : (ru ? "Заблокирован" : "Blocked")}</td>
                    <td>
                      {schemaOutdated ? (
                        <span className="badge badge-failed">
                          {ru ? "Требуется новая версия" : "New version required"}
                        </span>
                      ) : (
                        <span className="badge badge-approved">{ru ? "Актуален" : "Up to date"}</span>
                      )}
                    </td>
                    <td>{formatDateTime(template.updated_at, locale)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </>
  );
}
