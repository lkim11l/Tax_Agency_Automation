import type { Metadata } from "next";

import { Feedback } from "@/components/feedback";
import { getOperationalContext } from "@/lib/auth/context";
import { getLocale, localizeStatus } from "@/lib/i18n";
import { getSystemOperations } from "@/modules/operations/repository";

import { runPilotPipelineAction } from "./actions";

export const metadata: Metadata = { title: "System status" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const feedback = await searchParams;
  const [{ profile }, locale] = await Promise.all([getOperationalContext(), getLocale()]);
  const ru = locale === "ru";
  const operations = profile.role === "admin" ? await getSystemOperations() : null;
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{ru ? "Состояние системы" : "System status"}</h2>
          <p className="muted">
            Safe dependency state and scheduled mailbox pipeline history.
          </p>
        </div>
        {operations ? (
          <form action={runPilotPipelineAction}>
            <button type="submit">{ru ? "Запустить обработку" : "Run pipeline now"}</button>
          </form>
        ) : null}
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      {!operations ? (
        <section className="panel">
          <p>Administrator access is required to view operational status.</p>
        </section>
      ) : (
        <>
          <section className="panel registry-panel">
            <h3>{ru ? "Компоненты" : "Components"}</h3>
            {operations.components.length === 0 ? (
              <p className="muted">No health probe has completed yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Component</th><th>Status</th><th>Checked</th><th>Last success</th><th>Safe error</th></tr></thead>
                  <tbody>{operations.components.map((component) => (
                    <tr key={component.component}>
                      <td>{component.component}</td>
                      <td>{localizeStatus(component.status, locale)}</td>
                      <td>{new Date(component.checked_at).toLocaleString()}</td>
                      <td>{component.last_success_at ? new Date(component.last_success_at).toLocaleString() : "Never"}</td>
                      <td>{component.safe_error_code ?? "—"}{component.safe_error_message ? `: ${component.safe_error_message}` : ""}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
          <section className="section-gap">
            <h3>{ru ? "Фоновые запуски" : "Background runs"}</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Started</th><th>Job</th><th>Trigger</th><th>Status</th><th>Processed</th><th>Errors</th><th>Safe error</th></tr></thead>
                <tbody>{operations.runs.map((run) => (
                  <tr key={run.id}>
                    <td>{new Date(run.started_at).toLocaleString()}</td>
                    <td>{run.job_type}</td>
                    <td>{run.trigger_source}</td>
                    <td>{localizeStatus(run.status, locale)}</td>
                    <td>{run.items_processed}</td>
                    <td>{run.error_count}</td>
                    <td>{run.safe_error_code ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
