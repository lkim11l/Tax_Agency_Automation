import { describe, expect, it } from "vitest";

import {
  assertOperationalAccess,
  AuthenticationRequiredError,
  InactiveProfileError,
  type OperationalProfile,
} from "./access";

const activeProfile: OperationalProfile = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "specialist@example.invalid",
  full_name: "Demo Specialist",
  role: "specialist",
  is_active: true,
};

describe("assertOperationalAccess", () => {
  it("rejects a missing authenticated profile", () => {
    expect(() => assertOperationalAccess(null)).toThrow(AuthenticationRequiredError);
  });

  it("rejects an inactive user", () => {
    expect(() =>
      assertOperationalAccess({ ...activeProfile, is_active: false }),
    ).toThrow(InactiveProfileError);
  });

  it("allows an active specialist", () => {
    expect(() => assertOperationalAccess(activeProfile)).not.toThrow();
  });
});
