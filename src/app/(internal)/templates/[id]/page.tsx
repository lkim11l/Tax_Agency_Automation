import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Feedback } from "@/components/feedback";
import { getOperationalContext } from "@/lib/auth/context";
import { getLocale, localizeStatus, localizeTemplateType } from "@/lib/i18n";
import { getTemplateRuntimeStatus } from "@/modules/contracts/service";
import { templateLifecycleAction } from "@/modules/templates/actions";
import { getTemplate } from "@/modules/templates/repository";

export default async function TemplateDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  const [template, { profile }, locale] = await Promise.all([
    getTemplate(id),
    getOperationalContext(),
    getLocale(),
  ]);
  if (!template) notFound();
  const report = template.validation_report ?? {};
  const ru = locale === "ru";
  // Read-only: re-downloads the actual Storage file and re-runs the current
  // validateDocxTemplate against it — never trusts status=approved alone.
  const runtimeStatus = await getTemplateRuntimeStatus(id);
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{template.name}</h2>
          <p className="muted">{template.code} · {template.template_type ? localizeTemplateType(template.template_type, locale) : "—"} · v{template.version}</p>
        </div>
        <Link href="/templates">{ru ? "Назад" : "Back"}</Link>
      </div>
      <Feedback {...feedback} />
      <section className="panel registry-panel">
        <div className="two-column">
          <div className="subpanel">
            <h3>{ru ? "Сведения о шаблоне" : "Template details"}</h3>
            <dl className="summary-grid summary-grid-tight">
              <div>
                <dt>{ru ? "Статус" : "Status"}</dt>
                <dd className="summary-text">
                  <span className={`badge badge-${template.status}`}>{localizeStatus(template.status, locale)}</span>
                </dd>
              </div>
              <div>
                <dt>{ru ? "Юридический статус" : "Legal status"}</dt>
                <dd className="summary-text">
                  <span className={`badge badge-${template.legal_approval_status}`}>{localizeStatus(template.legal_approval_status, locale)}</span>
                </dd>
              </div>
              <div><dt>SHA-256</dt><dd className="summary-text"><code>{template.checksum ?? "—"}</code></dd></div>
              <div><dt>{ru ? "Файл" : "File"}</dt><dd className="summary-text">{template.original_filename ?? "—"}</dd></div>
              <div><dt>{ru ? "Набор правил" : "Rule set"}</dt><dd className="summary-text">{template.required_rule_set ?? "—"}</dd></div>
              <div><dt>{ru ? "Загрузил" : "Uploaded by"}</dt><dd className="summary-text">{template.creator?.[0]?.full_name ?? template.creator?.[0]?.email ?? "—"}</dd></div>
            </dl>
            {template.legal_approval_status !== "approved" ? (
              <p className="alert alert-warning">
                {ru
                  ? "Ожидает утверждения заказчиком. Отправка договора реальному клиенту заблокирована."
                  : "Pending customer approval. Delivery to a real client is blocked."}
              </p>
            ) : null}
          </div>
          <div className="subpanel">
            <h3>{ru ? "Проверка при генерации (в реальном времени)" : "Generation-time check (live)"}</h3>
            <p className="muted">
              {ru
                ? "Файл заново скачивается из Storage и проверяется текущей логикой перед каждым формированием договора — статус «Одобрен» сам по себе недостаточен."
                : "The file is re-downloaded from Storage and re-checked with the current logic before every generation — status=approved alone is not enough."}
            </p>
            {runtimeStatus.ok ? (
              <p className="alert alert-success">{ru ? "Шаблон актуален и проходит проверку." : "Template is current and passes the check."}</p>
            ) : (
              <div className="alert alert-error">
                <strong>{ru ? "Требуется новая версия" : "New version required"}</strong>
                <p>
                  {ru
                    ? "Этот шаблон нельзя использовать для формирования договора, пока администратор не загрузит и не одобрит новую версию."
                    : "This template cannot be used for generation until an administrator uploads and approves a new version."}
                </p>
                <ul>{runtimeStatus.reasons.map((reason) => <li key={reason}><code>{reason}</code></li>)}</ul>
              </div>
            )}
            <dl className="summary-grid summary-grid-tight">
              <div>
                <dt>{ru ? "Текущая версия схемы плейсхолдеров" : "Current placeholder schema version"}</dt>
                <dd className="summary-text"><code>{runtimeStatus.currentPlaceholderSchemaVersion ?? "—"}</code></dd>
              </div>
              <div>
                <dt>{ru ? "Требуемая версия схемы" : "Required schema version"}</dt>
                <dd className="summary-text"><code>{runtimeStatus.requiredPlaceholderSchemaVersion}</code></dd>
              </div>
            </dl>
          </div>
        </div>
        <h3>{ru ? "Отчёт проверки" : "Validation report"}</h3>
        <p>{report.valid ? (ru ? "Проверка пройдена" : "Passed") : (ru ? "Есть блокирующие ошибки" : "Blocking errors present")}</p>
        {report.errors?.length ? <ul>{report.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        {report.warnings?.length ? <ul>{report.warnings.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        <h3>{ru ? "Поля шаблона" : "Placeholders"}</h3>
        <p>{report.placeholders?.join(", ") || (ru ? "Нет" : "None")}</p>
        {profile.role === "admin" ? (
          <div className="inline-actions actions-footer">
            {template.status === "awaiting_approval" && report.valid ? (
              <form action={templateLifecycleAction}>
                <input type="hidden" name="template_id" value={id} />
                <input type="hidden" name="lifecycle_action" value="approve" />
                <button>{ru ? "Технически одобрить" : "Approve technically"}</button>
              </form>
            ) : null}
            {template.status === "approved" ? (
              <form action={templateLifecycleAction}>
                <input type="hidden" name="template_id" value={id} />
                <input type="hidden" name="lifecycle_action" value="deactivate" />
                <button className="button-secondary">{ru ? "Деактивировать" : "Deactivate"}</button>
              </form>
            ) : null}
            {template.status !== "archived" ? (
              <form action={templateLifecycleAction}>
                <input type="hidden" name="template_id" value={id} />
                <input type="hidden" name="lifecycle_action" value="archive" />
                <ConfirmSubmitButton
                  className="button-danger"
                  confirmMessage={
                    ru
                      ? "Шаблон будет перемещён в архив: он станет недоступен для формирования новых договоров. Уже сформированные договоры не изменятся. Продолжить?"
                      : "The template will be archived and will no longer be selectable for new contract generation. Contracts already generated from it are unaffected. Continue?"
                  }
                >
                  {ru ? "Архивировать" : "Archive"}
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
