export type OperationalProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "specialist";
  is_active: boolean;
};

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class InactiveProfileError extends Error {
  constructor() {
    super("This user profile is inactive.");
    this.name = "InactiveProfileError";
  }
}

export function assertOperationalAccess(
  profile: OperationalProfile | null,
): asserts profile is OperationalProfile {
  if (!profile) {
    throw new AuthenticationRequiredError();
  }

  if (!profile.is_active) {
    throw new InactiveProfileError();
  }
}
