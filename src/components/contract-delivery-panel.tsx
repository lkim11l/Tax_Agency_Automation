import {
  cancelDeliveryDraftAction,
  createDeliveryDraftAction,
  reviewContractVersionAction,
  sendDeliveryDraftAction,
  updateDeliveryDraftAction,
} from "@/modules/delivery/actions";

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
}: {
  applicationId: string;
  versions: Version[];
  reviews: Review[];
  drafts: Draft[];
  attempts: Attempt[];
}) {
  return (
    <div className="stack section-gap">
      {versions.map((version) => {
        const review = reviews.find((item) => item.contract_version_id === version.id);
        return (
          <article className="document-card" key={`review-${version.id}`}>
            <strong>Human review · version {version.version_number}</strong>
            <p className="muted">
              Decision is bound to checksum {version.checksum.slice(0, 16)}…
            </p>
            {review ? (
              <>
                <p>
                  {review.decision} · {new Date(review.reviewed_at).toLocaleString()}
                  {review.comment ? ` · ${review.comment}` : ""}
                </p>
                <p className="muted">
                  Reviewer: {review.reviewer?.[0]?.full_name ?? review.reviewer?.[0]?.email ?? "active operator"}
                  {" · "}approved checksum {review.reviewed_checksum.slice(0, 16)}…
                </p>
              </>
            ) : version.status === "awaiting_review" ? (
              <>
                <p className="alert">
                  Download and inspect this exact DOCX before recording a decision.
                </p>
                <a href={`/api/contracts/versions/${version.id}`}>Download exact review version</a>
                <form action={reviewContractVersionAction} className="stack section-gap">
                  <input type="hidden" name="application_id" value={applicationId} />
                  <input type="hidden" name="contract_version_id" value={version.id} />
                  <label className="field">
                    Review comment (required for reject/return)
                    <textarea name="comment" rows={3} maxLength={4000} />
                  </label>
                  <div className="inline-actions">
                    <button name="decision" value="approved">Approve exact version</button>
                    <button name="decision" value="rejected">Reject</button>
                    <button name="decision" value="returned_for_regeneration">
                      Return for regeneration
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <p className="muted">This version is not awaiting a review decision.</p>
            )}
            {review?.decision === "approved" && version.status === "approved" ? (
              <form action={createDeliveryDraftAction} className="stack section-gap">
                <input type="hidden" name="application_id" value={applicationId} />
                <input type="hidden" name="contract_version_id" value={version.id} />
                <label className="field">
                  Confirmed client email (leave blank to use latest inbound sender)
                  <input name="recipient" type="email" maxLength={320} />
                </label>
                <button>Create versioned delivery draft</button>
              </form>
            ) : null}
          </article>
        );
      })}

      {drafts.map((draft) => {
        const draftAttempts = attempts.filter((item) => item.delivery_draft_id === draft.id);
        const editable = ["draft", "ready", "send_failed"].includes(draft.status);
        return (
          <article className="document-card" key={draft.id}>
            <div className="page-heading">
              <strong>Delivery draft v{draft.draft_version}</strong>
              <span>{draft.status}</span>
            </div>
            <p className="muted">
              Exact attachment: {draft.attachment_filename} · {draft.version_checksum.slice(0, 16)}…
            </p>
            {editable ? (
              <form action={updateDeliveryDraftAction} className="stack">
                <input type="hidden" name="application_id" value={applicationId} />
                <input type="hidden" name="draft_id" value={draft.id} />
                <label className="field">Recipient<input name="recipient" type="email" required defaultValue={draft.recipient} /></label>
                <label className="field">Subject<input name="subject" required maxLength={500} defaultValue={draft.subject} /></label>
                <label className="field">Body<textarea name="body_text" required rows={10} maxLength={50_000} defaultValue={draft.body_text} /></label>
                <button>Save as new draft version</button>
              </form>
            ) : (
              <>
                <p><strong>To:</strong> {draft.recipient}</p>
                <p><strong>{draft.subject}</strong></p>
                <pre className="email-body">{draft.body_text}</pre>
              </>
            )}
            {editable ? (
              <div className="inline-actions section-gap">
                <form action={sendDeliveryDraftAction}>
                  <input type="hidden" name="application_id" value={applicationId} />
                  <input type="hidden" name="draft_id" value={draft.id} />
                  <button>{draft.status === "send_failed" ? "Retry known safe failure" : "Send exact DOCX via Mail.ru"}</button>
                </form>
                <form action={cancelDeliveryDraftAction}>
                  <input type="hidden" name="application_id" value={applicationId} />
                  <input type="hidden" name="draft_id" value={draft.id} />
                  <button>Cancel draft</button>
                </form>
              </div>
            ) : null}
            {draftAttempts.map((attempt) => (
              <p className={attempt.status === "delivery_unknown" ? "alert alert-error" : "muted"} key={attempt.id}>
                SMTP attempt: {attempt.status}
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
