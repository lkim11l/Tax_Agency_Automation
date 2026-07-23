import type { Metadata } from "next";

import { Feedback } from "@/components/feedback";
import {
  manualLinkEmailAction,
  reprocessEmailAction,
  syncEmailAction,
} from "@/modules/email/actions";
import { getEmailOperations, type EmailListItem } from "@/modules/email/repository";

export const metadata: Metadata = {
  title: "Email operations",
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
    return <p className="muted">No messages in this queue.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Sender</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Error</th>
            {isAdmin ? <th>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {messages.map((message) => (
            <tr key={message.id}>
              <td>{new Date(message.occurred_at).toLocaleString()}</td>
              <td>{message.sender}</td>
              <td>{message.subject ?? "(no subject)"}</td>
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
                        aria-label="Application UUID"
                        name="application_id"
                        placeholder="Application UUID"
                        required
                      />
                      <button type="submit">Link</button>
                    </form>
                  ) : (
                    <form action={reprocessEmailAction}>
                      <input
                        type="hidden"
                        name="email_message_id"
                        value={message.id}
                      />
                      <button type="submit">Reprocess</button>
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
          <h2>Email operations</h2>
          <p className="muted">Mail.ru polling for the configured INBOX.</p>
        </div>
        {operations.isAdmin ? (
          <form action={syncEmailAction}>
            <button type="submit">Synchronize email</button>
          </form>
        ) : null}
      </div>
      <Feedback error={feedback.error} success={feedback.success} />

      <section className="panel">
        <h3>Mailbox state</h3>
        {operations.state ? (
          <dl className="summary-grid">
            <div>
              <dt>Status</dt>
              <dd className="summary-text">{operations.state.sync_status}</dd>
            </div>
            <div>
              <dt>Last successful sync</dt>
              <dd className="summary-text">
                {operations.state.last_successful_sync
                  ? new Date(operations.state.last_successful_sync).toLocaleString()
                  : "Never"}
              </dd>
            </div>
            <div>
              <dt>Last UID</dt>
              <dd>{operations.state.last_processed_uid}</dd>
            </div>
            <div>
              <dt>Last result</dt>
              <dd className="summary-text">
                {operations.state.new_message_count} new /{" "}
                {operations.state.error_count} errors
              </dd>
            </div>
          </dl>
        ) : (
          <p className="muted">Synchronization has not run yet.</p>
        )}
        {operations.state?.last_error ? (
          <p className="error-message">{operations.state.last_error}</p>
        ) : null}
      </section>

      <section className="section-gap">
        <h3>Unlinked replies</h3>
        <EmailTable
          messages={operations.unlinked}
          allowLink
          isAdmin={operations.isAdmin}
        />
      </section>

      <section className="section-gap">
        <h3>Processing errors</h3>
        <EmailTable messages={operations.failed} isAdmin={operations.isAdmin} />
      </section>
    </>
  );
}
