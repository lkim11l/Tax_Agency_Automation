import Link from "next/link";
import { notFound } from "next/navigation";

import { Feedback } from "@/components/feedback";
import { getOperationalContext } from "@/lib/auth/context";
import { getLocale, localizeStatus, localizeTemplateType } from "@/lib/i18n";
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
        <dl className="summary-grid">
          <div><dt>{ru ? "Статус" : "Status"}</dt><dd className="summary-text">{localizeStatus(template.status, locale)}</dd></div>
          <div><dt>{ru ? "Юридический статус" : "Legal status"}</dt><dd className="summary-text">{localizeStatus(template.legal_approval_status, locale)}</dd></div>
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
        <h3>{ru ? "Отчёт проверки" : "Validation report"}</h3>
        <p>{report.valid ? (ru ? "Проверка пройдена" : "Passed") : (ru ? "Есть блокирующие ошибки" : "Blocking errors present")}</p>
        {report.errors?.length ? <ul>{report.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        {report.warnings?.length ? <ul>{report.warnings.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        <h3>{ru ? "Поля шаблона" : "Placeholders"}</h3>
        <p>{report.placeholders?.join(", ") || (ru ? "Нет" : "None")}</p>
        {profile.role === "admin" ? (
          <div className="inline-actions">
            {template.status === "awaiting_approval" && report.valid ? <form action={templateLifecycleAction}><input type="hidden" name="template_id" value={id}/><input type="hidden" name="lifecycle_action" value="approve"/><button>{ru ? "Технически одобрить" : "Approve technically"}</button></form> : null}
            {template.status === "approved" ? <form action={templateLifecycleAction}><input type="hidden" name="template_id" value={id}/><input type="hidden" name="lifecycle_action" value="deactivate"/><button>{ru ? "Деактивировать" : "Deactivate"}</button></form> : null}
            {!["archived", "approved"].includes(template.status) ? <form action={templateLifecycleAction}><input type="hidden" name="template_id" value={id}/><input type="hidden" name="lifecycle_action" value="archive"/><button>{ru ? "В архив" : "Archive"}</button></form> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
