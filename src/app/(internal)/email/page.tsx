import type { Metadata } from "next";

import { Feedback } from "@/components/feedback";
import { PendingFormButton } from "@/components/pending-form-button";
import {
  manualLinkEmailAction,
  reprocessEmailAction,
  syncEmailAction,
} from "@/modules/email/actions";
import { getEmailOperations, type EmailListItem } from "@/modules/email/repository";

export const metadata: Metadata = {
  title: "Работа с почтой",
};

function EmailTable({
  messages,
  allowLink,
  isAdmin,
}: {
  messages: EmailListItem[];
  allowLink?: boolean;
  isAdmin: boolean;
}) {
  if (messages.length === 0) {
    return <p className="muted">В этой очереди нет писем.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Отправитель</th>
            <th>Тема</th>
            <th>Статус</th>
            <th>Ошибка</th>
            {isAdmin ? <th>Действие</th> : null}
          </tr>
        </thead>
        <tbody>
          {messages.map((message) => (
            <tr key={message.id}>
              <td>{new Date(message.occurred_at).toLocaleString()}</td>
              <td>{message.sender}</td>
              <td>{message.subject ?? "(без темы)"}</td>
              <td>{message.processing_status}</td>
              <td>{message.processing_error ?? "—"}</td>
              {isAdmin ? (
                <td>
                  {allowLink ? (
                    <form action={manualLinkEmailAction} className="stack compact-form">
                      <input
                        type="hidden"
                        name="email_message_id"
                        value={message.id}
                      />
                      <input
                        aria-label="Идентификатор заявки"
                        name="application_id"
                        placeholder="UUID заявки"
                        required
                      />
                      <button type="submit">Связать</button>
                    </form>
                  ) : (
                    <form action={reprocessEmailAction}>
                      <input
                        type="hidden"
                        name="email_message_id"
                        value={message.id}
                      />
                      <button type="submit">Обработать повторно</button>
                    </form>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EmailOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const feedback = await searchParams;
  const operations = await getEmailOperations();
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Работа с почтой</h2>
          <p className="muted">Проверка настроенного входящего ящика Mail.ru.</p>
        </div>
        {operations.isAdmin ? (
          <form action={syncEmailAction}>
            <PendingFormButton
              idleLabel="Проверить почту"
              pendingLabel="Синхронизируем почту…"
              pendingHint="Не закрывайте страницу, пока идёт синхронизация."
            />
          </form>
        ) : null}
      </div>
      <Feedback error={feedback.error} success={feedback.success} />

      <section className="panel">
        <h3>Состояние почтового ящика</h3>
        {operations.state ? (
          <dl className="summary-grid">
            <div>
              <dt>Статус</dt>
              <dd className="summary-text">{operations.state.sync_status}</dd>
            </div>
            <div>
              <dt>Последняя успешная проверка</dt>
              <dd className="summary-text">
                {operations.state.last_successful_sync
                  ? new Date(operations.state.last_successful_sync).toLocaleString()
                  : "Никогда"}
              </dd>
            </div>
            <div>
              <dt>Последний UID</dt>
              <dd>{operations.state.last_processed_uid}</dd>
            </div>
            <div>
              <dt>Последний результат</dt>
              <dd className="summary-text">
                Новых: {operations.state.new_message_count} / ошибок:{" "}
                {operations.state.error_count}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="muted">Почта ещё не проверялась.</p>
        )}
        {operations.state?.last_error ? (
          <p className="error-message">{operations.state.last_error}</p>
        ) : null}
      </section>

      <section className="section-gap">
        <h3>Несвязанные ответы</h3>
        <EmailTable
          messages={operations.unlinked}
          allowLink
          isAdmin={operations.isAdmin}
        />
      </section>

      <section className="section-gap">
        <h3>Ошибки обработки</h3>
        <EmailTable messages={operations.failed} isAdmin={operations.isAdmin} />
      </section>
    </>
  );
}
