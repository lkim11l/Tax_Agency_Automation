import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DocumentProcessingError } from "./errors";
import { DOCUMENT_LIMITS } from "./limits";
import { validateDocument } from "./security";
import { descriptor, syntheticDocx } from "./test-fixtures";

async function errorCode(work: Promise<unknown>) {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof DocumentProcessingError ? error.code : "unexpected";
  }
}

describe("document security validation", () => {
  it("accepts a signature-valid DOCX with matching metadata", async () => {
    const content = syntheticDocx();
    const validated = await validateDocument(
      descriptor(
        "contract.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content,
      ),
      content,
    );
    expect(validated.format).toBe("docx");
  });

  it("blocks spoofed signatures and checksum changes", async () => {
    const fake = Buffer.from("not a pdf");
    expect(
      await errorCode(
        validateDocument(descriptor("contract.pdf", "application/pdf", fake), fake),
      ),
    ).toBe("MIME_EXTENSION_MISMATCH");
    const content = syntheticDocx();
    const changed = Buffer.concat([content, Buffer.from("changed")]);
    expect(
      await errorCode(
        validateDocument(
          descriptor(
            "contract.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            content,
          ),
          changed,
        ),
      ),
    ).toBe("FILE_LIMIT_EXCEEDED");
  });

  it("blocks macro, traversal and expansion-risk Office archives", async () => {
    const macro = Buffer.from(
      zipSync({
        "word/document.xml": strToU8("<document/>"),
        "word/vbaProject.bin": new Uint8Array([1]),
      }),
    );
    expect(
      await errorCode(
        validateDocument(
          descriptor(
            "contract.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            macro,
          ),
          macro,
        ),
      ),
    ).toBe("MACROS_BLOCKED");

    const traversal = Buffer.from(
      zipSync({
        "../evil": strToU8("unsafe"),
        "word/document.xml": strToU8("<document/>"),
      }),
    );
    expect(
      await errorCode(
        validateDocument(
          descriptor(
            "contract.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            traversal,
          ),
          traversal,
        ),
      ),
    ).toBe("ARCHIVE_BLOCKED");

    const compressed = Buffer.from(
      zipSync({
        "word/document.xml": new Uint8Array(2_000_000),
      }),
    );
    expect(
      await errorCode(
        validateDocument(
          descriptor(
            "contract.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            compressed,
          ),
          compressed,
        ),
      ),
    ).toBe("ARCHIVE_LIMIT_EXCEEDED");
  });

  it("keeps unsupported and empty files visible with stable codes", async () => {
    const unsupported = Buffer.from("safe rtf-like text");
    expect(
      await errorCode(
        validateDocument(
          descriptor("contract.rtf", "application/rtf", unsupported),
          unsupported,
        ),
      ),
    ).toBe("UNSUPPORTED_FORMAT");
    expect(
      await errorCode(
        validateDocument(
          descriptor("empty.txt", "text/plain", Buffer.alloc(0)),
          Buffer.alloc(0),
        ),
      ),
    ).toBe("EMPTY_FILE");
  });

  it("blocks oversized metadata and malformed Office structures", async () => {
    const small = Buffer.from("x");
    expect(
      await errorCode(
        validateDocument(
          {
            ...descriptor("large.txt", "text/plain", small),
            sizeBytes: DOCUMENT_LIMITS.maxFileBytes + 1,
          },
          small,
        ),
      ),
    ).toBe("FILE_TOO_LARGE");

    const malformed = Buffer.from(
      zipSync({ "[Content_Types].xml": strToU8("<Types/>") }),
    );
    expect(
      await errorCode(
        validateDocument(
          descriptor(
            "broken.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            malformed,
          ),
          malformed,
        ),
      ),
    ).toBe("CORRUPT_DOCUMENT");
  });
});
