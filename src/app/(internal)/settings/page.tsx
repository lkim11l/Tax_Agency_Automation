import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <>
      <h2>Settings</h2>
      <section className="panel">
        <p>
          Supabase connection values are configured through environment variables.
          Database migrations, profiles, RLS, and application registry storage are
          available in Phase 1. Provider settings will be added in later phases.
        </p>
      </section>
    </>
  );
}
