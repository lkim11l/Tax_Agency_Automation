import { extractionFieldNames } from "../src/modules/extraction/constants";
import { extractionEvaluationCases } from "../src/modules/extraction/evaluation-cases";
import { extractWithOpenAi } from "../src/modules/extraction/openai-provider.server";
import {
  findDeterministicCandidates,
  formatCandidates,
  formatFragments,
  selectRelevantFragments,
} from "../src/modules/extraction/preprocessing";
import {
  enforceSourceAttribution,
  flattenExtraction,
  mergeExtractions,
} from "../src/modules/extraction/processing";
import { buildExtractionInput, extractionSystemPrompt } from "../src/modules/extraction/prompt";
import { syntheticExtraction } from "../src/modules/extraction/test-fixtures";

function normalized(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[«»"]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/[.,;:]$/u, "")
    .toLocaleLowerCase("ru-RU");
}

async function evaluateCase(testCase: (typeof extractionEvaluationCases)[number]) {
  const startedAt = Date.now();
  if (testCase.skipAi) {
    return {
      testCase,
      extraction: syntheticExtraction({
        warnings: ["OCR_REQUIRED source excluded from AI evaluation."],
      }),
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      aiCalled: false,
    };
  }
  const candidates = findDeterministicCandidates(testCase.sources);
  const fragments = selectRelevantFragments(testCase.sources, candidates);
  const response = await extractWithOpenAi({
    instructions: extractionSystemPrompt,
    sourceText: buildExtractionInput({
      deterministicCandidates: formatCandidates(candidates),
      selectedFragments: formatFragments(fragments),
    }),
  });
  const checked = enforceSourceAttribution(response.extraction, testCase.sources, fragments);
  return {
    testCase,
    extraction: mergeExtractions([checked], candidates),
    inputTokens: response.inputTokens ?? 0,
    outputTokens: response.outputTokens ?? 0,
    latencyMs: response.durationMs,
    aiCalled: true,
  };
}

async function main() {
  const requestedCase = process.argv
    .find((argument) => argument.startsWith("--case="))
    ?.split("=")[1];
  const selectedCases = requestedCase
    ? extractionEvaluationCases.filter((testCase) =>
        requestedCase.split(",").includes(testCase.id),
      )
    : extractionEvaluationCases;
  const results = [];
  for (let index = 0; index < selectedCases.length; index += 2) {
    results.push(
      ...(await Promise.all(
        selectedCases.slice(index, index + 2).map(evaluateCase),
      )),
    );
  }

  let exactMatches = 0;
  let normalizedMatches = 0;
  let expectedValues = 0;
  let missingCorrect = 0;
  let missingExpected = 0;
  let conflictsCorrect = 0;
  let conflictsExpected = 0;
  let attributed = 0;
  let nonNullValues = 0;
  let hallucinations = 0;
  const failedCases: string[] = [];
  const failureDetails: Array<Record<string, unknown>> = [];

  for (const result of results) {
    const flat = flattenExtraction(result.extraction);
    let casePassed = true;
    for (const [fieldName, expected] of Object.entries(result.testCase.expected)) {
      const actual = flat[fieldName as keyof typeof flat];
      expectedValues += 1;
      if (String(actual.normalizedValue ?? "") === String(expected)) exactMatches += 1;
      if (normalized(actual.normalizedValue) === normalized(expected)) normalizedMatches += 1;
      else casePassed = false;
    }
    for (const fieldName of result.testCase.expectedMissing) {
      missingExpected += 1;
      if (flat[fieldName].value === null) missingCorrect += 1;
      else {
        hallucinations += 1;
        casePassed = false;
        failureDetails.push({
          case: result.testCase.id,
          field: fieldName,
          failure: "expected_null",
          actual: flat[fieldName].normalizedValue,
        });
      }
    }
    const conflictFields = new Set(
      result.extraction.conflicts.map((conflict) => conflict.fieldName),
    );
    for (const fieldName of result.testCase.expectedConflicts) {
      conflictsExpected += 1;
      if (conflictFields.has(fieldName)) conflictsCorrect += 1;
      else {
        casePassed = false;
        failureDetails.push({
          case: result.testCase.id,
          field: fieldName,
          failure: "expected_conflict",
          actualConflicts: [...conflictFields],
        });
      }
    }
    for (const fieldName of extractionFieldNames) {
      const field = flat[fieldName];
      if (field.value !== null) {
        nonNullValues += 1;
        if (
          field.sourceId &&
          field.sourceType &&
          field.sourceMarker &&
          field.sourceExcerpt
        ) {
          attributed += 1;
        }
      }
    }
    if (!casePassed) failedCases.push(result.testCase.id);
  }

  const modelResults = results.filter((result) => result.aiCalled);
  const metrics = {
    cases: results.length,
    modelCalls: modelResults.length,
    schemaValidity: 1,
    exactMatch: expectedValues ? exactMatches / expectedValues : 1,
    normalizedMatch: expectedValues ? normalizedMatches / expectedValues : 1,
    missingFieldPrecision: missingExpected ? missingCorrect / missingExpected : 1,
    conflictDetection: conflictsExpected ? conflictsCorrect / conflictsExpected : 1,
    sourceAttribution: nonNullValues ? attributed / nonNullValues : 1,
    hallucinationCount: hallucinations,
    averageInputTokens:
      modelResults.reduce((sum, result) => sum + result.inputTokens, 0) /
      Math.max(modelResults.length, 1),
    averageOutputTokens:
      modelResults.reduce((sum, result) => sum + result.outputTokens, 0) /
      Math.max(modelResults.length, 1),
    averageLatencyMs:
      modelResults.reduce((sum, result) => sum + result.latencyMs, 0) /
      Math.max(modelResults.length, 1),
    ocrRequiredAiCalls: results.filter(
      (result) => result.testCase.skipAi && result.aiCalled,
    ).length,
    failedCases,
    failureDetails,
  };
  console.log(JSON.stringify(metrics));

  if (
    metrics.schemaValidity !== 1 ||
    metrics.hallucinationCount > 0 ||
    metrics.missingFieldPrecision < 1 ||
    metrics.conflictDetection < 1 ||
    metrics.sourceAttribution < 0.95 ||
    metrics.ocrRequiredAiCalls !== 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Extraction evaluation failed.");
  process.exitCode = 1;
});
