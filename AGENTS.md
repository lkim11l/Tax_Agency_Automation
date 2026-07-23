# AGENTS.md — Tax Agency Automation

## 1. Mission

Build a reliable MVP that automates the contract workflow:

incoming email → application record → document parsing → structured data extraction →
missing-data check → clarification draft → contract generation → human approval →
client delivery → registry → monthly report.

The goal is operational reliability, auditability, and fast delivery. Visual polish is not a priority.

## 2. Mandatory reading order

Before changing any code, read these files in order:

1. `AGENTS.md`
2. `docs/SCOPE.md`
3. `docs/ROADMAP.md`
4. `docs/CURRENT_SPRINT.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`
7. `README.md`

Do not start implementation until the current phase and the next unchecked task are clear.

## 3. Source of truth

- MVP boundaries: `docs/SCOPE.md`
- Delivery sequence and acceptance criteria: `docs/ROADMAP.md`
- Tasks currently allowed: `docs/CURRENT_SPRINT.md`
- Architecture and module boundaries: `docs/ARCHITECTURE.md`
- Technical decisions: `docs/DECISIONS.md`

When documents conflict, use this priority:

1. Direct user instruction
2. `AGENTS.md`
3. `docs/SCOPE.md`
4. `docs/CURRENT_SPRINT.md`
5. `docs/ROADMAP.md`
6. Other documentation

## 4. Non-negotiable MVP rules

1. Human approval is mandatory before sending any contract.
2. AI must never invent missing legal, financial, company, or signer data.
3. Generated contracts may use only customer-approved templates.
4. Unsupported or ambiguous cases must move to manual review.
5. Every important action must be auditable.
6. Incoming messages and attachments must not be silently lost.
7. Duplicate email processing must be prevented.
8. Secrets and personal data must not be logged.
9. Do not implement 1C, SBIS, digital signatures, multi-tenant billing, advanced CRM, or autonomous legal review in MVP.
10. Do not spend time on animations, marketing pages, custom design systems, or visual polish before the end-to-end flow works.

## 5. Work selection rule

Work only on the first incomplete task in `docs/CURRENT_SPRINT.md`, unless a direct user instruction explicitly changes priority.

Do not:
- jump to a later phase;
- create speculative modules;
- refactor unrelated code;
- add “nice to have” features;
- redesign working screens;
- introduce a new dependency without a clear need.

If blocked:
1. record the blocker in `docs/CURRENT_SPRINT.md`;
2. implement the safest useful fallback where possible;
3. continue with another task only if it does not violate the roadmap;
4. report the blocker clearly.

## 6. Required work loop

For every Codex task:

1. Read the mandatory files.
2. Inspect the repository and current git diff.
3. Identify the exact roadmap item being implemented.
4. State the intended change in one short paragraph.
5. Implement the smallest complete vertical slice.
6. Add or update database migrations when data models change.
7. Add tests for critical behavior.
8. Run validation commands.
9. Update `docs/CURRENT_SPRINT.md`.
10. Update `docs/DECISIONS.md` only when a real architectural decision was made.
11. Update README only when setup or usage changed.
12. Summarize:
   - completed roadmap item;
   - files changed;
   - tests run;
   - known limitations;
   - next allowed task.

## 7. Definition of done

A task is done only when:

- the implementation is connected to the real application flow;
- no button or route is a fake no-op;
- errors are handled and visible;
- sensitive values are not exposed;
- tests cover the core path;
- lint, type checking, tests, and build pass;
- documentation reflects the actual state;
- the task checkbox is updated only after validation.

Do not mark a task complete because code was merely scaffolded.

## 8. Validation commands

Use the commands defined in `package.json`. The expected baseline is:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If a command does not exist yet, add it during repository foundation work.

For database changes, also verify that migrations apply cleanly in a fresh environment.

## 9. Security and data handling

- Never commit `.env`, credentials, API keys, refresh tokens, email passwords, or customer documents.
- Use `.env.example` with placeholder values.
- Validate file type and size.
- Sanitize filenames.
- Restrict file access to authenticated users.
- Apply least-privilege access.
- Keep an audit record for email ingestion, data edits, generation, approval, and sending.
- Avoid storing raw AI prompts containing secrets in logs.
- Never use production customer documents as public fixtures.

## 10. AI behavior

AI output must be structured and schema-validated.

For extracted fields, store:
- normalized value;
- source document or email;
- source excerpt where safe;
- confidence or review flag;
- whether the value was manually corrected.

AI must return `null` or an explicit missing state when data is absent.

AI must not:
- infer company identifiers;
- calculate or fabricate payment terms;
- invent signer authority;
- rewrite legal clauses outside approved template fields;
- decide that a contract is legally safe.

## 11. Email behavior

- Start with one configured mailbox.
- Preserve provider message IDs and thread IDs.
- Use idempotency to avoid duplicate applications.
- Link replies to the original application.
- Save send attempts and errors.
- Do not mark a contract as sent until the provider confirms success.
- Clarification emails require human approval in MVP unless the user explicitly changes this rule.

## 12. Document generation behavior

- Use only approved DOCX templates.
- Template variables must be explicit and validated.
- Generation must fail visibly if required variables remain unresolved.
- Keep generated versions immutable.
- Save the exact version that was approved and sent.
- PDF generation is secondary to correct DOCX generation.

## 13. UI rules

Build a plain internal operations interface.

Required:
- readable tables;
- clear statuses;
- forms for manual correction;
- error messages;
- approval controls;
- download links;
- basic filters.

Not required:
- animations;
- custom illustrations;
- advanced dashboards;
- theme switching;
- complex responsive design;
- visual branding.

## 14. Completion response format

At the end of each Codex run, report:

```text
Roadmap item:
Completed:
Files changed:
Database changes:
Validation:
Known limitations:
Next allowed task:
```
