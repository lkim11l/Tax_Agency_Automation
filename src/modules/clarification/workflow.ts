export type ClarificationStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "sending"
  | "sent"
  | "send_failed"
  | "cancelled"
  | "superseded";

export function assertSafeEmailHeaders(recipient: string, subject: string) {
  if (
    !/^[^\s@]+@[^\s@]+$/u.test(recipient) ||
    recipient.length > 320 ||
    /[\r\n]/u.test(recipient)
  ) {
    throw new Error("Invalid recipient.");
  }
  if (!subject.trim() || subject.length > 500 || /[\r\n]/u.test(subject)) {
    throw new Error("Invalid subject.");
  }
}

export function assertRequiredQuestions(
  bodyText: string,
  requiredQuestions: string[],
) {
  if (!bodyText.trim() || bodyText.length > 50_000) {
    throw new Error("Invalid clarification body.");
  }
  const missing = requiredQuestions.filter(
    (question) => !bodyText.includes(question),
  );
  if (missing.length) {
    throw new Error("Required clarification questions cannot be removed.");
  }
}

export function editDraftState(input: {
  status: ClarificationStatus;
  version: number;
  changed: boolean;
}) {
  if (
    !["draft", "awaiting_approval", "approved", "send_failed"].includes(
      input.status,
    )
  ) {
    throw new Error("This draft can no longer be edited.");
  }
  return input.changed
    ? {
        status: "draft" as const,
        version: input.version + 1,
        approvedBy: null,
        approvedAt: null,
      }
    : { status: input.status, version: input.version };
}

export function draftTransition(
  status: ClarificationStatus,
  action: "submit" | "approve" | "return" | "cancel",
) {
  const transitions: Record<
    typeof action,
    { from: ClarificationStatus[]; to: ClarificationStatus }
  > = {
    submit: { from: ["draft"], to: "awaiting_approval" },
    approve: { from: ["awaiting_approval"], to: "approved" },
    return: { from: ["awaiting_approval", "approved"], to: "draft" },
    cancel: {
      from: ["draft", "awaiting_approval", "approved", "send_failed"],
      to: "cancelled",
    },
  };
  const transition = transitions[action];
  if (!transition.from.includes(status)) throw new Error("Invalid draft transition.");
  return transition.to;
}

export function classifySmtpFailure(error: unknown) {
  const candidate = error as { code?: string; command?: string };
  const deliveryUnknown =
    candidate.command === "DATA" ||
    candidate.code === "ETIMEDOUT" ||
    candidate.code === "ECONNRESET";
  return {
    code: deliveryUnknown ? "SMTP_DELIVERY_UNKNOWN" : "SMTP_SEND_FAILED",
    message: deliveryUnknown
      ? "SMTP delivery confirmation was not received; reconcile the mailbox before retrying."
      : "SMTP rejected the message before delivery was accepted.",
    deliveryUnknown,
    retryAllowed: !deliveryUnknown,
  };
}
