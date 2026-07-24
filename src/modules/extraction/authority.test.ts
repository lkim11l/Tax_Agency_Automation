import { describe, expect, it } from "vitest";

import {
  applyDerivedFieldRules,
  classifySignerAuthority,
} from "./authority";
import { syntheticExtraction, syntheticValue } from "./test-fixtures";

describe("signer authority classification", () => {
  it("classifies charter, power of attorney, order and unknown text", () => {
    expect(classifySignerAuthority("Устав")).toBe("charter");
    expect(classifySignerAuthority("действует на основании Устава")).toBe("charter");
    expect(classifySignerAuthority("по доверенности №5 от 01.02.2026")).toBe(
      "power_of_attorney",
    );
    expect(classifySignerAuthority("приказ №3 от 01.02.2026")).toBe("order");
    expect(classifySignerAuthority("что-то ещё")).toBe("other");
    expect(classifySignerAuthority(null)).toBe("other");
  });
});

describe("derived field rules", () => {
  it("marks authority number/date not applicable and fills authority_document for a charter basis", () => {
    const extraction = syntheticExtraction({
      signer: {
        signer_authority: syntheticValue({
          value: "Устав",
          sourceExcerpt: "Основание полномочий: Устав",
        }),
      },
    });
    const derived = applyDerivedFieldRules(extraction);
    expect(derived.signer.authority_document.normalizedValue).toBe("Устав");
    expect(derived.signer.authority_document.sourceId).toBe(
      extraction.signer.signer_authority.sourceId,
    );
    expect(derived.signer.authority_number).toEqual(
      expect.objectContaining({ fieldState: "not_applicable", value: null }),
    );
    expect(derived.signer.authority_date).toEqual(
      expect.objectContaining({ fieldState: "not_applicable", value: null }),
    );
    expect(derived.contract.contract_date).toEqual(
      expect.objectContaining({ fieldState: "system_managed", value: null }),
    );
  });

  it("does not invent authority number or date for a power of attorney basis", () => {
    const extraction = syntheticExtraction({
      signer: {
        signer_authority: syntheticValue({
          value: "по доверенности №5 от 01.02.2026",
          sourceExcerpt: "Основание полномочий: по доверенности №5 от 01.02.2026",
        }),
      },
    });
    const derived = applyDerivedFieldRules(extraction);
    expect(derived.signer.authority_document.normalizedValue).toBe(
      "по доверенности №5 от 01.02.2026",
    );
    expect(derived.signer.authority_number.fieldState ?? null).toBeNull();
    expect(derived.signer.authority_number.value).toBeNull();
    expect(derived.signer.authority_date.fieldState ?? null).toBeNull();
  });

  it("does not overwrite an already-provided authority document", () => {
    const extraction = syntheticExtraction({
      signer: {
        signer_authority: syntheticValue({
          value: "Устав",
          sourceExcerpt: "Основание полномочий: Устав",
        }),
        authority_document: syntheticValue({
          value: "Устав от 01.01.2020",
          sourceExcerpt: "Документ о полномочиях: Устав от 01.01.2020",
        }),
      },
    });
    const derived = applyDerivedFieldRules(extraction);
    expect(derived.signer.authority_document.normalizedValue).toBe(
      "Устав от 01.01.2020",
    );
  });

  it("leaves an explicitly extracted contract date untouched", () => {
    const extraction = syntheticExtraction({
      contract: {
        contract_date: syntheticValue({
          value: "2026-07-01",
          sourceExcerpt: "Дата договора: 2026-07-01",
        }),
      },
    });
    const derived = applyDerivedFieldRules(extraction);
    expect(derived.contract.contract_date.fieldState ?? null).toBeNull();
    expect(derived.contract.contract_date.normalizedValue).toBe("2026-07-01");
  });
});
