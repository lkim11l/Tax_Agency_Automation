import type { Metadata } from "next";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

import { signIn } from "./actions";

export const metadata: Metadata = {
  title: "Sign in",
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
    reason?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const isConfigured = getSupabasePublicConfig() !== null;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Tax Agency Automation</h1>
        <p className="muted">Sign in with an account provisioned by an administrator.</p>

        {!isConfigured || params.reason === "configuration" ? (
          <p className="error-message" role="alert">
            Supabase is not configured. Add the required values to .env.local
            before signing in.
          </p>
        ) : null}

        {params.error ? (
          <p className="error-message" role="alert">
            {params.error === "inactive"
              ? "This account is inactive. Contact an administrator."
              : "Sign-in failed. Check your email and password."}
          </p>
        ) : null}

        <form action={signIn} className="auth-form">
          <input type="hidden" name="next" value={params.next ?? "/applications"} />
          <label>
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              disabled={!isConfigured}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              disabled={!isConfigured}
            />
          </label>
          <button type="submit" disabled={!isConfigured}>
            Sign in
          </button>
        </form>

        <p className="muted">
          Self-service registration is disabled. Contact an administrator for
          access.
        </p>
      </section>
    </main>
  );
}
