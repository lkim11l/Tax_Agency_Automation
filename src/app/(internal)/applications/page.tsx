import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  getLocale,
  localizePriority,
  localizeStatus,
} from "@/lib/i18n";
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
      <Feedback error={params.error} />
      <section className="panel registry-panel">
        <h3>{ru ? "Фильтры" : "Filters"}</h3>
        <form className="filter-grid">
          <label className="field">{ru ? "Номер" : "Number"}<input name="number" defaultValue={params.number} /></label>
          <label className="field">{ru ? "Название" : "Title"}<input name="title" defaultValue={params.title} /></label>
          <label className="field">{ru ? "Контрагент или ИНН" : "Counterparty or tax ID"}<input name="counterparty" defaultValue={params.counterparty} /></label>
          <label className="field">
            {ru ? "Статус" : "Status"}
            <select name="status" defaultValue={filters.status ?? ""}>
              <option value="">{ru ? "Все статусы" : "All statuses"}</option>
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
          <div className="filter-actions"><button type="submit">{ru ? "Применить" : "Apply"}</button><Link href="/applications">{ru ? "Сбросить" : "Reset"}</Link></div>
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
        <div className="table-wrap section-gap">
          <table>
            <thead><tr><th>{ru ? "Номер" : "Number"}</th><th>{ru ? "Название / предмет" : "Title / subject"}</th><th>{ru ? "Контрагент" : "Counterparty"}</th><th>{ru ? "Статус" : "Status"}</th><th>{ru ? "Приоритет" : "Priority"}</th><th>{ru ? "Сумма" : "Amount"}</th><th>{ru ? "Получено" : "Received"}</th><th>{ru ? "Ответственный" : "Responsible"}</th><th>{ru ? "Обновлено" : "Updated"}</th></tr></thead>
            <tbody>{state.items.map((application) => (
              <tr key={application.id}>
                <td><Link href={`/applications/${application.id}`}>{application.application_number}</Link></td>
                <td>{application.title || application.contract_subject || "—"}</td>
                <td>{application.counterparty?.legal_name ?? "—"}</td>
                <td><span className={`badge badge-${application.status}`}>{localizeStatus(application.status, locale)}</span></td>
                <td>{localizePriority(application.priority, locale)}</td>
                <td>{formatAmount(application.contract_amount, application.currency, locale)}</td>
                <td>{formatDate(application.received_at, locale)}</td>
                <td>{application.assignee?.full_name ?? application.assignee?.email ?? "—"}</td>
                <td>{formatDateTime(application.updated_at, locale)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
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
