import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin.server";
import { EMAIL_ATTACHMENT_BUCKET } from "@/modules/email/attachments";

import { DocumentProcessingError, errorResult } from "./errors";
import { DOCUMENT_LIMITS } from "./limits";
import { selectDocumentParser } from "./registry";
import { validateDocument } from "./security";
import type { ClaimedAttachment, ParserResult } from "./types";

type ClaimPayload = {
  attachment_id: string;
  application_id: string | null;
  attempt_id: string;
  original_filename: string;
  sanitized_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  checksum: string;
};

function mapClaim(payload: ClaimPayload): ClaimedAttachment {
  return {
    attachmentId: payload.attachment_id,
    applicationId: payload.application_id,
    attemptId: payload.attempt_id,
    originalFilename: payload.original_filename,
    sanitizedFilename: payload.sanitized_filename,
    mimeType: payload.mime_type,
    sizeBytes: Number(payload.size_bytes),
    storagePath: payload.storage_path,
    checksum: payload.checksum,
  };
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new DocumentProcessingError(
            "PARSER_TIMEOUT",
            "Document parsing exceeded the 30-second time limit.",
          ),
        ),
      DOCUMENT_LIMITS.parserTimeoutMs,
    );
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runParser(
  supabase: SupabaseClient,
  claim: ClaimedAttachment,
): Promise<ParserResult> {
  const download = await supabase.storage
    .from(EMAIL_ATTACHMENT_BUCKET)
    .download(claim.storagePath);
  if (download.error || !download.data) {
    throw new DocumentProcessingError(
      "STORAGE_DOWNLOAD_FAILED",
      "The private attachment could not be downloaded for parsing.",
    );
  }
  const content = Buffer.from(await download.data.arrayBuffer());
  const validated = await validateDocument(claim, content);
  const parser = selectDocumentParser(validated);
  return withTimeout(parser.parse(validated));
}

async function finalize(
  supabase: SupabaseClient,
  claim: ClaimedAttachment,
  result: ParserResult,
) {
  const response = await supabase.rpc("finalize_document_parse", {
    p_attachment_id: claim.attachmentId,
    p_attempt_id: claim.attemptId,
    p_result: {
      detected_language: result.detectedLanguage ?? null,
      error_code: result.errorCode ?? null,
      error_message: result.errorMessage ?? null,
      normalized_text: result.normalizedText,
      parser_type: result.parserType,
      parser_version: result.parserVersion,
      source_metadata: result.sourceMetadata,
      status: result.status,
      warnings: result.warnings,
    },
  });
  if (response.error) {
    throw new Error(`Unable to persist document parse result: ${response.error.message}`);
  }
}

export async function parseAttachment(
  attachmentId?: string,
  supabase: SupabaseClient = createAdminClient(),
) {
  const claimed = await supabase.rpc("claim_attachment_for_parsing", {
    p_attachment_id: attachmentId ?? null,
  });
  if (claimed.error) {
    throw new Error(`Unable to claim attachment: ${claimed.error.message}`);
  }
  if (!claimed.data) return null;

  const claim = mapClaim(claimed.data as unknown as ClaimPayload);
  let result: ParserResult;
  try {
    result = await runParser(supabase, claim);
  } catch (error) {
    result = errorResult(error);
  }
  await finalize(supabase, claim, result);
  return { attachmentId: claim.attachmentId, result };
}

export async function parsePendingAttachments(
  maximum = 100,
  supabase: SupabaseClient = createAdminClient(),
) {
  const results: Array<NonNullable<Awaited<ReturnType<typeof parseAttachment>>>> =
    [];
  while (results.length < maximum) {
    const parsed = await parseAttachment(undefined, supabase);
    if (!parsed) break;
    results.push(parsed);
  }
  return results;
}
