import type { CompletenessRuleSet } from "./rules";

export type CompletenessFieldInput = {
  fieldName: string;
  value: unknown;
  sourceType: string | null;
  sourceId: string | null;
  sourceMarker: string | null;
  sourceExcerpt: string | null;
  confidence: number | null;
  requiresReview: boolean;
  conflictDetected: boolean;
  manuallyCorrected: boolean;
  accepted?: boolean;
};

export type FieldResultStatus =
  | "complete"
  | "missing"
  | "conflict"
  | "low_confidence"
  | "review_required"
  | "invalid";

export type CompletenessFieldResult = {
  fieldName: string;
  label: string;
  question: string;
  required: boolean;
  status: FieldResultStatus;
  blocking: boolean;
  confidence: number | null;
  reason: string | null;
};

export type CompletenessResult = {
  total: number;
  complete: number;
  missing: number;
  conflicts: number;
  lowConfidence: number;
  reviewRequired: number;
  invalid: number;
  percentage: number;
  blocking: boolean;
  ready: boolean;
  fields: CompletenessFieldResult[];
};

function isPresent(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function evaluateCompleteness(
  ruleSet: CompletenessRuleSet,
  fieldInputs: CompletenessFieldInput[],
): CompletenessResult {
  const byName = new Map(fieldInputs.map((field) => [field.fieldName, field]));
  const fields = ruleSet.rules.map((rule): CompletenessFieldResult => {
    const field = byName.get(rule.fieldName);
    const conditionalSatisfied = (rule.requiredUnlessAny ?? []).some((name) =>
      isPresent(byName.get(name)?.value),
    ) || (
      (rule.requiredUnlessAll?.length ?? 0) > 0 &&
      rule.requiredUnlessAll!.every((name) => isPresent(byName.get(name)?.value))
    );
    const required = rule.required && !conditionalSatisfied;
    let status: FieldResultStatus = "complete";
    let reason: string | null = null;

    if (!field || !isPresent(field.value)) {
      status = required ? "missing" : "complete";
      reason = required ? "VALUE_MISSING" : null;
    } else if (field.conflictDetected && rule.conflictBlocks !== false) {
      status = "conflict";
      reason = "CONFLICT_BLOCKS_COMPLETENESS";
    } else if (field.manuallyCorrected && !rule.allowManualConfirmation) {
      status = "invalid";
      reason = "MANUAL_CONFIRMATION_NOT_ALLOWED";
    } else if (
      !field.manuallyCorrected &&
      (!field.sourceType ||
        !field.sourceId ||
        !field.sourceMarker ||
        !field.sourceExcerpt)
    ) {
      status = "invalid";
      reason = "SOURCE_ATTRIBUTION_REQUIRED";
    } else if (field.accepted) {
      status = "complete";
      reason = null;
    } else if (
      !field.manuallyCorrected &&
      (field.confidence ?? 0) < rule.minimumConfidence
    ) {
      status = "low_confidence";
      reason = "CONFIDENCE_BELOW_THRESHOLD";
    } else if (field.requiresReview && !field.manuallyCorrected) {
      status = "review_required";
      reason = "MANUAL_REVIEW_REQUIRED";
    }
    return {
      fieldName: rule.fieldName,
      label: rule.label,
      question: rule.question,
      required,
      status,
      blocking: required && status !== "complete",
      confidence: field?.confidence ?? null,
      reason,
    };
  });
  const count = (status: FieldResultStatus) =>
    fields.filter((field) => field.status === status).length;
  const total = fields.filter((field) => field.required).length;
  const complete = fields.filter(
    (field) => field.required && field.status === "complete",
  ).length;
  const blocking = fields.some((field) => field.blocking);
  return {
    total,
    complete,
    missing: count("missing"),
    conflicts: count("conflict"),
    lowConfidence: count("low_confidence"),
    reviewRequired: count("review_required"),
    invalid: count("invalid"),
    percentage: total === 0 ? 100 : Math.round((complete / total) * 100),
    blocking,
    ready: !blocking,
    fields,
  };
}

export function buildClarificationDraft(input: {
  applicationNumber: string;
  recipientName?: string | null;
  result: CompletenessResult;
}) {
  const questions = input.result.fields.filter((field) => field.blocking);
  const greeting = input.recipientName?.trim()
    ? `Здравствуйте, ${input.recipientName.trim()}!`
    : "Здравствуйте!";
  const numbered = questions
    .map((field, index) => `${index + 1}. ${field.question}`)
    .join("\n");
  return [
    greeting,
    "",
    `Для продолжения работы по заявке ${input.applicationNumber} просим уточнить следующие сведения:`,
    "",
    numbered,
    "",
    "Пожалуйста, ответьте на это письмо, сохранив тему переписки.",
    "",
    "С уважением,",
    "специалист договорного отдела",
  ].join("\n");
}
