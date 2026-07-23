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
          Supabase connection values are configured through server environment
          variables. Provider and template settings will be added in later phases.
        </p>
      </section>
    </>
  );
}
