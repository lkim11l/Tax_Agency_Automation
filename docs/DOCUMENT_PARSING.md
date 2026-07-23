# Document Parsing

## Scope

Phase 3 converts private email attachments into normalized text and source
metadata. It does not perform AI extraction, OCR, legal interpretation, or
Phase 4 work.

## Pipeline

```text
pending attachment
  -> atomic database claim
  -> private Storage download
  -> checksum, size, extension, MIME, signature and archive validation
  -> format-neutral parser registry
  -> format parser
  -> deterministic normalization with source markers
  -> atomic current-result, immutable-attempt and audit persistence
```

`DocumentParser` is the application boundary. The orchestrator does not depend
on Mammoth, PDF.js, ExcelJS, CSV Parse, or an OCR implementation. A parser
declares whether it supports a validated document and returns a typed result.

## Supported formats

- DOCX: paragraphs, headings, list items, tables, and logical breaks through
  Mammoth. DOCM and embedded VBA are blocked.
- text PDF: every page is extracted with PDF.js and prefixed with `[PAGE N]`.
  A document without a reliable text layer becomes
  `review_required / OCR_REQUIRED`.
- XLSX: every non-empty sheet, original sheet name, row number, cell address,
  strings, numbers, dates, and cached formula results through ExcelJS. An
  uncalculated formula is inert text prefixed with an apostrophe. XLSM and
  embedded VBA are blocked.
- TXT: strict UTF-8, UTF-8 BOM, UTF-16LE BOM, and UTF-16BE BOM decoding.
- CSV: safe cell parsing with `[ROW N]`; formula-like cells are prefixed with an
  apostrophe in normalized output.
- JPEG, PNG, WebP, and TIFF: signatures are validated, then status becomes
  `review_required / OCR_REQUIRED`. OCR is deliberately not enabled.
- other safe non-executable types: retained privately and marked
  `unsupported / UNSUPPORTED_FORMAT`.

## Persisted model

`attachments.parse_status` uses `pending`, `processing`, `parsed`,
`review_required`, `unsupported`, `blocked`, and `failed`.

`parsed_documents` holds the current result per attachment. It records parser
and version, normalized text and exact character count, source metadata,
warnings, safe error data, and timestamps. `document_parse_attempts` is an
append-only history; a completed attempt cannot be changed or deleted.
Attempts are removed only by the database's existing cascade when their parent
attachment/application is intentionally deleted.

The database claim uses `FOR UPDATE SKIP LOCKED`, so concurrent workers cannot
parse one pending attachment twice. A retry creates a new attempt and replaces
only the current result. The source attachment remains immutable. A file with a
different checksum is a different attachment record.

## Security limits

- raw file: 10 MiB
- normalized text: 2,000,000 characters
- PDF: 200 pages
- workbook: 50 non-empty sheets, 20,000 rows, 200,000 cells
- Office archive: 5,000 entries, 100 MiB expanded, maximum per-entry ratio 200
- parser wall-clock guard: 30 seconds

Validation rejects checksum/size mismatches, empty files, extension/MIME/content
spoofing, executable signatures, active-content extensions, standalone
archives, unsafe archive paths, encrypted Office archives, macros, malformed
Office structures, and expansion-risk archives. PDF encryption and scanned
documents remain visible for review. Error messages never contain document
text, object paths, credentials, or provider details.

## Stable error codes

`ARCHIVE_BLOCKED`, `ARCHIVE_LIMIT_EXCEEDED`, `CHECKSUM_MISMATCH`,
`CORRUPT_DOCUMENT`, `EMPTY_FILE`, `ENCRYPTED_DOCUMENT`,
`EXECUTABLE_BLOCKED`, `FILE_LIMIT_EXCEEDED`, `FILE_TOO_LARGE`,
`MACROS_BLOCKED`, `MIME_EXTENSION_MISMATCH`, `OCR_REQUIRED`,
`PARSER_TIMEOUT`, `STORAGE_DOWNLOAD_FAILED`, and `UNSUPPORTED_FORMAT`.

## Access control and audit

Active specialists and administrators can read attachment metadata, current
parse results, attempts, and original files through authenticated RLS. Anonymous
and inactive-user reads are empty/denied. Only the server worker may claim and
finalize work. Only an administrator may request a parse or retry.

Audit actions are `document.parse_started`, `document.parsed`,
`document.parse_failed`, `document.parse_warning`,
`document.parse_review_required`, `document.parse_unsupported`,
`document.parse_blocked`, `document.parse_requested`, and
`document.parse_retried`. Audit metadata contains counts, parser identity, and
safe error codes, never extracted text.

## Deferred OCR extension

Phase 3 defines `OcrProvider`, `OcrResult`, per-page OCR words, and deterministic
quality metrics: page/blank-page counts, recognized characters and words, mean
word confidence, low-confidence count/ratio, and duration. No provider is
installed or invoked.

The existing parser interface does not change. Image and scanned-PDF parsers
continue to return `review_required / OCR_REQUIRED`. A future orchestrator stage
can use `isOcrCandidate()`, pass the already validated private bytes to one
configured `OcrProvider`, normalize its result, and finalize through the same
database function. Quality metrics fit in existing `source_metadata`; no parser
or schema replacement is required.

A local adapter may later execute a resource-limited worker process, while a
deployment adapter may call a private Linux OCR worker. Both must implement the
same interface and must not send documents to an LLM.

For OCRmyPDF with Tesseract `rus+eng`, the minimum practical installation needs:

- 64-bit Python and OCRmyPDF;
- Tesseract OCR with `eng.traineddata`, `rus.traineddata`, and normally
  `osd.traineddata`;
- `pypdfium2` or Ghostscript for PDF rasterization;
- `fpdf2` and `uharfbuzz` for text-layer rendering;
- fonts with Cyrillic coverage, preferably Noto;
- temporary disk, CPU, and memory limits.

Ghostscript, VeraPDF, `unpaper`, `pngquant`, and lossless `jbig2enc` are useful
recommended/optional components depending on PDF/A, cleanup, and optimization
requirements.

Native Windows can be used for controlled development, but it requires several
independent 64-bit installations, PATH/registry discovery, and manual Russian
trained-data management. It is not the recommended production environment.
Use a locked Linux container/worker (Ubuntu 24.04 LTS or the maintained
OCRmyPDF image) running non-root with no public endpoint, no unnecessary
network egress, strict file/time/memory limits, ephemeral working storage, and
private object access. Docker Desktop or WSL2 is the preferred Windows
development route.
