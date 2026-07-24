import Link from "next/link";

import { formatDateTime, getLocale, localizeStatus } from "@/lib/i18n";
import { getDashboardSummary } from "@/modules/dashboard/repository";

export default async function DashboardPage() {
  const [summary, locale] = await Promise.all([getDashboardSummary(), getLocale()]);
  const ru = locale === "ru";
  const cards = [
    [ru ? "Новые заявки" : "New applications", summary.new_applications],
    [ru ? "Ожидают клиента" : "Waiting for client", summary.waiting_for_client],
    [ru ? "Требуют проверки" : "Review required", summary.review_required],
    [ru ? "Договоры на проверке" : "Contracts under review", summary.contracts_under_review],
    [ru ? "Договоры отправлены" : "Contracts sent", summary.contracts_sent],
  ] as const;
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{ru ? "Обзор работы" : "Operations dashboard"}</h2>
          <p className="muted">{ru ? "Актуальные показатели из рабочей базы данных." : "Current metrics from the operational database."}</p>
        </div>
      </div>
      <dl className="summary-grid dashboard-grid">
        {cards.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        <div><dt>{ru ? "Последняя проверка почты" : "Last mailbox sync"}</dt><dd className="summary-text">{formatDateTime(summary.last_mailbox_sync, locale)}</dd></div>
        <div><dt>{ru ? "Состояние системы" : "System status"}</dt><dd className="summary-text"><span className={`badge badge-${summary.system_status}`}>{localizeStatus(summary.system_status, locale)}</span></dd></div>
      </dl>
      <section className="panel section-gap">
        <h3>{ru ? "Быстрые действия" : "Quick actions"}</h3>
        <div className="quick-actions">
          <Link className="button-link" href="/settings">{ru ? "Проверить почту" : "Check mail"}</Link>
          <Link className="button-link" href="/applications/new">{ru ? "Создать заявку" : "Create application"}</Link>
          <Link className="button-link secondary-link" href="/registry">{ru ? "Открыть реестр" : "Open registry"}</Link>
          <Link className="button-link secondary-link" href="/reports">{ru ? "Сформировать отчёт" : "Generate report"}</Link>
        </div>
      </section>
      {cards.every(([, value]) => value === 0) ? (
        <section className="panel empty-state section-gap">
          <h3>{ru ? "Рабочая очередь пуста" : "The work queue is empty"}</h3>
          <p>{ru ? "Проверьте входящую почту или создайте заявку вручную." : "Check incoming mail or create an application manually."}</p>
        </section>
      ) : null}
    </>
  );
}
