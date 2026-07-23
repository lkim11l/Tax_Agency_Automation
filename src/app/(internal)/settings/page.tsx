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
          Mail.ru IMAP/SMTP credentials are server-only and are never displayed in
          this interface. Use Email operations to verify synchronization state and
          run an administrator-controlled polling iteration.
        </p>
        <p>
          Public registration remains disabled. Specialists can read linked
          correspondence and private attachments through their authenticated
          session; only administrators can synchronize or reprocess mail.
        </p>
      </section>
    </>
  );
}
