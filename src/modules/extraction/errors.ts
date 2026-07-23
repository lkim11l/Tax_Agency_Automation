export type ExtractionErrorCode =
  | "API_AUTHENTICATION_FAILED"
  | "MODEL_UNAVAILABLE"
  | "RATE_LIMITED"
  | "API_TIMEOUT"
  | "NETWORK_ERROR"
  | "REFUSED"
  | "INCOMPLETE_RESPONSE"
  | "MALFORMED_OUTPUT"
  | "INPUT_TOO_LARGE"
  | "PERSISTENCE_FAILED"
  | "NO_ELIGIBLE_SOURCES"
  | "EXTRACTION_FAILED";

export class ExtractionError extends Error {
  constructor(
    public readonly code: ExtractionErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}
export function toSafeExtractionError(error: unknown) {
  if (error instanceof ExtractionError) return error;
  if (error && typeof error === "object") {
    const status = "status" in error ? Number(error.status) : null;
    const name = "name" in error ? String(error.name) : "";
    if (status === 401 || status === 403) {
      return new ExtractionError(
        "API_AUTHENTICATION_FAILED",
        "OpenAI authentication failed.",
      );
    }
    if (status === 404) {
      return new ExtractionError("MODEL_UNAVAILABLE", "Configured model is unavailable.");
    }
    if (status === 429) {
      return new ExtractionError("RATE_LIMITED", "OpenAI rate limit reached.", true);
    }
    if (status !== null && status >= 500) {
      return new ExtractionError("NETWORK_ERROR", "OpenAI service is unavailable.", true);
    }
    if (/timeout|abort/iu.test(name)) {
      return new ExtractionError("API_TIMEOUT", "OpenAI request timed out.", true);
    }
  }
  return new ExtractionError("EXTRACTION_FAILED", "Structured extraction failed.");
}
