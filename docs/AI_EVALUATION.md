# AI Extraction Evaluation

## Synthetic set

`npm run test:extraction:eval` runs 15 artificial scenarios:

1. complete requisites;
2. missing amount;
3. missing signer authority;
4. two INNs;
5. conflicting email/document amounts;
6. XLSX requisites;
7. DOCX subject;
8. PDF dates;
9. Russian text;
10. mixed Russian/English text;
11. incomplete OCR text (AI call deliberately skipped);
12. text without required data;
13. prompt injection;
14. false “ignore rules” instruction;
15. multiple counterparties.

No customer document, mailbox content, credential, or production identifier is
used. Document text is always treated as untrusted data.

## Metrics

The command reports exact and normalized match, missing-field precision,
conflict detection, source attribution, hallucination count, schema validity,
average input/output tokens, average latency, and OCR_REQUIRED AI-call count.
Acceptance requires:

- schema validity: 100%;
- missing-field precision: 100%;
- conflict detection: 100%;
- source attribution: at least 95%;
- hallucination count: 0;
- OCR_REQUIRED AI calls: 0.

Final accepted run on 2026-07-23:

- 15 scenarios / 14 model calls;
- schema validity 100%;
- exact match 100%;
- normalized match 100%;
- missing-field precision 100%;
- conflict detection 100%;
- source attribution 100%;
- hallucination count 0;
- average input tokens 8,003.21;
- average output tokens 2,089.14;
- average latency 24,057.14 ms;
- OCR_REQUIRED AI calls 0.

The initial prompt-injection evaluation exposed an invalid all-zero INN. The
local deterministic guard was strengthened and the full set was rerun before
acceptance; the model output shape alone is never considered sufficient.
