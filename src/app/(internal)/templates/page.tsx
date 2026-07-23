import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Templates",
};

export default function TemplatesPage() {
  return (
    <>
      <h2>Templates</h2>
      <section className="panel">
        <p>
          Approved DOCX template management is planned for Phase 6. No upload
          controls are exposed yet.
        </p>
      </section>
    </>
  );
}
