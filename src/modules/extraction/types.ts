import type { ExtractionFieldName } from "./constants";

export type ExtractionSource = {
  sourceType: "email_message" | "parsed_document" | "application" | "counterparty";
  sourceId: string;
  sourceMarker: string;
  text: string;
  checksum: string;
  parserVersion?: string;
  ocrDerived?: boolean;
};
export type CandidateKind =
  | "inn"
  | "kpp"
  | "ogrn"
  | "bik"
  | "bank_account"
  | "correspondent_account"
  | "email"
  | "phone"
  | "date"
  | "amount"
  | "currency";

export type DeterministicCandidate = {
  fieldName: ExtractionFieldName | null;
  kind: CandidateKind;
  value: string;
  normalizedValue: string;
  sourceType: ExtractionSource["sourceType"];
  sourceId: string;
  sourceMarker: string;
  sourceExcerpt: string;
  validatorValid: boolean;
  confidenceSource: "regex_validated" | "regex_unvalidated";
  requiresReview: boolean;
};

export type SelectedFragment = {
  sourceType: ExtractionSource["sourceType"];
  sourceId: string;
  sourceMarker: string;
  text: string;
};

export type ExtractionRunResult = {
  runId: string;
  status: "completed" | "failed" | "cache_hit" | "already_running";
  cacheHit: boolean;
  inputCharacters: number;
  inputTokens: number | null;
  outputTokens: number | null;
  conflictCount: number;
  errorCode?: string;
};
