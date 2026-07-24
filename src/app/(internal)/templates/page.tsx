import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import { TemplateUploadForm } from "@/components/template-upload-form";
import { getOperationalContext } from "@/lib/auth/context";
import {
  formatDateTime,
  getLocale,
  localizeStatus,
  localizeTemplateType,
} from "@/lib/i18n";
import { completenessRuleSets } from "@/modules/clarification/rules";
import { contractPlaceholders } from "@/modules/contracts/constants";
import { uploadTemplateAction } from "@/modules/templates/actions";
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
        <div className="table-wrap section-gap">
          <table>
            <thead>
              <tr>
                <th>{ru ? "Название" : "Name"}</th>
                <th>{ru ? "Тип" : "Type"}</th>
                <th>{ru ? "Версия" : "Version"}</th>
                <th>{ru ? "Статус" : "Status"}</th>
                <th>{ru ? "Юридический статус" : "Legal status"}</th>
                <th>SHA-256</th>
                <th>{ru ? "Проверка" : "Validation"}</th>
                <th>{ru ? "Обновлено" : "Updated"}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td><Link href={`/templates/${template.id}`}>{template.name}</Link></td>
                  <td>{template.template_type ? localizeTemplateType(template.template_type, locale) : "—"}</td>
                  <td>{template.version}</td>
                  <td><span className={`badge badge-${template.status}`}>{localizeStatus(template.status, locale)}</span></td>
                  <td>{localizeStatus(template.legal_approval_status, locale)}</td>
                  <td><code>{template.checksum?.slice(0, 12) ?? "—"}</code></td>
                  <td>{template.validation_report?.valid ? (ru ? "Пройдена" : "Passed") : (ru ? "Заблокирован" : "Blocked")}</td>
                  <td>{formatDateTime(template.updated_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
