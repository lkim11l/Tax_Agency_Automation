import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getLocale, localizeStatus } from "@/lib/i18n";
import { ApplicationForm } from "@/components/application-form";
import { ContractDeliveryPanel } from "@/components/contract-delivery-panel";
import { ExtractionReviewPanel } from "@/components/extraction-review-panel";
import { Feedback } from "@/components/feedback";
import { PendingFormButton } from "@/components/pending-form-button";
import {
  appendNoteAction,
  changeStatusAction,
  updateApplicationAction,
} from "@/modules/applications/actions";
import { applicationStatuses } from "@/modules/applications/domain";
import {
  getApplication,
  getApplicationActivity,
  listAssignableProfiles,
} from "@/modules/applications/repository";
import { listCounterpartyOptions } from "@/modules/counterparties/repository";
import { listTemplateOptions } from "@/modules/templates/repository";
import { listApplicationEmails } from "@/modules/email/repository";
import {
  parseDocumentAction,
  parsePendingDocumentsAction,
} from "@/modules/documents/actions";
import { listApplicationDocuments } from "@/modules/documents/repository";
import {
  correctExtractedFieldAction,
  runExtractionAction,
  runPendingExtractionsAction,
} from "@/modules/extraction/actions";
import { getApplicationExtraction } from "@/modules/extraction/repository";
import {
  createDraftAction,
  recalculateCompletenessAction,
  sendDraftAction,
  transitionDraftAction,
  updateDraftAction,
} from "@/modules/clarification/actions";
import { completenessRuleSets } from "@/modules/clarification/rules";
import { getClarificationState } from "@/modules/clarification/service";
import {
  checkContractEligibilityAction,
  generateContractAction,
} from "@/modules/contracts/actions";
import { getContractState } from "@/modules/contracts/repository";
import { getDeliveryState } from "@/modules/delivery/repository";

export const metadata: Metadata = {
  title: "Карточка заявки",
};

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  const fieldFilter = ["all", "review", "conflict", "accepted", "missing"].includes(
    (feedback as { field_filter?: string }).field_filter ?? "",
  )
    ? (feedback as { field_filter: "all" | "review" | "conflict" | "accepted" | "missing" }).field_filter
    : "review";
  const application = await getApplication(id);

  if (!application) {
    notFound();
  }

  const [
    activity,
    counterparties,
    profiles,
    templates,
    emails,
    documentData,
    extractionData,
    clarification,
    contractState,
    deliveryState,
    locale,
  ] =
    await Promise.all([
      getApplicationActivity(id),
      listCounterpartyOptions(),
      listAssignableProfiles(),
      listTemplateOptions(),
      listApplicationEmails(id),
      listApplicationDocuments(id),
      getApplicationExtraction(id),
      getClarificationState(id),
      getContractState(id),
      getDeliveryState(id),
      getLocale(),
    ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{application.application_number}</h2>
          <p className="muted">
            {locale === "ru" ? "Текущий статус" : "Current status"}:{" "}
            <strong>{localizeStatus(application.status, locale)}</strong>
          </p>
        </div>
        <Link href="/applications">{locale === "ru" ? "К списку заявок" : "Back to applications"}</Link>
      </div>

      <Feedback error={feedback.error} success={feedback.success} />

      <ExtractionReviewPanel
        applicationId={application.id}
        fields={extractionData.fields}
        conflicts={extractionData.conflicts}
        acceptancePreview={extractionData.acceptancePreview}
        filter={fieldFilter}
        completeness={clarification.latestRun}
        requiredFieldNames={extractionData.requiredFieldNames}
      />

      <section className="panel section-gap">
        <h3>{locale === "ru" ? "Основные данные" : "Main data"}</h3>
        <ApplicationForm
          locale={locale}
          action={updateApplicationAction}
          application={application}
          counterparties={counterparties.map((item) => ({
            id: item.id,
            label: `${item.legal_name}${item.inn ? ` — ${item.inn}` : ""}`,
          }))}
          profiles={profiles.map((item) => ({
            id: item.id,
            label: item.full_name ?? item.email,
          }))}
          templates={templates.map((item) => ({
            id: item.id,
            label: `${item.name} v${item.version}`,
          }))}
        />
      </section>

      <div className="two-column section-gap">
        <section className="panel">
          <h3>Изменить статус</h3>
          <form action={changeStatusAction} className="stack">
            <input type="hidden" name="application_id" value={application.id} />
            <label className="field">
              New status
              <select name="status" defaultValue={application.status}>
                {applicationStatuses.map((status) => (
                  <option value={status} key={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Reason
              <textarea name="reason" rows={3} maxLength={1000} />
            </label>
            <button type="submit">Изменить статус</button>
          </form>
        </section>

        <section className="panel">
          <h3>Добавить внутренний комментарий</h3>
          <form action={appendNoteAction} className="stack">
            <input type="hidden" name="application_id" value={application.id} />
            <label className="field">
              Comment
              <textarea name="note" rows={5} required maxLength={4000} />
            </label>
            <button type="submit">Добавить комментарий</button>
          </form>
        </section>
      </div>

      <section className="panel section-gap">
        <h3>Связанные данные</h3>
        <dl className="summary-grid">
          <div>
            <dt>Письма</dt>
            <dd>{activity.counts.emailMessages}</dd>
          </div>
          <div>
            <dt>Вложения</dt>
            <dd>{activity.counts.attachments}</dd>
          </div>
          <div>
            <dt>Извлечённые поля</dt>
            <dd>{activity.counts.extractedFields}</dd>
          </div>
          <div>
            <dt>Договоры</dt>
            <dd>{activity.counts.contracts}</dd>
          </div>
        </dl>
      </section>

      <section className="panel section-gap" id="contract">
        <div className="page-heading">
          <div><h3>Проверка и отправка договора</h3><p className="muted">Каждое решение сотрудника и отправка привязаны к контрольной сумме неизменяемого DOCX.</p></div>
        </div>
        {contractState.templates.length === 0 ? <p className="muted">Нет одобренного активного шаблона DOCX.</p> : (
          <div className="two-column">
            <form action={checkContractEligibilityAction} className="stack">
              <input type="hidden" name="application_id" value={application.id} />
              <label className="field">Одобренный шаблон<select name="template_id">{contractState.templates.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version} — {template.template_type}</option>)}</select></label>
              <PendingFormButton
                idleLabel="Проверить готовность"
                pendingLabel="Проверка готовности…"
                pendingHint="Проверяем комплектность и данные шаблона."
              />
            </form>
            <form action={generateContractAction} className="stack">
              <input type="hidden" name="application_id" value={application.id} />
              <label className="field">Одобренный шаблон<select name="template_id">{contractState.templates.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version} — {template.template_type}</option>)}</select></label>
              <PendingFormButton
                idleLabel="Сформировать проект договора"
                pendingLabel="Формирование договора…"
                pendingHint="Формируем проект договора DOCX. Отправка клиенту останется заблокированной до проверки и одобрения сотрудником."
              />
            </form>
          </div>
        )}
        {contractState.isAdmin && contractState.templates.length > 0 && contractState.contracts.length > 0 ? (
          <form action={generateContractAction} className="stack section-gap">
            <input type="hidden" name="application_id" value={application.id} />
            <label className="field">Одобренный шаблон<select name="template_id">{contractState.templates.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version}</option>)}</select></label>
            <input type="hidden" name="force" value="1" />
            <label className="field">Причина повторного формирования<input name="force_reason" required minLength={2} maxLength={1000} /></label>
            <PendingFormButton
              idleLabel="Создать новую неизменяемую версию"
              pendingLabel="Формирование новой версии…"
              pendingHint="Формируем новую неизменяемую версию проекта договора."
            />
          </form>
        ) : null}
        {contractState.contracts.map((contract) => (
          <article className="document-card section-gap" key={contract.id}>
            <strong>{contract.contract_number ?? "Номер ещё не присвоен"} — {localizeStatus(contract.status, locale)}</strong>
            <p className="muted">{contract.template?.[0]?.name}</p>
            <ul className="timeline">{(contract.versions ?? []).sort((a, b) => b.version_number - a.version_number).map((version) => (
              <li key={version.id}><strong>Версия {version.version_number} — {localizeStatus(version.status, locale)}</strong><span>{contract.current_version_id === version.id ? "Текущая версия" : "Предыдущая версия"}</span><span>{version.generated_filename} — {version.file_size} байт — {version.checksum.slice(0, 12)}</span><span>Комплектность: {version.completeness_run_id}; извлечение: {version.extraction_run_id ?? "ручные/текущие значения"}</span><span>{new Date(version.generated_at).toLocaleString("ru-RU")}</span><a href={`/api/contracts/versions/${version.id}`}>Скачать DOCX</a></li>
            ))}</ul>
          </article>
        ))}
        {contractState.runs.some((run) => run.status === "failed") ? <details><summary>Ошибки формирования</summary><ul>{contractState.runs.filter((run) => run.status === "failed").map((run) => <li key={run.id}>{run.safe_error_code ?? "Ошибка формирования"}</li>)}</ul></details> : null}
        <ContractDeliveryPanel
          applicationId={application.id}
          versions={contractState.contracts.flatMap((contract) => contract.versions ?? [])}
          reviews={deliveryState.reviews}
          drafts={deliveryState.drafts}
          attempts={deliveryState.attempts}
          errorCode={deliveryState.errorCode}
          locale={locale}
        />
      </section>

      <section className="panel section-gap">
        <div className="page-heading">
          <div>
            <h3>Комплектность и уточнение</h3>
            <p className="muted">
              Детерминированная проверка комплектности. Письма отправляются
              только после явного одобрения специалистом.
            </p>
          </div>
          <form action={recalculateCompletenessAction} className="inline-actions">
            <input type="hidden" name="application_id" value={application.id} />
            <select name="rule_set_id" defaultValue={clarification.latestRun?.rule_set_id ?? "standard-contract"}>
              {completenessRuleSets.map((ruleSet) => (
                <option value={ruleSet.id} key={ruleSet.id}>
                  {ruleSet.label} v{ruleSet.version}
                </option>
              ))}
            </select>
            <button type="submit">Пересчитать комплектность</button>
          </form>
        </div>

        {clarification.latestRun ? (
          <>
            <dl className="summary-grid">
              <div><dt>Результат</dt><dd>{clarification.latestRun.percentage}%</dd></div>
              <div><dt>Заполнено</dt><dd>{clarification.latestRun.complete_count}/{clarification.latestRun.total_count}</dd></div>
              <div><dt>Отсутствуют</dt><dd>{clarification.latestRun.missing_count}</dd></div>
              <div><dt>Конфликты</dt><dd>{clarification.latestRun.conflict_count}</dd></div>
              <div><dt>Низкая уверенность</dt><dd>{clarification.latestRun.low_confidence_count}</dd></div>
              <div><dt>Готово</dt><dd>{clarification.latestRun.is_ready ? "да" : "нет"}</dd></div>
            </dl>
            {clarification.fields.some((field) => field.is_blocking) ? (
              <ul className="timeline">
                {clarification.fields.filter((field) => field.is_blocking).map((field) => (
                  <li key={field.id}>
                    <strong>{field.label}: {field.status}</strong>
                    <span>{field.question}</span>
                    <span>{field.reason ?? "blocking rule"}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Все обязательные поля соответствуют выбранным правилам.</p>}

            {!clarification.latestRun.is_ready ? (
              <form action={createDraftAction} className="stack section-gap">
                <input type="hidden" name="application_id" value={application.id} />
                <input type="hidden" name="completeness_run_id" value={clarification.latestRun.id} />
                <label className="field">
                  Email клиента
                  <input name="recipient" type="email" required defaultValue={clarification.suggestedRecipient} />
                </label>
                <button type="submit">Создать черновик уточнения</button>
              </form>
            ) : null}
          </>
        ) : <p className="muted">Комплектность ещё не рассчитана.</p>}

        {clarification.drafts.map((draft) => (
          <article className="document-card section-gap" key={draft.id}>
            {(() => {
              const deliveryUnknown = clarification.attempts.some(
                (attempt) =>
                  attempt.draft_id === draft.id &&
                  attempt.status === "delivery_unknown",
              );
              return (
                <>
            <div className="page-heading">
              <strong>Draft v{draft.version}</strong>
              <span>{draft.status}</span>
            </div>
            {["draft", "awaiting_approval", "approved", "send_failed"].includes(draft.status) && !deliveryUnknown ? (
              <form action={updateDraftAction} className="stack">
                <input type="hidden" name="application_id" value={application.id} />
                <input type="hidden" name="draft_id" value={draft.id} />
                <label className="field">Получатель<input name="recipient" type="email" required defaultValue={draft.recipient} /></label>
                <label className="field">Тема<input name="subject" required maxLength={500} defaultValue={draft.subject} /></label>
                <label className="field">Текст письма<textarea name="body_text" required rows={14} maxLength={50_000} defaultValue={draft.body_text} /></label>
                <button type="submit">Сохранить черновик</button>
              </form>
            ) : (
              <><p><strong>Кому:</strong> {draft.recipient}</p><p><strong>{draft.subject}</strong></p><pre className="email-body">{draft.body_text}</pre></>
            )}
            <div className="inline-actions section-gap">
              {draft.status === "draft" ? (
                <form action={transitionDraftAction}>
                  <input type="hidden" name="application_id" value={application.id} /><input type="hidden" name="draft_id" value={draft.id} /><input type="hidden" name="workflow_action" value="submit" />
                  <button type="submit">Отправить на одобрение</button>
                </form>
              ) : null}
              {draft.status === "awaiting_approval" ? (
                <><form action={transitionDraftAction}><input type="hidden" name="application_id" value={application.id} /><input type="hidden" name="draft_id" value={draft.id} /><input type="hidden" name="workflow_action" value="approve" /><button type="submit">Одобрить</button></form>
                <form action={transitionDraftAction}><input type="hidden" name="application_id" value={application.id} /><input type="hidden" name="draft_id" value={draft.id} /><input type="hidden" name="workflow_action" value="return" /><button type="submit">Вернуть на редактирование</button></form></>
              ) : null}
              {(draft.status === "approved" || draft.status === "send_failed") && !deliveryUnknown ? (
                <form action={sendDraftAction}><input type="hidden" name="application_id" value={application.id} /><input type="hidden" name="draft_id" value={draft.id} /><button type="submit">{draft.status === "send_failed" ? "Повторить безопасную отправку" : "Отправить через Mail.ru"}</button></form>
              ) : null}
              {["draft", "awaiting_approval", "approved", "send_failed"].includes(draft.status) ? (
                <form action={transitionDraftAction}><input type="hidden" name="application_id" value={application.id} /><input type="hidden" name="draft_id" value={draft.id} /><input type="hidden" name="workflow_action" value="cancel" /><button type="submit">Отменить</button></form>
              ) : null}
            </div>
            {deliveryUnknown ? (
              <p className="alert alert-error">
                Результат отправки неизвестен. Перед изменением или повтором
                проверьте почтовый ящик получателя.
              </p>
            ) : null}
                </>
              );
            })()}
          </article>
        ))}
      </section>

      <section className="panel section-gap" id="correspondence">
        <h3>Переписка</h3>
        {emails.length === 0 ? (
          <p className="muted">С заявкой не связано ни одного письма.</p>
        ) : (
          <ul className="timeline">
            {emails.map((message) => (
              <li key={message.id}>
                <strong>{message.subject ?? "(без темы)"}</strong>
                <span>
                  {message.sender} · {new Date(message.occurred_at).toLocaleString()}
                </span>
                <span>
                  To:{" "}
                  {message.recipients.map((recipient) => recipient.address).join(", ") ||
                    "не записано"}
                </span>
                <div className="email-body">
                  {message.plain_body ?? "Текстовая версия письма отсутствует."}
                </div>
                <span>
                  Processing: {message.processing_status}
                  {message.processing_error ? ` — ${message.processing_error}` : ""}
                </span>
                {message.attachments.length > 0 ? (
                  <ul>
                    {message.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <a href={`/api/attachments/${attachment.id}`}>
                          {attachment.original_filename}
                        </a>{" "}
                        ({attachment.mime_type}, {attachment.size_bytes} байт,{" "}
                        {attachment.parse_status})
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {false ? <section className="panel section-gap">
        <div className="page-heading">
          <div>
            <h3>Извлечённые данные</h3>
            <p className="muted">
              Структурированные значения. Отсутствующие и конфликтующие данные
              требуют проверки специалистом.
            </p>
          </div>
          <div className="inline-actions">
            <form action={runExtractionAction}>
              <input type="hidden" name="application_id" value={application!.id} />
              <input type="hidden" name="force" value="0" />
              <button type="submit">Извлечь данные</button>
            </form>
            {extractionData.isAdmin && extractionData.runs.length > 0 ? (
              <form action={runExtractionAction}>
                <input type="hidden" name="application_id" value={application!.id} />
                <input type="hidden" name="force" value="1" />
                <button type="submit">Повторить извлечение</button>
              </form>
            ) : null}
            {extractionData.isAdmin ? (
              <form action={runPendingExtractionsAction}>
                <input type="hidden" name="application_id" value={application!.id} />
                <button type="submit">Извлечь данные из всех ожидающих</button>
              </form>
            ) : null}
          </div>
        </div>

        {extractionData.fields.length === 0 ? (
          <p className="muted">Извлечение данных для этой заявки ещё не завершалось.</p>
        ) : (
          <div className="stack">
            {extractionData.fields.map((field) => {
              const normalized = field.structured_value?.normalizedValue;
              const value =
                normalized === null || normalized === undefined
                  ? ""
                  : String(normalized);
              const sourceAttachment =
                field.source_type === "parsed_document" && field.source_id
                  ? extractionData.documentSources[field.source_id]
                  : null;
              return (
                <article className="document-card" key={field.id}>
                  <div className="page-heading">
                    <div>
                      <strong>{field.field_name}</strong>
                      <div className="muted">
                        confidence {field.confidence ?? 0} ·{" "}
                        {field.requires_review ? "review required" : "reviewed"}
                        {field.conflict_detected ? " · conflict" : ""}
                        {field.manually_corrected ? " · manually corrected" : ""}
                      </div>
                    </div>
                    {sourceAttachment ? (
                      <a href={`/api/attachments/${sourceAttachment}`}>
                        Открыть исходный документ
                      </a>
                    ) : null}
                  </div>
                  <p>
                    <strong>Значение:</strong> {value || "(пусто)"}
                  </p>
                  <p className="muted">
                    Источник: {field.source_type ?? "нет"} ·{" "}
                    {field.source_marker ?? "без отметки"} · изменено{" "}
                    {new Date(field.updated_at).toLocaleString()}
                  </p>
                  {field.source_excerpt ? (
                    <blockquote className="source-excerpt">
                      {field.source_excerpt}
                    </blockquote>
                  ) : null}
                  <div className="two-column">
                    <form action={correctExtractedFieldAction} className="stack">
                      <input
                        type="hidden"
                        name="application_id"
                        value={application!.id}
                      />
                      <input type="hidden" name="field_name" value={field.field_name} />
                      <input type="hidden" name="action" value="corrected" />
                      <label className="field">
                        Corrected value
                        <input name="value" defaultValue={value} maxLength={10_000} />
                      </label>
                      <label className="field">
                        Correction reason
                        <input name="reason" required minLength={2} maxLength={1000} />
                      </label>
                      <button type="submit">Сохранить исправление</button>
                    </form>
                    <form action={correctExtractedFieldAction} className="stack">
                      <input
                        type="hidden"
                        name="application_id"
                        value={application!.id}
                      />
                      <input type="hidden" name="field_name" value={field.field_name} />
                      <input type="hidden" name="value" value="" />
                      <input type="hidden" name="action" value="manual_null_set" />
                      <label className="field">
                        Reason for null
                        <input name="reason" required minLength={2} maxLength={1000} />
                      </label>
                      <button type="submit">Отметить пустым</button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {extractionData.conflicts.length > 0 ? (
          <div className="section-gap">
            <h4>Конфликты</h4>
            {extractionData.conflicts.map((conflict) => (
              <article className="document-card" key={conflict.id}>
                <strong>{conflict.field_name}</strong>
                <p className="muted">{conflict.conflict_type}</p>
                <div className="stack">
                  {(conflict.candidates as Array<Record<string, unknown>>).map(
                    (candidate, index) => (
                      <form action={correctExtractedFieldAction} key={index}>
                        <input
                          type="hidden"
                          name="application_id"
                            value={application!.id}
                        />
                        <input
                          type="hidden"
                          name="field_name"
                          value={conflict.field_name}
                        />
                        <input
                          type="hidden"
                          name="value"
                          value={String(candidate.normalizedValue ?? "")}
                        />
                        <input
                          type="hidden"
                          name="source_type"
                          value={String(candidate.sourceType ?? "")}
                        />
                        <input
                          type="hidden"
                          name="source_id"
                          value={String(candidate.sourceId ?? "")}
                        />
                        <input
                          type="hidden"
                          name="source_marker"
                          value={String(candidate.sourceMarker ?? "")}
                        />
                        <input
                          type="hidden"
                          name="source_excerpt"
                          value={String(candidate.sourceExcerpt ?? "")}
                        />
                        <input
                          type="hidden"
                          name="action"
                          value="candidate_selected"
                        />
                        <label className="field">
                          Reason for selecting candidate
                          <input name="reason" required minLength={2} maxLength={1000} />
                        </label>
                        <button type="submit">
                          Выбрать {String(candidate.normalizedValue ?? "(пусто)")}
                        </button>
                      </form>
                    ),
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {extractionData.runs.length > 0 ? (
          <details className="section-gap">
            <summary>Запуски извлечения и использование</summary>
            <ul className="timeline">
              {extractionData.runs.map((run) => (
                <li key={run.id}>
                  <strong>
                    {run.status} · {run.model}
                  </strong>
                  <span>
                    prompt {run.prompt_version} · schema {run.schema_version}
                  </span>
                  <span>
                    input chars {run.input_character_count} · input tokens{" "}
                    {run.input_token_count ?? "n/a"} · output tokens{" "}
                    {run.output_token_count ?? "n/a"} · {run.duration_ms ?? 0} ms
                  </span>
                  {run.safe_error_code ? (
                    <span>
                      {run.safe_error_code}: {run.safe_error_message}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section> : null}

      <section className="panel section-gap">
        <div className="page-heading">
          <div>
            <h3>Документы</h3>
            <p className="muted">
              Закрытые исходные файлы и нормализованные результаты разбора.
            </p>
          </div>
          {documentData.isAdmin && documentData.documents.length > 0 ? (
            <form action={parsePendingDocumentsAction}>
              <input type="hidden" name="application_id" value={application.id} />
              <button type="submit">Разобрать все ожидающие файлы</button>
            </form>
          ) : null}
        </div>
        {documentData.documents.length === 0 ? (
          <p className="muted">С заявкой не связано ни одного вложения.</p>
        ) : (
          <div className="stack">
            {documentData.documents.map((document) => {
              const parsed = Array.isArray(document.parsed_documents)
                ? document.parsed_documents[0]
                : document.parsed_documents;
              const text = parsed?.normalized_text ?? null;
              const visibleText =
                text && text.length > 20_000
                  ? `${text.slice(0, 20_000)}\n\n[VIEW TRUNCATED]`
                  : text;
              return (
                <article
                  className="document-card"
                  id={`document-${document.id}`}
                  key={document.id}
                >
                  <div className="page-heading">
                    <div>
                      <strong>{document.original_filename}</strong>
                      <div className="muted">
                        {document.mime_type} · {document.size_bytes} байт · контрольная сумма{" "}
                        {document.checksum.slice(0, 12)}
                      </div>
                    </div>
                    <a href={`/api/attachments/${document.id}`}>Скачать оригинал</a>
                  </div>
                  <dl className="summary-grid">
                    <div>
                      <dt>Статус</dt>
                      <dd>{document.parse_status}</dd>
                    </div>
                    <div>
                      <dt>Обработчик</dt>
                      <dd>
                        {parsed
                          ? `${parsed.parser_type} (${parsed.parser_version})`
                          : "не запускался"}
                      </dd>
                    </div>
                    <div>
                      <dt>Длина текста</dt>
                      <dd>{parsed?.text_length ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Завершено</dt>
                      <dd>
                        {document.parse_completed_at
                          ? new Date(document.parse_completed_at).toLocaleString()
                          : "не завершён"}
                      </dd>
                    </div>
                  </dl>
                  {parsed && Object.keys(parsed.source_metadata).length > 0 ? (
                    <details>
                      <summary>Сведения об источнике</summary>
                      <pre className="email-body">
                        {JSON.stringify(parsed.source_metadata, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                  {parsed?.warnings.length ? (
                    <div className="alert">
                      <strong>Предупреждения</strong>
                      <ul>
                        {parsed.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {document.parse_error_code || document.parse_error ? (
                    <p className="alert alert-error">
                      {document.parse_error_code ?? "PARSE_ERROR"}:{" "}
                      {document.parse_error ?? "Document parsing needs attention."}
                    </p>
                  ) : null}
                  {visibleText ? (
                    <details>
                      <summary>Показать нормализованный текст</summary>
                      <pre className="document-text">{visibleText}</pre>
                    </details>
                  ) : null}
                  {documentData.isAdmin && document.parse_status !== "processing" ? (
                    <form action={parseDocumentAction}>
                      <input
                        type="hidden"
                        name="application_id"
                        value={application.id}
                      />
                      <input
                        type="hidden"
                        name="attachment_id"
                        value={document.id}
                      />
                      <button type="submit">
                        {document.parse_status === "pending" ? "Разобрать" : "Повторить разбор"}
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="two-column section-gap">
        <section className="panel">
          <h3>История статусов</h3>
          {activity.history.length === 0 ? (
            <p className="muted">История статусов пуста.</p>
          ) : (
            <ul className="timeline">
              {activity.history.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.previous_status ?? "created"} → {item.new_status}
                  </strong>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                  <span>{item.changer?.full_name ?? item.changer?.email ?? "system"}</span>
                  {item.reason ? <span>{item.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h3>Журнал аудита</h3>
          {activity.audit.length === 0 ? (
            <p className="muted">События аудита отсутствуют.</p>
          ) : (
            <ul className="timeline">
              {activity.audit.map((item) => (
                <li key={item.id}>
                  <strong>{item.action}</strong>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                  <span>{item.actor?.full_name ?? item.actor?.email ?? "system"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
