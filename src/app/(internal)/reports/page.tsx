import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import { getOperationalContext } from "@/lib/auth/context";
import { getLocale, localizeStatus, localizeTemplateType } from "@/lib/i18n";
import { aggregateRegistryRows, parseRegistryFilters, stableFingerprint } from "@/modules/reports/domain";
import { calculateMonthlyMetrics, listReportExports, loadAllRegistryRows } from "@/modules/reports/repository";

import { generateReportAction } from "./actions";

export const metadata: Metadata = { title: "Отчёты" };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReportsPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = parseRegistryFilters(params);
  const [context, locale, { rows }, history] = await Promise.all([getOperationalContext(), getLocale(), loadAllRegistryRows(filters), listReportExports()]);
  const ru = locale === "ru";
  const totals = aggregateRegistryRows(rows);
  const metrics = await calculateMonthlyMetrics(rows);
  const fingerprint = stableFingerprint({ rows, totals, metrics }).slice(0, 12);
  return (
    <>
      <div className="page-heading"><div><h2>{ru ? "Ежемесячные отчёты" : "Monthly reports"}</h2><p className="muted">{ru ? "Снимок базы данных; суммы разделены по валютам." : "Database snapshot; amounts remain separated by currency."}</p></div><Link href="/registry">{ru ? "Открыть реестр" : "Open registry"}</Link></div>
      <Feedback error={typeof params.error === "string" ? params.error : undefined} success={typeof params.success === "string" ? params.success : undefined} />
      <section className="panel">
        <form action={generateReportAction} className="filter-grid">
          <label className="field">С<input type="date" name="dateFrom" defaultValue={filters.dateFrom} /></label>
          <label className="field">По<input type="date" name="dateTo" defaultValue={filters.dateTo} /></label>
          <input type="hidden" name="pageSize" value="100" />
          <div className="filter-actions"><button type="submit">{ru ? "Сформировать XLSX" : "Generate XLSX"}</button></div>
          {context.profile.role === "admin" ? <><label className="checkbox-field"><input type="checkbox" name="force" value="true" /> Создать заново</label><label className="field">Причина повторного формирования<input name="forceReason" minLength={2} /></label></> : null}
        </form>
      </section>
      <dl className="summary-grid section-gap">
        <div><dt>Новые заявки</dt><dd>{metrics.newApplications}</dd></div>
        <div><dt>Обработано</dt><dd>{metrics.processedApplications}</dd></div>
        <div><dt>Завершённые договоры</dt><dd>{metrics.completedContracts}</dd></div>
        <div><dt>Отправленные договоры</dt><dd>{metrics.sentContracts}</dd></div>
        <div><dt>Ручная проверка</dt><dd>{metrics.manualReview}</dd></div>
        <div><dt>Ожидают клиента</dt><dd>{metrics.waitingForClient}</dd></div>
        <div><dt>Отклонено</dt><dd>{metrics.rejectedContracts}</dd></div>
        <div><dt>Уточнения</dt><dd>{metrics.clarificationEmails}</dd></div>
        <div><dt>Повторные уточнения</dt><dd>{metrics.repeatedClarifications}</dd></div>
        <div><dt>Среднее время обработки</dt><dd className="summary-text">{metrics.averageProcessingHours === null ? "—" : `${metrics.averageProcessingHours.toFixed(1)} ч`}</dd></div>
        <div><dt>Снимок</dt><dd className="summary-text">{fingerprint}</dd></div>
        {Object.entries(metrics.amountsByCurrency).map(([currency, amount]) => <div key={`currency-${currency}`}><dt>Сумма {currency}</dt><dd className="summary-text">{amount.toLocaleString("ru-RU")}</dd></div>)}
        {Object.entries(metrics.contractsByTemplateType).map(([type, count]) => <div key={`template-${type}`}><dt>Шаблон: {localizeTemplateType(type, locale)}</dt><dd>{count}</dd></div>)}
        {Object.entries(metrics.workBySpecialist).map(([specialist, count]) => <div key={`specialist-${specialist}`}><dt>{specialist}</dt><dd>{count}</dd></div>)}
      </dl>
      <h3 className="section-gap">{ru ? "Экспортированные отчёты" : "Exports"}</h3>
      <div className="table-wrap"><table><thead><tr><th>Создан</th><th>Период</th><th>Статус</th><th>Строк</th><th>Файл</th><th>Контрольная сумма</th></tr></thead><tbody>{history.map((report) => <tr key={report.id}><td>{new Date(report.created_at).toLocaleString("ru-RU")}</td><td>{report.period_start} — {report.period_end}</td><td>{localizeStatus(report.status, locale)}{report.force_requested ? " (принудительно)" : ""}</td><td>{report.row_count}</td><td>{report.status === "completed" ? <Link href={`/api/reports/${report.id}`}>{report.filename}</Link> : report.safe_error_code ?? "—"}</td><td>{report.checksum?.slice(0, 12) ?? "—"}</td></tr>)}</tbody></table></div>
    </>
  );
}
