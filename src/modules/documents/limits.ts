export const DOCUMENT_LIMITS = {
  maxArchiveEntries: 5_000,
  maxArchiveExpandedBytes: 100 * 1024 * 1024,
  maxArchiveRatio: 200,
  maxCells: 200_000,
  maxFileBytes: 10 * 1024 * 1024,
  maxPages: 200,
  maxRows: 20_000,
  maxSheets: 50,
  maxTextCharacters: 2_000_000,
  parserTimeoutMs: 30_000,
} as const;
