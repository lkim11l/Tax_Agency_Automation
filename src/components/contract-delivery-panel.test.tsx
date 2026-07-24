import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContractDeliveryPanel } from "./contract-delivery-panel";

const baseProps = {
  applicationId: "application-1",
  versions: [],
  reviews: [],
  drafts: [],
  attempts: [],
  errorCode: null,
  locale: "en" as const,
};

describe("ContractDeliveryPanel", () => {
  it("renders an honest empty state for a newly ingested application", () => {
    const html = renderToStaticMarkup(createElement(ContractDeliveryPanel, baseProps));

    expect(html).toContain("No delivery draft has been created.");
    expect(html).not.toContain("Unable to load delivery state");
  });

  it("renders delivery draft version 1 and tolerates missing optional reviewer data", () => {
    const html = renderToStaticMarkup(createElement(ContractDeliveryPanel, {
      ...baseProps,
      versions: [{
        id: "version-1",
        version_number: 1,
        status: "approved",
        checksum: "a".repeat(64),
      }],
      reviews: [{
        id: "review-1",
        contract_version_id: "version-1",
        decision: "approved",
        comment: null,
        reviewed_checksum: "a".repeat(64),
        reviewed_at: "2026-07-23T00:00:00Z",
        reviewer: null,
      }],
      drafts: [{
        id: "draft-1",
        contract_version_id: "version-1",
        draft_version: 1,
        recipient: "operator@example.test",
        recipient_source: "manual",
        subject: "Contract",
        body_text: "Attached.",
        attachment_filename: "contract.docx",
        version_checksum: "a".repeat(64),
        status: "sent",
        created_at: "2026-07-23T00:00:00Z",
        sent_at: "2026-07-23T01:00:00Z",
      }],
    }));

    expect(html).toContain("Delivery draft v1");
    expect(html).toContain("active operator");
  });

  it("localizes a schema error to the delivery block", () => {
    const html = renderToStaticMarkup(createElement(ContractDeliveryPanel, {
      ...baseProps,
      errorCode: "DELIVERY_SCHEMA_MISMATCH",
      locale: "ru",
    }));

    expect(html).toContain("Раздел доставки временно недоступен");
    expect(html).toContain("Остальные данные заявки доступны");
    expect(html).not.toContain("No delivery draft");
  });
});
