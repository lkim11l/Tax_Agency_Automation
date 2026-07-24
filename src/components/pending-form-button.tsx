"use client";

import { useFormStatus } from "react-dom";

export function PendingFormButton({
  idleLabel,
  pendingLabel,
  pendingHint,
  disabled = false,
}: {
  idleLabel: string;
  pendingLabel: string;
  pendingHint?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={disabled || pending}
        aria-disabled={disabled || pending}
        aria-busy={pending}
      >
        {pending ? (
          <>
            <span className="loading-spinner button-spinner" aria-hidden="true" />
            {pendingLabel}
          </>
        ) : (
          idleLabel
        )}
      </button>
      {pending && pendingHint ? (
        <p className="muted form-pending-hint" role="status" aria-live="polite">
          {pendingHint}
        </p>
      ) : null}
    </>
  );
}
