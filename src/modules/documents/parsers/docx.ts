import { load } from "cheerio";
import mammoth from "mammoth";

import { DocumentProcessingError } from "../errors";
import { normalizeDocumentText } from "../normalization";
import type { DocumentParser, ParserResult, ValidatedDocument } from "../types";
import { DOCUMENT_PARSER_VERSION } from "../types";

function htmlToLogicalText(html: string) {
  const $ = load(html);
  const blocks: string[] = [];

  $("body")
    .find("h1,h2,h3,h4,h5,h6,p,table")
    .each((_, element) => {
      const current = $(element);
      const tag = element.tagName.toLowerCase();
      if (tag === "p" && current.parents("table").length > 0) return;
      if (tag === "table") {
        current.find("tr").each((__, row) => {
          const cells = $(row)
            .find("th,td")
            .map((___, cell) => $(cell).text().replace(/\s+/g, " ").trim())
            .get();
          if (cells.some(Boolean)) blocks.push(cells.join(" | "));
        });
        blocks.push("");
        return;
      }

      const text = current.text().replace(/\s+/g, " ").trim();
      if (!text) return;
      if (/^h[1-6]$/.test(tag)) {
        blocks.push(`${"#".repeat(Number(tag[1]))} ${text}`);
      } else if (current.parents("li").length > 0) {
        blocks.push(`- ${text}`);
      } else {
        blocks.push(text);
      }
    });
  return blocks.join("\n");
}

export class DocxParser implements DocumentParser {
  readonly type = "docx-mammoth";
  readonly version = `${DOCUMENT_PARSER_VERSION}:mammoth-1.12.0`;

  supports(document: ValidatedDocument) {
    return document.format === "docx";
  }

  async parse(document: ValidatedDocument): Promise<ParserResult> {
    try {
      const converted = await mammoth.convertToHtml(
        { buffer: document.content },
        {
          convertImage: mammoth.images.imgElement(() =>
            Promise.resolve({ src: "" }),
          ),
        },
      );
      const normalized = normalizeDocumentText(
        htmlToLogicalText(converted.value),
      );
      if (!normalized.text) {
        throw new DocumentProcessingError(
          "CORRUPT_DOCUMENT",
          "The DOCX contains no readable text.",
          "review_required",
        );
      }
      return {
        status: "parsed",
        parserType: this.type,
        parserVersion: this.version,
        normalizedText: normalized.text,
        sourceMetadata: {
          logical_blocks: normalized.text.split("\n").filter(Boolean).length,
        },
        warnings: [
          ...converted.messages.map((message) => message.message),
          ...normalized.warnings,
        ],
      };
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      throw new DocumentProcessingError(
        "CORRUPT_DOCUMENT",
        "The DOCX could not be parsed safely.",
      );
    }
  }
}
