import {
  bulkAcceptSafeFieldsAction,
  processApplicationAction,
} from "@/modules/applications/processing-actions";
import { PendingFormButton } from "@/components/pending-form-button";
import { correctExtractedFieldAction } from "@/modules/extraction/actions";
import {
  evidenceReasonRu,
  extractionFieldLabelRu,
  extractionReasonRu,
  reviewStatusLabelsRu,
} from "@/modules/extraction/localization";

type Field = {
  id: string;
  field_name: string;
  structured_value: Record<string, unknown> | null;
  source_type: string | null;
  source_marker: string | null;
  source_excerpt: string | null;
  confidence: number | null;
  requires_review: boolean;
  manually_corrected: boolean;
  conflict_detected: boolean;
  accepted?: boolean;
};

type Conflict = {
  id: string;
  field_name: string;
  candidates: unknown;
};

type Filter = "all" | "review" | "conflict" | "accepted" | "missing";

function fieldValue(field: Field) {
  const value = field.structured_value?.normalizedValue;
  return value === null || value === undefined ? "" : String(value);
}

function derivedFieldState(field: Field) {
  const state = field.structured_value?.fieldState;
  return state === "not_applicable" || state === "system_managed" ? state : null;
}

function fieldStatus(field: Field, requiredFieldNames: ReadonlySet<string>) {
  const derived = derivedFieldState(field);
  if (derived === "not_applicable") return "not_applicable" as const;
  if (derived === "system_managed") return "system_managed" as const;
  if (!fieldValue(field)) {
    return requiredFieldNames.has(field.field_name)
      ? ("missing" as const)
      : ("optional_empty" as const);
  }
  if (field.conflict_detected) return "conflict" as const;
  if (field.accepted || field.manually_corrected) return "accepted" as const;
  return "review" as const;
}

function sourceLabel(sourceType: string | null) {
  const labels: Record<string, string> = {
    application: "Карточка заявки",
    counterparty: "Карточка контрагента",
    email_message: "Письмо клиента",
    parsed_document: "Документ",
    manual: "Ручное исправление",
  };
  return sourceType ? (labels[sourceType] ?? "Источник") : "Источник не указан";
}

export function ExtractionReviewPanel({
  applicationId,
  fields,
  conflicts,
  acceptancePreview,
  filter,
  completeness,
  requiredFieldNames = [],
}: {
  applicationId: string;
  fields: Field[];
  conflicts: Conflict[];
  acceptancePreview: {
    eligible: Array<{ fieldName: string }>;
    blocked: Array<{ fieldName: string; reason: string; evidenceReason?: string | null }>;
  };
  filter: Filter;
  completeness: {
    percentage: number;
    is_ready: boolean;
    missing_count: number;
    conflict_count: number;
  } | null;
  requiredFieldNames?: readonly string[];
}) {
  const required = new Set(requiredFieldNames);
  const counts = {
    found: fields.filter((field) => fieldValue(field)).length,
    accepted: fields.filter((field) => fieldStatus(field, required) === "accepted").length,
    review: fields.filter((field) => fieldStatus(field, required) === "review").length,
    conflict: fields.filter((field) => fieldStatus(field, required) === "conflict").length,
    missing: fields.filter((field) => fieldStatus(field, required) === "missing").length,
  };
  const visible = fields.filter((field) => {
    const status = fieldStatus(field, required);
    if (filter === "all") return true;
    if (filter === "review") return status === "review" || status === "conflict";
    return status === filter;
  });
  const filters: Array<{ id: Filter; label: string }> = [
    { id: "review", label: "Требуют проверки" },
    { id: "conflict", label: "Конфликты" },
    { id: "accepted", label: "Подтверждены" },
    { id: "missing", label: "Отсутствуют" },
    { id: "all", label: "Все" },
  ];

  return (
    <section className="panel section-gap" id="data-review">
      <div className="page-heading">
        <div>
          <h3>Проверка данных</h3>
          <p className="muted">
            Безопасные значения подтверждаются по формату и точному источнику.
            Исправлять вручную нужно только спорные данные.
          </p>
        </div>
        <form action={processApplicationAction}>
          <input type="hidden" name="application_id" value={applicationId} />
          <PendingFormButton
            idleLabel="Обработать заявку"
            pendingLabel="Обрабатываем заявку…"
            pendingHint="Не закрывайте страницу. Обработка может занять до нескольких минут."
          />
        </form>
      </div>

      <dl className="summary-grid">
        <div><dt>Найдено полей</dt><dd>{counts.found}</dd></div>
        <div><dt>Подтверждено</dt><dd>{counts.accepted}</dd></div>
        <div><dt>Требуют внимания</dt><dd>{counts.review}</dd></div>
        <div><dt>Конфликты</dt><dd>{counts.conflict}</dd></div>
        <div><dt>Отсутствуют</dt><dd>{counts.missing}</dd></div>
        <div>
          <dt>Готовность договора</dt>
          <dd>{completeness?.is_ready ? "Да" : "Нет"} · {completeness?.percentage ?? 0}%</dd>
        </div>
      </dl>

      {completeness?.is_ready ? (
        <p className="alert">
          Данные готовы. Можно сформировать проект договора. Отправка останется
          заблокированной до проверки и одобрения сотрудником.
        </p>
      ) : null}

      <div className="two-column section-gap">
        <div>
          <strong>
            Будет подтверждено: {acceptancePreview.eligible.length}
          </strong>
          <p className="muted">
            Останется на проверке: {acceptancePreview.blocked.length}
          </p>
        </div>
        <form action={bulkAcceptSafeFieldsAction}>
          <input type="hidden" name="application_id" value={applicationId} />
          <PendingFormButton
            idleLabel="Подтвердить все корректные данные"
            pendingLabel="Подтверждаем данные…"
            pendingHint="Не закрывайте страницу, пока данные подтверждаются."
            disabled={acceptancePreview.eligible.length === 0}
          />
        </form>
      </div>
      {acceptancePreview.blocked.length > 0 ? (
        <details>
          <summary>Какие поля нельзя подтвердить автоматически</summary>
          <ul>
            {acceptancePreview.blocked.map((item) => (
              <li key={item.fieldName}>
                {extractionFieldLabelRu(item.fieldName)} —{" "}
                {item.reason === "TRUE_CONFLICT"
                  ? "найдены разные значения"
                  : item.reason === "INVALID_VALUE"
                    ? "неверный формат"
                    : item.reason === "MISSING_VALUE"
                      ? "значение отсутствует"
                      : item.reason === "MANUALLY_CONFIRMED"
                        ? "уже подтверждено вручную"
                        : item.reason === "SOURCE_REQUIRED"
                          ? evidenceReasonRu(item.evidenceReason)
                          : "требуется проверить источник"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <nav className="inline-actions section-gap" aria-label="Фильтр данных">
        {filters.map((item) => (
          <a
            className={filter === item.id ? "button-link active" : "button-link"}
            href={`?field_filter=${item.id}#data-review`}
            key={item.id}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {visible.length === 0 ? (
        <p className="muted">В этой категории нет полей.</p>
      ) : (
        <div className="stack">
          {visible.map((field) => {
            const status = fieldStatus(field, required);
            const value = fieldValue(field);
            const reason = String(field.structured_value?.reason ?? "");
            const conflict = conflicts.find((item) => item.field_name === field.field_name);
            const emptyLabel =
              status === "not_applicable"
                ? "Не требуется при подписании на основании Устава"
                : status === "system_managed"
                  ? "Будет назначено при формировании проекта договора"
                  : status === "optional_empty"
                    ? "Необязательное поле, не заполнено"
                    : "Значение отсутствует";
            return (
              <article className="document-card review-field-card" key={field.id}>
                <div className="page-heading">
                  <div>
                    <strong>{extractionFieldLabelRu(field.field_name)}</strong>
                    <p>{value || emptyLabel}</p>
                  </div>
                  <span>
                    {status === "accepted"
                      ? reviewStatusLabelsRu.accepted
                      : status === "conflict"
                        ? reviewStatusLabelsRu.conflict
                        : status === "missing"
                          ? reviewStatusLabelsRu.missing
                          : status === "not_applicable"
                            ? reviewStatusLabelsRu.not_applicable
                            : status === "system_managed"
                              ? reviewStatusLabelsRu.system_managed
                              : status === "optional_empty"
                                ? reviewStatusLabelsRu.optional_empty
                                : reviewStatusLabelsRu.review}
                  </span>
                </div>
                <p className="muted">
                  {sourceLabel(field.source_type)} · уверенность{" "}
                  {Math.round((field.confidence ?? 0) * 100)}%
                  {reason ? ` · ${extractionReasonRu(reason)}` : ""}
                </p>
                {field.source_excerpt ? (
                  <details>
                    <summary>Показать фрагмент источника</summary>
                    <blockquote className="source-excerpt">{field.source_excerpt}</blockquote>
                  </details>
                ) : null}

                {conflict ? (
                  <details>
                    <summary>Выбрать правильное значение</summary>
                    <div className="stack">
                      {(conflict.candidates as Array<Record<string, unknown>>).map(
                        (candidate, index) => (
                          <form action={correctExtractedFieldAction} key={index}>
                            <input type="hidden" name="application_id" value={applicationId} />
                            <input type="hidden" name="field_name" value={field.field_name} />
                            <input type="hidden" name="value" value={String(candidate.normalizedValue ?? "")} />
                            <input type="hidden" name="source_type" value={String(candidate.sourceType ?? "")} />
                            <input type="hidden" name="source_id" value={String(candidate.sourceId ?? "")} />
                            <input type="hidden" name="source_marker" value={String(candidate.sourceMarker ?? "")} />
                            <input type="hidden" name="source_excerpt" value={String(candidate.sourceExcerpt ?? "")} />
                            <input type="hidden" name="action" value="candidate_selected" />
                            <label className="field">
                              Причина выбора
                              <input name="reason" required minLength={2} maxLength={1000} />
                            </label>
                            <button type="submit">
                              Выбрать: {String(candidate.normalizedValue ?? "пустое значение")}
                            </button>
                          </form>
                        ),
                      )}
                    </div>
                  </details>
                ) : null}

                <details>
                  <summary>Изменить</summary>
                  <div className="two-column">
                    <form action={correctExtractedFieldAction} className="stack">
                      <input type="hidden" name="application_id" value={applicationId} />
                      <input type="hidden" name="field_name" value={field.field_name} />
                      <input type="hidden" name="action" value="corrected" />
                      <label className="field">
                        Исправленное значение
                        <input name="value" defaultValue={value} maxLength={10_000} />
                      </label>
                      <label className="field">
                        Причина исправления
                        <input name="reason" required minLength={2} maxLength={1000} />
                      </label>
                      <button type="submit">Сохранить исправление</button>
                    </form>
                    <form action={correctExtractedFieldAction} className="stack">
                      <input type="hidden" name="application_id" value={applicationId} />
                      <input type="hidden" name="field_name" value={field.field_name} />
                      <input type="hidden" name="value" value="" />
                      <input type="hidden" name="action" value="manual_null_set" />
                      <label className="field">
                        Причина удаления значения
                        <input name="reason" required minLength={2} maxLength={1000} />
                      </label>
                      <button type="submit">Отметить как отсутствующее</button>
                    </form>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
