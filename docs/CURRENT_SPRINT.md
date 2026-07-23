# Current Sprint

## Current phase

Phase 0 — Repository foundation

## Sprint goal

Create a clean, reproducible, testable application baseline. Do not implement email, AI extraction, or document generation yet.

## Allowed tasks

Complete in this exact order:

- [ ] Inspect repository state and preserve existing user work.
- [ ] Initialize a Next.js TypeScript application in the repository root.
- [ ] Enable strict TypeScript.
- [ ] Add linting and formatting.
- [ ] Add unit test runner.
- [ ] Add scripts:
  - [ ] `dev`
  - [ ] `lint`
  - [ ] `typecheck`
  - [ ] `test`
  - [ ] `build`
- [ ] Add `.env.example` with placeholders only.
- [ ] Add secure `.gitignore`.
- [ ] Add initial database configuration.
- [ ] Add an authenticated application boundary.
- [ ] Add `/api/health`.
- [ ] Add a minimal internal layout:
  - [ ] Applications
  - [ ] Templates
  - [ ] Reports
  - [ ] Settings
- [ ] Add CI validation.
- [ ] Update README setup instructions.
- [ ] Run all validation commands.
- [ ] Mark Phase 0 roadmap items complete only after validation.

## UI limitation

Use plain components and basic styling. Do not add:
- animation;
- charts;
- custom theme system;
- marketing landing page;
- complex dashboard;
- decorative components.

## Current blockers

- Email provider is not selected.
- Approved contract templates have not yet been added.
- Required field matrix has not yet been confirmed.
- Customer sample documents have not yet been added.

These blockers do not prevent Phase 0.

## Sprint completion report

When Phase 0 is complete, record:

- framework and package versions;
- database choice;
- authentication choice;
- test runner;
- deployment target;
- validation results;
- remaining setup requirements.
