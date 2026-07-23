import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApplicationForm } from "@/components/application-form";
import { Feedback } from "@/components/feedback";
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

export const metadata: Metadata = {
  title: "Application detail",
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
  const application = await getApplication(id);

  if (!application) {
    notFound();
  }

  const [activity, counterparties, profiles, templates, emails, documentData] =
    await Promise.all([
      getApplicationActivity(id),
      listCounterpartyOptions(),
      listAssignableProfiles(),
      listTemplateOptions(),
      listApplicationEmails(id),
      listApplicationDocuments(id),
    ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{application.application_number}</h2>
          <p className="muted">
            Current status: <strong>{application.status}</strong>
          </p>
        </div>
        <Link href="/applications">Back to applications</Link>
      </div>

      <Feedback error={feedback.error} success={feedback.success} />

      <section className="panel section-gap">
        <h3>Main data</h3>
        <ApplicationForm
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
          <h3>Change status</h3>
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
            <button type="submit">Change status</button>
          </form>
        </section>

        <section className="panel">
          <h3>Add internal comment</h3>
          <form action={appendNoteAction} className="stack">
            <input type="hidden" name="application_id" value={application.id} />
            <label className="field">
              Comment
              <textarea name="note" rows={5} required maxLength={4000} />
            </label>
            <button type="submit">Add comment</button>
          </form>
        </section>
      </div>

      <section className="panel section-gap">
        <h3>Related entities</h3>
        <dl className="summary-grid">
          <div>
            <dt>Emails</dt>
            <dd>{activity.counts.emailMessages}</dd>
          </div>
          <div>
            <dt>Attachments</dt>
            <dd>{activity.counts.attachments}</dd>
          </div>
          <div>
            <dt>Extracted fields</dt>
            <dd>{activity.counts.extractedFields}</dd>
          </div>
          <div>
            <dt>Contracts</dt>
            <dd>{activity.counts.contracts}</dd>
          </div>
        </dl>
      </section>

      <section className="panel section-gap">
        <h3>Correspondence</h3>
        {emails.length === 0 ? (
          <p className="muted">No email messages are linked to this application.</p>
        ) : (
          <ul className="timeline">
            {emails.map((message) => (
              <li key={message.id}>
                <strong>{message.subject ?? "(no subject)"}</strong>
                <span>
                  {message.sender} · {new Date(message.occurred_at).toLocaleString()}
                </span>
                <span>
                  To:{" "}
                  {message.recipients.map((recipient) => recipient.address).join(", ") ||
                    "not recorded"}
                </span>
                <div className="email-body">
                  {message.plain_body ?? "No plain-text body was supplied."}
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
                        ({attachment.mime_type}, {attachment.size_bytes} bytes,{" "}
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

      <section className="panel section-gap">
        <div className="page-heading">
          <div>
            <h3>Documents</h3>
            <p className="muted">
              Private source files and normalized Phase 3 parsing results.
            </p>
          </div>
          {documentData.isAdmin && documentData.documents.length > 0 ? (
            <form action={parsePendingDocumentsAction}>
              <input type="hidden" name="application_id" value={application.id} />
              <button type="submit">Parse all pending</button>
            </form>
          ) : null}
        </div>
        {documentData.documents.length === 0 ? (
          <p className="muted">No attachments are linked to this application.</p>
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
                <article className="document-card" key={document.id}>
                  <div className="page-heading">
                    <div>
                      <strong>{document.original_filename}</strong>
                      <div className="muted">
                        {document.mime_type} · {document.size_bytes} bytes · checksum{" "}
                        {document.checksum.slice(0, 12)}
                      </div>
                    </div>
                    <a href={`/api/attachments/${document.id}`}>Download original</a>
                  </div>
                  <dl className="summary-grid">
                    <div>
                      <dt>Status</dt>
                      <dd>{document.parse_status}</dd>
                    </div>
                    <div>
                      <dt>Parser</dt>
                      <dd>
                        {parsed
                          ? `${parsed.parser_type} (${parsed.parser_version})`
                          : "not run"}
                      </dd>
                    </div>
                    <div>
                      <dt>Text length</dt>
                      <dd>{parsed?.text_length ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>
                        {document.parse_completed_at
                          ? new Date(document.parse_completed_at).toLocaleString()
                          : "not completed"}
                      </dd>
                    </div>
                  </dl>
                  {parsed && Object.keys(parsed.source_metadata).length > 0 ? (
                    <details>
                      <summary>Source metadata</summary>
                      <pre className="email-body">
                        {JSON.stringify(parsed.source_metadata, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                  {parsed?.warnings.length ? (
                    <div className="alert">
                      <strong>Warnings</strong>
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
                      <summary>View normalized text</summary>
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
                        {document.parse_status === "pending" ? "Parse" : "Retry parse"}
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
          <h3>Status history</h3>
          {activity.history.length === 0 ? (
            <p className="muted">No status history.</p>
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
          <h3>Audit log</h3>
          {activity.audit.length === 0 ? (
            <p className="muted">No audit events.</p>
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
