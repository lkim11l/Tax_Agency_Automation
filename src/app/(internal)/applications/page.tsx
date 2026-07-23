import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Applications",
};

export default function ApplicationsPage() {
  return (
    <>
      <h2>Applications</h2>
      <section className="panel">
        <p>
          The application registry will be implemented in Phase 1. No application
          data is created during repository foundation.
        </p>
      </section>
    </>
  );
}
