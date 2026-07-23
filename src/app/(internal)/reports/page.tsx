import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsPage() {
  return (
    <>
      <h2>Reports</h2>
      <section className="panel">
        <p>
          Registry reporting and XLSX export are planned for Phase 8. There is no
          report data during repository foundation.
        </p>
      </section>
    </>
  );
}
