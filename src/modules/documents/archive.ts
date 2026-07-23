import yauzl from "yauzl";

import { DocumentProcessingError } from "./errors";
import { DOCUMENT_LIMITS } from "./limits";

export type ArchiveInspection = {
  entries: string[];
  expandedBytes: number;
};

function unsafeEntryName(name: string) {
  const normalized = name.replaceAll("\\", "/");
  return (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..")
  );
}

export function inspectOfficeArchive(content: Buffer): Promise<ArchiveInspection> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      content,
      { autoClose: true, lazyEntries: true, validateEntrySizes: true },
      (openError, zipfile) => {
        if (openError || !zipfile) {
          reject(
            new DocumentProcessingError(
              "CORRUPT_DOCUMENT",
              "The Office document archive is corrupt.",
            ),
          );
          return;
        }

        const entries: string[] = [];
        let expandedBytes = 0;
        const fail = (error: Error) => {
          zipfile.close();
          reject(error);
        };

        zipfile.on("error", (error) => {
          if (/relative path|absolute path/i.test(error.message)) {
            fail(
              new DocumentProcessingError(
                "ARCHIVE_BLOCKED",
                "The document contains an unsafe archive path.",
                "blocked",
              ),
            );
            return;
          }
          fail(
            new DocumentProcessingError(
              "CORRUPT_DOCUMENT",
              "The Office document archive is corrupt.",
            ),
          );
        });
        zipfile.on("entry", (entry) => {
          if (unsafeEntryName(entry.fileName)) {
            fail(
              new DocumentProcessingError(
                "ARCHIVE_BLOCKED",
                "The document contains an unsafe archive path.",
                "blocked",
              ),
            );
            return;
          }
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            fail(
              new DocumentProcessingError(
                "ENCRYPTED_DOCUMENT",
                "Encrypted Office documents require manual review.",
                "review_required",
              ),
            );
            return;
          }

          entries.push(entry.fileName);
          expandedBytes += entry.uncompressedSize;
          const ratio =
            entry.compressedSize === 0
              ? entry.uncompressedSize === 0
                ? 1
                : Number.POSITIVE_INFINITY
              : entry.uncompressedSize / entry.compressedSize;
          if (
            entries.length > DOCUMENT_LIMITS.maxArchiveEntries ||
            expandedBytes > DOCUMENT_LIMITS.maxArchiveExpandedBytes ||
            ratio > DOCUMENT_LIMITS.maxArchiveRatio
          ) {
            fail(
              new DocumentProcessingError(
                "ARCHIVE_LIMIT_EXCEEDED",
                "The document archive exceeds safe expansion limits.",
                "blocked",
              ),
            );
            return;
          }
          zipfile.readEntry();
        });
        zipfile.on("end", () => resolve({ entries, expandedBytes }));
        zipfile.readEntry();
      },
    );
  });
}
