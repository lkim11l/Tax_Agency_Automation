import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  EXTRACTION_MODEL,
  MAX_EXTRACTION_RETRIES,
} from "./constants";
import { ExtractionError, toSafeExtractionError } from "./errors";
import { contractExtractionSchema, type ContractExtraction } from "./schema";

export type OpenAiExtractionResponse = {
  extraction: ContractExtraction;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  retryCount: number;
};

function apiKey() {
  const value = process.env.OPENAI_API_KEY?.trim();
  if (!value) {
    throw new ExtractionError(
      "API_AUTHENTICATION_FAILED",
      "OPENAI_API_KEY is not configured.",
    );
  }
  return value;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function extractWithOpenAi(input: {
  instructions: string;
  sourceText: string;
  onRetry?: (input: { attempt: number; errorCode: string }) => Promise<void>;
}): Promise<OpenAiExtractionResponse> {
  const client = new OpenAI({
    apiKey: apiKey(),
    timeout: 60_000,
    maxRetries: 0,
  });
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= MAX_EXTRACTION_RETRIES; attempt += 1) {
    try {
      const { data, request_id: requestId } = await client.responses
        .parse({
          model: EXTRACTION_MODEL,
          instructions: input.instructions,
          input: input.sourceText,
          store: false,
          max_output_tokens: 12_000,
          text: {
            format: zodTextFormat(contractExtractionSchema, "contract_extraction"),
          },
        })
        .withResponse();

      if (data.status === "incomplete") {
        throw new ExtractionError(
          "INCOMPLETE_RESPONSE",
          "OpenAI returned an incomplete structured response.",
        );
      }
      if (!data.output_parsed) {
        const refused = data.output.some(
          (item) =>
            item.type === "message" &&
            item.content.some((content) => content.type === "refusal"),
        );
        throw new ExtractionError(
          refused ? "REFUSED" : "MALFORMED_OUTPUT",
          refused
            ? "OpenAI refused the extraction request."
            : "OpenAI returned no schema-valid output.",
        );
      }

      // The SDK applies strict JSON Schema parsing; this second pass is the
      // application-owned validation boundary.
      const extraction = contractExtractionSchema.safeParse(data.output_parsed);
      if (!extraction.success) {
        throw new ExtractionError(
          "MALFORMED_OUTPUT",
          "OpenAI output failed local schema validation.",
        );
      }
      return {
        extraction: extraction.data,
        requestId,
        inputTokens: data.usage?.input_tokens ?? null,
        outputTokens: data.usage?.output_tokens ?? null,
        durationMs: Date.now() - startedAt,
        retryCount: attempt,
      };
    } catch (error) {
      const safe = toSafeExtractionError(error);
      if (!safe.retryable || attempt >= MAX_EXTRACTION_RETRIES) throw safe;
      await input.onRetry?.({ attempt: attempt + 1, errorCode: safe.code });
      await sleep(250 * 3 ** attempt);
    }
  }
  throw new ExtractionError("EXTRACTION_FAILED", "Structured extraction failed.");
}
