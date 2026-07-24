import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PendingFormButton } from "./pending-form-button";

describe("PendingFormButton", () => {
  it("renders the idle label, enabled and not busy, outside a submitting form", () => {
    const html = renderToStaticMarkup(
      <PendingFormButton idleLabel="Обработать заявку" pendingLabel="Обрабатываем заявку…" />,
    );
    expect(html).toContain("Обработать заявку");
    expect(html).not.toContain("Обрабатываем заявку");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-busy="false"');
  });

  it("respects an externally-disabled state", () => {
    const html = renderToStaticMarkup(
      <PendingFormButton idleLabel="Подтвердить все корректные данные" pendingLabel="Подтверждаем данные…" disabled />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
  });

  it("does not render a hint while idle", () => {
    const html = renderToStaticMarkup(
      <PendingFormButton
        idleLabel="Проверить почту"
        pendingLabel="Синхронизируем почту…"
        pendingHint="Не закрывайте страницу, пока идёт синхронизация."
      />,
    );
    expect(html).not.toContain("Не закрывайте страницу");
  });
});
