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

  const [activity, counterparties, profiles, templates, emails] = await Promise.all([
    getApplicationActivity(id),
    listCounterpartyOptions(),
    listAssignableProfiles(),
    listTemplateOptions(),
    listApplicationEmails(id),
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
