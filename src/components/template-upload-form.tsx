"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import type { TemplateUploadState } from "@/modules/templates/actions";

const initialState: TemplateUploadState = { status: "idle" };

function SubmitButton({ ru }: { ru: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending}>
      {pending
        ? (ru ? "Загрузка и проверка…" : "Uploading and validating…")
        : (ru ? "Загрузить и проверить" : "Upload and validate")}
    </button>
  );
}

export function TemplateUploadForm({
  action,
  ru,
}: {
  action: (state: TemplateUploadState, formData: FormData) => Promise<TemplateUploadState>;
  ru: boolean;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [filename, setFilename] = useState("");
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle") {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      feedbackRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="form-grid">
      {state.status !== "idle" ? (
        <div
          ref={feedbackRef}
          tabIndex={-1}
          className={`field-wide alert ${state.status === "error" ? "alert-error" : "alert-success"}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          <span>{state.message}</span>
          {state.operationId ? (
            <small className="operation-id">
              {ru ? "Код операции" : "Operation ID"}: {state.operationId}
            </small>
          ) : null}
          {state.templateId ? (
            <Link href={`/templates/${state.templateId}`}>
              {ru ? "Открыть шаблон" : "Open template"}
            </Link>
          ) : null}
        </div>
      ) : null}
      <label className="field field-wide">{ru ? "Название" : "Name"}<input name="name" required maxLength={200} /></label>
      <label className="field field-wide">
        {ru ? "Файл DOCX" : "DOCX file"}
        <input
          name="file"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required
          onChange={(event) => setFilename(event.currentTarget.files?.[0]?.name ?? "")}
        />
        <small className="muted">
          {filename ? `${ru ? "Выбран файл" : "Selected"}: ${filename}` : (ru ? "До 10 МБ, только безопасный DOCX без макросов." : "Up to 10 MB, safe macro-free DOCX only.")}
        </small>
      </label>
      <p className="muted field-wide">
        {ru
          ? "Обязательные поля, тип договора и набор правил определяются автоматически по содержимому файла. При необходимости их можно скорректировать на странице шаблона после загрузки."
          : "Required fields, contract type and rule set are all derived automatically from the file's content. Adjust them on the template's page after upload if needed."}
      </p>
      <div className="field-wide"><SubmitButton ru={ru} /></div>
    </form>
  );
}
