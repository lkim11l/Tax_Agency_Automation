import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExtractionReviewPanel } from "./extraction-review-panel";

describe("ExtractionReviewPanel", () => {
  it("renders a compact Russian review view with safe bulk and one-click actions", () => {
    const html = renderToStaticMarkup(
      <ExtractionReviewPanel
        applicationId="11111111-1111-4111-8111-111111111111"
        conflicts={[]}
        filter="review"
        completeness={{
          percentage: 100,
          is_ready: true,
          missing_count: 0,
          conflict_count: 0,
        }}
        acceptancePreview={{
          eligible: [{ fieldName: "inn" }],
          blocked: [],
        }}
        fields={[{
          id: "22222222-2222-4222-8222-222222222222",
          field_name: "inn",
          structured_value: {
            normalizedValue: "7707083893",
            reason: "DIRECT_SOURCE",
          },
          source_type: "email_message",
          source_marker: "[EMAIL BODY]",
          source_excerpt: "ИНН: 7707083893",
          confidence: 0.99,
          requires_review: false,
          manually_corrected: false,
          conflict_detected: false,
          accepted: true,
        }]}
      />,
    );

    expect(html).toContain("Обработать заявку");
    expect(html).toContain("Подтвердить все корректные данные");
    expect(html).toContain("Данные готовы");
    expect(html).toContain("Требуют проверки");
    expect(html).not.toContain("low_confidence");
    expect(html).not.toContain("CONFIDENCE_BELOW_THRESHOLD");
    expect(html).not.toContain("<form class=\"stack\"><input");
  });

  it("does not treat not-applicable or optional empty fields as missing", () => {
    const html = renderToStaticMarkup(
      <ExtractionReviewPanel
        applicationId="11111111-1111-4111-8111-111111111111"
        conflicts={[]}
        filter="all"
        completeness={null}
        acceptancePreview={{ eligible: [], blocked: [] }}
        requiredFieldNames={["legal_name"]}
        fields={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            field_name: "authority_number",
            structured_value: { normalizedValue: null, fieldState: "not_applicable" },
            source_type: null,
            source_marker: null,
            source_excerpt: null,
            confidence: 1,
            requires_review: false,
            manually_corrected: false,
            conflict_detected: false,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            field_name: "additional_conditions",
            structured_value: { normalizedValue: null },
            source_type: null,
            source_marker: null,
            source_excerpt: null,
            confidence: 0,
            requires_review: true,
            manually_corrected: false,
            conflict_detected: false,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            field_name: "legal_name",
            structured_value: { normalizedValue: null },
            source_type: null,
            source_marker: null,
            source_excerpt: null,
            confidence: 0,
            requires_review: true,
            manually_corrected: false,
            conflict_detected: false,
          },
        ]}
      />,
    );

    expect(html).toContain("Не требуется");
    expect(html).toContain("Необязательное поле");
    expect(html).toContain("<dd>1</dd>");
  });
});
