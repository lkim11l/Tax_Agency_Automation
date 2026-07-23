import type { ApplicationStatus } from "./domain";

export type StatusHistoryDraft = {
  application_id: string;
  previous_status: ApplicationStatus | null;
  new_status: ApplicationStatus;
  changed_by: string;
  reason: string | null;
};

export type AuditEventDraft = {
  actor_id: string;
  application_id: string;
  entity_type: "application";
  entity_id: string;
  action: "application.status_changed";
  metadata: {
    previous_status: ApplicationStatus | null;
    new_status: ApplicationStatus;
  };
};

export function describeStatusTransition(input: {
  applicationId: string;
  previousStatus: ApplicationStatus | null;
  newStatus: ApplicationStatus;
  actorId: string;
  reason: string | null;
}): { history: StatusHistoryDraft; audit: AuditEventDraft } {
  return {
    history: {
      application_id: input.applicationId,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      changed_by: input.actorId,
      reason: input.reason,
    },
    audit: {
      actor_id: input.actorId,
      application_id: input.applicationId,
      entity_type: "application",
      entity_id: input.applicationId,
      action: "application.status_changed",
      metadata: {
        previous_status: input.previousStatus,
        new_status: input.newStatus,
      },
    },
  };
}
