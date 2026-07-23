# Completeness and clarification workflow

Phase 5 adds a deterministic, human-approved clarification loop. It does not
generate contracts and does not send source documents or missing values to an
LLM.

## Completeness rules

The application ships three versioned rule sets:

- `standard-contract@1.0.0`;
- `services-contract@1.0.0`;
- `supply-contract@1.0.0`.

Each rule records the field label, client question, required/conditional
behavior, manual-confirmation policy, confidence threshold, and conflict
blocking policy. A value is complete only when it is present and either:

- has source ID, marker, excerpt, sufficient confidence, no unresolved conflict,
  and no review flag; or
- is an explicit persisted manual correction allowed by the rule.

Every calculation stores an extraction fingerprint, field-level results,
totals, blocking state, percentage, rule-set ID, and version.

## Approval and sending

Draft text is generated deterministically in Russian from blocking fields.
Optional AI rewriting is intentionally disabled. The supported lifecycle is:

```text
draft -> awaiting_approval -> approved -> sending -> sent
                                      \-> send_failed
```

A specialist can return an awaiting/approved draft to editing or cancel it.
Editing recipient, subject, or body after approval increments the version and
revokes approval. SMTP sending is available only for an explicitly approved,
non-empty draft with a valid recipient.

Each attempt stores its number, idempotency key, immutable message snapshot,
stable RFC Message-ID, provider response, safe error, sender, and actor. A safe
pre-delivery failure can be retried. A timeout or connection loss during/after
SMTP DATA is `delivery_unknown` and cannot be retried automatically because a
second delivery cannot be ruled out.

## Reply processing

Run mailbox synchronization normally:

```bash
npm run email:sync
```

A real Reply is linked through `In-Reply-To` or `References`. For a sent
clarification, synchronization:

1. records and claims the reply idempotently;
2. moves the application to `processing`;
3. parses only attachments from the new reply;
4. extracts only the new email and newly parsed documents;
5. merges the delta with existing extracted values while preserving manual
   corrections;
6. recalculates completeness;
7. moves the application to `data_complete` or `needs_data_review`.

Run the synthetic live acceptance:

```bash
npm run test:clarification:live
```

The first run creates a dedicated synthetic application and sends one approved
message. It exits with an awaiting-reply result. Reply from the controlled
recipient mailbox using the mail client's Reply action, then run the same
command again. The command never treats a missing real reply as acceptance.
