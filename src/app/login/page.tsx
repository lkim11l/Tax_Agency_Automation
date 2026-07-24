import type { Metadata } from "next";

import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { getLocale, messages } from "@/lib/i18n";
import { setLocaleAction } from "@/lib/i18n-actions";

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
  const locale = await getLocale();
  const text = messages(locale);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Tax Agency Automation</h1>
        <p className="muted">{text.login.hint}</p>
        <form action={setLocaleAction} className="locale-switcher locale-switcher-auth">
          <input type="hidden" name="return_to" value="/login" />
          <button name="locale" value="ru" type="submit" disabled={locale === "ru"}>RU</button>
          <button name="locale" value="en" type="submit" disabled={locale === "en"}>EN</button>
        </form>

        {!isConfigured || params.reason === "configuration" ? (
          <p className="error-message" role="alert">
            {text.login.config}
          </p>
        ) : null}

        {params.error ? (
          <p className="error-message" role="alert">
            {params.error === "inactive"
              ? text.login.inactive
              : text.login.failed}
          </p>
        ) : null}

        <form action={signIn} className="auth-form">
          <input type="hidden" name="next" value={params.next ?? "/applications"} />
          <label>
            {text.login.email}
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              disabled={!isConfigured}
            />
          </label>
          <label>
            {text.login.password}
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              disabled={!isConfigured}
            />
          </label>
          <button type="submit" disabled={!isConfigured}>
            {text.login.submit}
          </button>
        </form>

        <p className="muted">
          {text.login.noSignup}
        </p>
      </section>
    </main>
  );
}
