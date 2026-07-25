import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import { BulkArchiveSubmitButton, SelectAllCheckbox } from "@/components/template-bulk-actions";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  getLocale,
  localizePriority,
  localizeStatus,
} from "@/lib/i18n";
import { bulkArchiveApplicationsAction } from "@/modules/applications/actions";
import { applicationStatuses, type ApplicationStatus } from "@/modules/applications/domain";
import { listApplications, listAssignableProfiles } from "@/modules/applications/repository";

export const metadata: Metadata = { title: "Заявки" };
type Props = { searchParams: Promise<Record<string, string | undefined>> };

function isStatus(value: string | undefined): value is ApplicationStatus {
  return applicationStatuses.includes(value as ApplicationStatus);
}

function pageUrl(params: Record<string, string | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") query.set(key, value);
  }
  query.set("page", String(page));
  return `?${query.toString()}`;
}

export default async function ApplicationsPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = {
    number: params.number,
    title: params.title,
    counterparty: params.counterparty,
    status: isStatus(params.status) ? params.status : undefined,
    assignedTo: params.assigned_to,
    dateFrom: params.date_from,
    dateTo: params.date_to,
    page: Math.max(1, Number(params.page) || 1),
    pageSize: 25,
  };
  const viewingArchive = filters.status === "archived";
  const [result, profiles, locale] = await Promise.all([
    listApplications(filters),
    listAssignableProfiles(),
    getLocale(),
  ]);
  const { state } = result;
  const ru = locale === "ru";
  return (
    <>
      <div className="page-heading">
        <div><h2>{ru ? "Заявки" : "Applications"}</h2><p className="muted">{ru ? "Рабочая очередь заявок и договоров." : "Application and contract work queue."}</p></div>
        <Link className="button-link" href="/applications/new">{ru ? "Создать заявку" : "Create application"}</Link>
      </div>
      <Feedback error={params.error} success={params.success} />
      <section className="panel registry-panel">
        <h3>{ru ? "Фильтры" : "Filters"}</h3>
        <form className="filter-grid">
          <label className="field">{ru ? "Номер" : "Number"}<input name="number" defaultValue={params.number} /></label>
          <label className="field">{ru ? "Название" : "Title"}<input name="title" defaultValue={params.title} /></label>
          <label className="field">{ru ? "Контрагент или ИНН" : "Counterparty or tax ID"}<input name="counterparty" defaultValue={params.counterparty} /></label>
          <label className="field">
            {ru ? "Статус" : "Status"}
            <select name="status" defaultValue={filters.status ?? ""}>
              <option value="">{ru ? "Все статусы (кроме архива)" : "All statuses (except archive)"}</option>
              {applicationStatuses.map((status) => <option value={status} key={status}>{localizeStatus(status, locale)}</option>)}
            </select>
          </label>
          <label className="field">
            {ru ? "Ответственный" : "Responsible specialist"}
            <select name="assigned_to" defaultValue={params.assigned_to ?? ""}>
              <option value="">{ru ? "Все специалисты" : "All specialists"}</option>
              {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.full_name ?? profile.email}</option>)}
            </select>
          </label>
          <label className="field">{ru ? "Получено с" : "Received from"}<input type="date" name="date_from" defaultValue={params.date_from} /></label>
          <label className="field">{ru ? "Получено по" : "Received to"}<input type="date" name="date_to" defaultValue={params.date_to} /></label>
          <div className="filter-actions">
            <button type="submit">{ru ? "Применить" : "Apply"}</button>
            <Link href="/applications">{ru ? "Сбросить" : "Reset"}</Link>
            {!viewingArchive ? (
              <Link href="/applications?status=archived">{ru ? "Показать архив" : "Show archive"}</Link>
            ) : null}
          </div>
        </form>
      </section>
      {state.kind === "error" ? (
        <p className="alert alert-error" role="alert">{ru ? "Не удалось загрузить заявки." : "Unable to load applications."}</p>
      ) : state.kind === "empty" ? (
        <section className="panel empty-state section-gap">
          <h3>{ru ? "Заявок не найдено" : "No applications found"}</h3>
          <p>{ru ? "Измените фильтры, проверьте почту или создайте заявку вручную." : "Change filters, check mail, or create an application."}</p>
        </section>
      ) : (
        <form action={bulkArchiveApplicationsAction} className="section-gap">
          {!viewingArchive ? (
            <div className="inline-actions bulk-actions-bar">
              <label className="inline-actions">
                <SelectAllCheckbox name="application_ids" />
                <span className="muted">{ru ? "Выбрать все" : "Select all"}</span>
              </label>
              <BulkArchiveSubmitButton
                name="application_ids"
                className="button-danger"
                emptyMessage={ru ? "Выберите хотя бы одну заявку." : "Select at least one application."}
                confirmMessageTemplate={
                  ru
                    ? "Выбрано заявок: {count}. Они будут перемещены в архив и скрыты из основного списка. Продолжить?"
                    : "{count} application(s) selected. They will be archived and hidden from the main list. Continue?"
                }
              >
                {ru ? "Архивировать выбранные" : "Archive selected"}
              </BulkArchiveSubmitButton>
            </div>
          ) : null}
          <div className="template-card-grid">
            {state.items.map((application) => (
              <article className="template-card" key={application.id}>
                <div className="template-card-header">
                  {!viewingArchive ? (
                    <input
                      type="checkbox"
                      name="application_ids"
                      value={application.id}
                      aria-label={ru ? `Выбрать ${application.application_number}` : `Select ${application.application_number}`}
                    />
                  ) : null}
                  <div>
                    <Link href={`/applications/${application.id}`} className="template-card-title">{application.application_number}</Link>
                    <p className="muted">{application.title || application.contract_subject || "—"}</p>
                  </div>
                </div>
                <div className="status-stack">
                  <span className={`badge badge-${application.status}`}>{localizeStatus(application.status, locale)}</span>
                  <span className="badge badge-sub badge-neutral">{localizePriority(application.priority, locale)}</span>
                </div>
                <dl className="template-card-meta">
                  <div>
                    <dt>{ru ? "Контрагент" : "Counterparty"}</dt>
                    <dd>{application.counterparty?.legal_name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{ru ? "Сумма" : "Amount"}</dt>
                    <dd>{formatAmount(application.contract_amount, application.currency, locale)}</dd>
                  </div>
                  <div>
                    <dt>{ru ? "Получено" : "Received"}</dt>
                    <dd>{formatDate(application.received_at, locale)}</dd>
                  </div>
                  <div>
                    <dt>{ru ? "Ответственный" : "Responsible"}</dt>
                    <dd>{application.assignee?.full_name ?? application.assignee?.email ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{ru ? "Обновлено" : "Updated"}</dt>
                    <dd>{formatDateTime(application.updated_at, locale)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </form>
      )}
      {state.kind !== "error" ? (
        <nav className="pagination" aria-label={ru ? "Страницы заявок" : "Application pages"}>
          {result.page > 1 ? <Link href={pageUrl(params, result.page - 1)}>{ru ? "Назад" : "Previous"}</Link> : <span />}
          <span>{ru ? `Страница ${result.page} из ${result.pageCount} · ${result.count} записей` : `Page ${result.page} of ${result.pageCount} · ${result.count} records`}</span>
          {result.page < result.pageCount ? <Link href={pageUrl(params, result.page + 1)}>{ru ? "Вперёд" : "Next"}</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
