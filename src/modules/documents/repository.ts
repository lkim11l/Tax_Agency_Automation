import "server-only";

import { getOperationalContext } from "@/lib/auth/context";

import type { DocumentParseStatus } from "./types";

export type ApplicationDocument = {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  parse_status: DocumentParseStatus;
  parse_error_code: string | null;
  parse_error: string | null;
  parse_started_at: string | null;
  parse_completed_at: string | null;
  parsed_documents:
    | {
        parser_type: string;
        parser_version: string;
        normalized_text: string | null;
        text_length: number;
        source_metadata: Record<string, unknown>;
        warnings: string[];
      }
    | Array<{
        parser_type: string;
        parser_version: string;
        normalized_text: string | null;
        text_length: number;
        source_metadata: Record<string, unknown>;
        warnings: string[];
      }>
    | null;
};

export async function listApplicationDocuments(applicationId: string) {
  const { supabase, profile } = await getOperationalContext();
  const { data, error } = await supabase
    .from("attachments")
    .select(
      "id,original_filename,mime_type,size_bytes,checksum,parse_status,parse_error_code,parse_error,parse_started_at,parse_completed_at,parsed_documents(parser_type,parser_version,normalized_text,text_length,source_metadata,warnings)",
    )
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Unable to load parsed documents: ${error.message}`);
  }
  return {
    documents: (data ?? []) as unknown as ApplicationDocument[],
    isAdmin: profile.role === "admin",
  };
}
