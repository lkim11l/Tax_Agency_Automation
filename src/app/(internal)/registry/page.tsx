import type { Metadata } from "next";
import Link from "next/link";

import { getLocale, localizeStatus } from "@/lib/i18n";
import { listAssignableProfiles } from "@/modules/applications/repository";
import { parseRegistryFilters } from "@/modules/reports/domain";
import { listRegistry } from "@/modules/reports/repository";

export const metadata: Metadata = { title: "Реестр договоров" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function query(filters: ReturnType<typeof parseRegistryFilters>, page: number) {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) {
    if (value !== undefined) values.set(key, String(value));
  }
  return `?${values.toString()}`;
}

export default async function RegistryPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = parseRegistryFilters(params);
  const [result, profiles, locale] = await Promise.all([listRegistry(filters), listAssignableProfiles(), getLocale()]);
  const ru = locale === "ru";
  return (
    <>
      <div className="page-heading">
        <div><h2>{ru ? "Реестр договоров" : "Contract registry"}</h2><p className="muted">{ru ? "Операционный реестр с серверной фильтрацией." : "Server-filtered operational registry."}</p></div>
        <Link href="/reports">{ru ? "Ежемесячные отчёты" : "Monthly reports"}</Link>
      </div>
      <section className="panel registry-panel">
        <h3>{ru ? "Фильтры" : "Filters"}</h3>
        <form className="filter-grid">
          <label className="field">С<input type="date" name="dateFrom" defaultValue={filters.dateFrom} /></label>
          <label className="field">По<input type="date" name="dateTo" defaultValue={filters.dateTo} /></label>
          <label className="field">Номер заявки<input name="applicationNumber" defaultValue={filters.applicationNumber} /></label>
          <label className="field">Номер договора<input name="contractNumber" defaultValue={filters.contractNumber} /></label>
          <label className="field">Контрагент<input name="counterparty" defaultValue={filters.counterparty} /></label>
          <label className="field">ИНН<input name="inn" defaultValue={filters.inn} /></label>
          <label className="field">Статус заявки<input name="applicationStatus" defaultValue={filters.applicationStatus} /></label>
          <label className="field">Статус договора<input name="contractStatus" defaultValue={filters.contractStatus} /></label>
          <label className="field">Специалист<select name="assignedTo" defaultValue={filters.assignedTo ?? ""}><option value="">Все</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.full_name ?? profile.email}</option>)}</select></label>
          <label className="field">Тип шаблона<select name="templateType" defaultValue={filters.templateType ?? ""}><option value="">Все</option><option value="services">Услуги</option><option value="consulting">Консалтинг</option><option value="supply">Поставка</option></select></label>
          <label className="field">Валюта<input name="currency" maxLength={3} defaultValue={filters.currency} /></label>
          <label className="field">Конфликты<select name="conflicts" defaultValue={filters.conflicts}><option value="any">Любые</option><option value="yes">Есть</option><option value="no">Нет</option></select></label>
          <label className="field">Отправка<select name="sent" defaultValue={filters.sent}><option value="any">Любая</option><option value="sent">Отправлен</option><option value="unsent">Не отправлен</option></select></label>
          <label className="field">Сортировка<select name="sort" defaultValue={filters.sort}><option value="received_at">Дата получения</option><option value="contract_amount">Сумма</option><option value="contract_number">Номер договора</option><option value="counterparty_name">Контрагент</option><option value="application_status">Статус</option></select></label>
          <label className="field">Направление<select name="direction" defaultValue={filters.direction}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></label>
          <input type="hidden" name="pageSize" value={filters.pageSize} />
          <div className="filter-actions"><button type="submit">{ru ? "Применить" : "Apply"}</button><Link href="/registry">{ru ? "Сбросить" : "Reset"}</Link></div>
        </form>
      </section>
      <dl className="summary-grid section-gap">
        <div><dt>Заявки</dt><dd>{result.totals.applicationCount}</dd></div>
        <div><dt>Договоры</dt><dd>{result.totals.contractCount}</dd></div>
        <div><dt>Одобрено</dt><dd>{result.totals.approvedContractCount}</dd></div>
        <div><dt>Без договора</dt><dd>{result.totals.unpreparedApplicationCount}</dd></div>
        <div><dt>Конфликты</dt><dd>{result.totals.conflictApplicationCount}</dd></div>
        <div><dt>Среднее время отправки</dt><dd className="summary-text">{result.totals.averageDeliveryHours === null ? "—" : `${result.totals.averageDeliveryHours.toFixed(1)} ч`}</dd></div>
        {Object.entries(result.totals.amountsByCurrency).map(([currency, amount]) => <div key={currency}><dt>Итого {currency}</dt><dd className="summary-text">{amount.toLocaleString("ru-RU")}</dd></div>)}
      </dl>
      <div className="table-wrap section-gap">
        <table>
          <thead><tr><th>Заявка</th><th>Договор</th><th>Контрагент / ИНН</th><th>Предмет</th><th>Сумма</th><th>Статус</th><th>Специалист</th><th>Шаблон</th><th>Комплектность</th><th>Ссылки</th></tr></thead>
          <tbody>{result.rows.map((row) => (
            <tr key={`${row.application_id}:${row.contract_id ?? "none"}`}>
              <td><Link href={`/applications/${row.application_id}`}>{row.application_number}</Link><br />{new Date(row.received_at).toLocaleDateString()}</td>
              <td>{row.contract_number ?? "—"}<br />{row.contract_date ?? ""}</td>
              <td>{row.counterparty_id ? <Link href={`/counterparties/${row.counterparty_id}`}>{row.counterparty_name ?? "Контрагент"}</Link> : "—"}<br />{row.inn ?? ""}</td>
              <td>{row.contract_subject ?? "—"}</td>
              <td>{row.contract_amount === null ? "—" : `${row.contract_amount} ${row.currency ?? ""}`}</td>
              <td>{localizeStatus(row.application_status, locale)}<br />{row.contract_status ? localizeStatus(row.contract_status, locale) : (ru ? "Нет договора" : "No contract")}{row.has_conflicts ? <><br /><strong>{ru ? "Конфликты" : "Conflicts"}</strong></> : null}</td>
              <td>{row.specialist_name ?? row.specialist_email ?? "Не назначен"}</td>
              <td>{row.template_name ?? "—"} {row.template_version ?? ""}</td>
              <td>{row.completeness_percentage}%</td>
              <td><Link href={`/applications/${row.application_id}#contract`}>Договор</Link>{" · "}<Link href={`/applications/${row.application_id}#correspondence`}>Переписка ({row.correspondence_count})</Link>{row.current_version_id ? <><br /><Link href={`/api/contracts/versions/${row.current_version_id}`}>Скачать версию</Link></> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <nav className="pagination" aria-label="Страницы реестра">
        {filters.page > 1 ? <Link href={query(filters, filters.page - 1)}>Назад</Link> : <span />}
        <span>Страница {result.page} из {result.pageCount} (строк: {result.count})</span>
        {filters.page < result.pageCount ? <Link href={query(filters, filters.page + 1)}>Вперёд</Link> : <span />}
      </nav>
    </>
  );
}
