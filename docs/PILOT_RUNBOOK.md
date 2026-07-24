# Pilot runbook

## Daily operator routine

1. Sign in and open **Состояние системы**. Investigate unavailable components,
   failed jobs, or a mailbox run older than 15 minutes.
2. Review new applications, attachment parse warnings, extraction conflicts and
   completeness evidence.
3. Correct only values verified against source material.
4. Approve and send clarifications and contracts only through the explicit
   human-review controls.
5. Reconcile ambiguous SMTP results before any retry.
6. Review the registry and export the monthly report when required.

## Safe intervention

An administrator may run the mailbox pipeline from `/settings`. Repeated runs
are expected to be idempotent. Never run two independent schedulers. Never use
database reset in production. Record pilot defects separately from feature
requests.

## Pilot acceptance

Use synthetic names, documents and addresses. Execute the complete inbound
email → reply → extraction → completeness → generation → review → delivery →
registry → report scenario. Repeat the pipeline run and verify no duplicate
email, application, attachment, extraction, history or delivery. The production
pilot must not start until deployment, backup evidence, restore rehearsal and
this scenario are signed off.
