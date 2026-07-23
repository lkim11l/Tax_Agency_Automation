# AI Extraction Operations

## One application

```bash
npm run extraction:run -- --application-id=<uuid>
```

The command prints only run ID, status, cache/usage counts, conflict count, and a
stable safe error code. It never prints source text, model output, or secrets.

Force a reviewed rerun:

```bash
npm run extraction:run -- --application-id=<uuid> --force
```

Force reruns spend tokens and are audited. Use them only after source,
prompt/schema, model, or operational changes.

## Batch

```bash
npm run extraction:pending
```

Run this only in a trusted server environment with the server Supabase key and
OpenAI key. The UI batch action is administrator-only. No scheduler is selected
until the deployment target is chosen.

## Error handling and retries

Stable safe error codes cover missing/invalid authentication, unavailable model,
rate limit, timeout, network/service failure, refusal, incomplete/malformed
output, oversized input, missing eligible sources, and persistence failure.
Retryable rate-limit/service errors use two bounded backoff retries. Auth,
refusal, malformed output, and validation failures do not retry. Previous
successful extracted fields remain intact after a failed run.

Review `extraction_runs` and the application audit log. Never copy a raw API
exception, prompt, source document, or model output into logs or tickets.

## Manual correction

Specialists and administrators may edit a value, select a conflict candidate,
or set it to null with a reason. Corrections are audited and stored in immutable
history. Later automatic extraction cannot overwrite a corrected field.

## Live and hosted verification

```bash
npm run test:integration
npm run test:extraction:live
npm run test:extraction:eval
```

Hosted RLS tests use ordinary admin, active specialist, inactive specialist, and
anonymous sessions. The server key is used only for worker/setup operations.
The live test creates and then removes only its own synthetic rows after checking
fresh-session persistence, cache, conflict, correction, audit, token usage, and
OCR exclusion.

The extraction/completeness boundary is strict: Phase 4 records facts, nulls,
review flags, and conflicts. Phase 5 will decide which fields a selected
template requires and control clarification workflow.
