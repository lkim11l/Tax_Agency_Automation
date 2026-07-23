# Tax Agency Automation

Functional MVP for AI-assisted contract workflow automation.

## Product flow

```text
Email
  ↓
Application
  ↓
Attachment parsing
  ↓
Structured extraction
  ↓
Missing-data review
  ↓
Clarification
  ↓
DOCX generation
  ↓
Human approval
  ↓
Email delivery
  ↓
Registry and reporting
```

## Current priority

Reliability first. The interface should be simple and operational. No design polish should delay the end-to-end workflow.

## Start here

Codex and developers must read:

1. `AGENTS.md`
2. `docs/SCOPE.md`
3. `docs/ROADMAP.md`
4. `docs/CURRENT_SPRINT.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`

## Initial MVP stack

- Next.js with TypeScript
- PostgreSQL / Supabase
- Server-side API routes or services
- OpenAI API for structured extraction and controlled text generation
- One email provider selected during setup
- DOCX template generation
- Object storage for attachments and generated documents

Exact package versions must be selected during repository foundation and recorded in `docs/DECISIONS.md`.

## Core commands

The repository must provide:

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

## Status

See `docs/CURRENT_SPRINT.md`.
