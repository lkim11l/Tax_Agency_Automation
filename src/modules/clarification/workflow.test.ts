import { describe, expect, it } from "vitest";

import {
  assertRequiredQuestions,
  assertSafeEmailHeaders,
  classifySmtpFailure,
  draftTransition,
  editDraftState,
} from "./workflow";

describe("clarification workflow", () => {
  it("revokes approval and increments version after text or recipient edits", () => {
    expect(editDraftState({ status: "approved", version: 2, changed: true })).toEqual({
      status: "draft",
      version: 3,
      approvedBy: null,
      approvedAt: null,
    });
  });

  it("keeps required questions immutable", () => {
    expect(() =>
      assertRequiredQuestions("Укажите ИНН.", ["Укажите ИНН."]),
    ).not.toThrow();
    expect(() =>
      assertRequiredQuestions("Вопрос удалён.", ["Укажите ИНН."]),
    ).toThrow(/cannot be removed/u);
  });

  it("enforces approval transitions", () => {
    expect(draftTransition("draft", "submit")).toBe("awaiting_approval");
    expect(draftTransition("awaiting_approval", "approve")).toBe("approved");
    expect(() => draftTransition("draft", "approve")).toThrow();
    expect(() => draftTransition("sent", "cancel")).toThrow();
  });

  it("blocks invalid recipients and header injection", () => {
    expect(() => assertSafeEmailHeaders("client@example.com", "Уточнение")).not.toThrow();
    expect(() => assertSafeEmailHeaders("invalid", "Уточнение")).toThrow();
    expect(() =>
      assertSafeEmailHeaders("client@example.com", "Subject\r\nBcc: victim@example.com"),
    ).toThrow();
  });

  it("blocks retry after ambiguous SMTP timeout but permits known pre-delivery failure", () => {
    expect(classifySmtpFailure({ code: "ETIMEDOUT" })).toEqual(
      expect.objectContaining({ deliveryUnknown: true, retryAllowed: false }),
    );
    expect(classifySmtpFailure({ code: "EAUTH" })).toEqual(
      expect.objectContaining({ deliveryUnknown: false, retryAllowed: true }),
    );
  });
});
