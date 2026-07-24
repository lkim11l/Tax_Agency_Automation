import {
  cancelDeliveryDraftAction,
  createDeliveryDraftAction,
  reviewContractVersionAction,
  sendDeliveryDraftAction,
  updateDeliveryDraftAction,
} from "@/modules/delivery/actions";
import type { DeliveryStateErrorCode } from "@/modules/delivery/repository";

type Version = {
  id: string;
  version_number: number;
  status: string;
  checksum: string;
};

type Review = {
  id: string;
  contract_version_id: string;
  decision: string;
  comment: string | null;
  reviewed_checksum: string;
  reviewed_at: string;
  reviewer: Array<{ email: string; full_name: string | null }> | null;
};

type Draft = {
  id: string;
  contract_version_id: string;
  draft_version: number;
  recipient: string;
  recipient_source: string;
  subject: string;
  body_text: string;
  attachment_filename: string;
  version_checksum: string;
  status: string;
  created_at: string;
  sent_at: string | null;
};

type Attempt = {
  id: string;
  delivery_draft_id: string;
  status: string;
  provider_message_id: string | null;
  safe_error_code: string | null;
  safe_error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

export function ContractDeliveryPanel({
  applicationId,
  versions,
  reviews,
  drafts,
  attempts,
  errorCode,
  locale,
}: {
  applicationId: string;
  versions: Version[];
  reviews: Review[];
  drafts: Draft[];
  attempts: Attempt[];
  errorCode: DeliveryStateErrorCode | null;
  locale: "ru" | "en";
}) {
  return (
    <div className="stack section-gap">
      {errorCode ? (
        <p className="alert alert-error" role="alert">
          {locale === "ru"
            ? errorCode === "DELIVERY_SCHEMA_MISMATCH"
              ? "Раздел доставки временно недоступен из-за несовместимости схемы данных. Остальные данные заявки доступны."
              : "Не удалось загрузить раздел доставки. Остальные данные заявки доступны."
            : errorCode === "DELIVERY_SCHEMA_MISMATCH"
              ? "Delivery is temporarily unavailable because of a data schema mismatch. The rest of the application is available."
              : "Unable to load delivery. The rest of the application is available."}
        </p>
      ) : null}

      {versions.map((version) => {
        const review = reviews.find((item) => item.contract_version_id === version.id);
        return (
          <article className="document-card" key={`review-${version.id}`}>
            <strong>Проверка договора · версия {version.version_number}</strong>
            <p className="muted">
              Решение относится к файлу с контрольной суммой {version.checksum.slice(0, 16)}…
            </p>
            {review ? (
              <>
                <p>
                  {review.decision} · {new Date(review.reviewed_at).toLocaleString()}
                  {review.comment ? ` · ${review.comment}` : ""}
                </p>
                <p className="muted">
                  Проверил: {review.reviewer?.[0]?.full_name ?? review.reviewer?.[0]?.email ?? "сотрудник"}
                  {" · "}контрольная сумма {review.reviewed_checksum.slice(0, 16)}…
                </p>
              </>
            ) : version.status === "awaiting_review" ? (
              <>
                <p className="alert">
                  Скачайте и проверьте именно этот DOCX перед принятием решения.
                </p>
                <a href={`/api/contracts/versions/${version.id}`}>Скачать версию для проверки</a>
                <form action={reviewContractVersionAction} className="stack section-gap">
                  <input type="hidden" name="application_id" value={applicationId} />
                  <input type="hidden" name="contract_version_id" value={version.id} />
                  <label className="field">
                    Комментарий (обязателен при отклонении или возврате)
                    <textarea name="comment" rows={3} maxLength={4000} />
                  </label>
                  <div className="inline-actions">
                    <button name="decision" value="approved">Одобрить эту версию</button>
                    <button name="decision" value="rejected">Отклонить</button>
                    <button name="decision" value="returned_for_regeneration">
                      Вернуть на доработку
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <p className="muted">Эта версия сейчас не ожидает решения.</p>
            )}
            {review?.decision === "approved" && version.status === "approved" ? (
              <form action={createDeliveryDraftAction} className="stack section-gap">
                <input type="hidden" name="application_id" value={applicationId} />
                <input type="hidden" name="contract_version_id" value={version.id} />
                <label className="field">
                  Email клиента (оставьте пустым для адреса из последнего письма)
                  <input name="recipient" type="email" maxLength={320} />
                </label>
                <button>Создать черновик отправки</button>
              </form>
            ) : null}
          </article>
        );
      })}

      {drafts.length === 0 && !errorCode ? (
        <p className="muted">
          {locale === "ru"
            ? "Черновик отправки ещё не создан."
            : "No delivery draft has been created."}
        </p>
      ) : null}

      {drafts.map((draft) => {
        const draftAttempts = attempts.filter((item) => item.delivery_draft_id === draft.id);
        const editable = ["draft", "ready", "send_failed"].includes(draft.status);
        return (
          <article className="document-card" key={draft.id}>
            <div className="page-heading">
              <strong>Черновик отправки v{draft.draft_version}</strong>
              <span>{draft.status}</span>
            </div>
            <p className="muted">
              Вложение: {draft.attachment_filename} · {draft.version_checksum.slice(0, 16)}…
            </p>
            {editable ? (
              <form action={updateDeliveryDraftAction} className="stack">
                <input type="hidden" name="application_id" value={applicationId} />
                <input type="hidden" name="draft_id" value={draft.id} />
                <label className="field">Получатель<input name="recipient" type="email" required defaultValue={draft.recipient} /></label>
                <label className="field">Тема<input name="subject" required maxLength={500} defaultValue={draft.subject} /></label>
                <label className="field">Текст письма<textarea name="body_text" required rows={10} maxLength={50_000} defaultValue={draft.body_text} /></label>
                <button>Сохранить новую версию черновика</button>
              </form>
            ) : (
              <>
                <p><strong>Кому:</strong> {draft.recipient}</p>
                <p><strong>{draft.subject}</strong></p>
                <pre className="email-body">{draft.body_text}</pre>
              </>
            )}
            {editable ? (
              <div className="inline-actions section-gap">
                <form action={sendDeliveryDraftAction}>
                  <input type="hidden" name="application_id" value={applicationId} />
                  <input type="hidden" name="draft_id" value={draft.id} />
                  <button>{draft.status === "send_failed" ? "Повторить безопасную попытку" : "Отправить точный DOCX через Mail.ru"}</button>
                </form>
                <form action={cancelDeliveryDraftAction}>
                  <input type="hidden" name="application_id" value={applicationId} />
                  <input type="hidden" name="draft_id" value={draft.id} />
                  <button>Отменить черновик</button>
                </form>
              </div>
            ) : null}
            {draftAttempts.map((attempt) => (
              <p className={attempt.status === "delivery_unknown" ? "alert alert-error" : "muted"} key={attempt.id}>
                Попытка отправки: {attempt.status}
                {attempt.safe_error_code ? ` · ${attempt.safe_error_code}` : ""}
                {attempt.safe_error_message ? ` · ${attempt.safe_error_message}` : ""}
                {attempt.provider_message_id ? ` · ${attempt.provider_message_id}` : ""}
              </p>
            ))}
          </article>
        );
      })}
    </div>
  );
}
