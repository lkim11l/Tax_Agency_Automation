import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import { TemplateForm } from "@/components/template-form";
import { createTemplateAction } from "@/modules/templates/actions";
import { listTemplates } from "@/modules/templates/repository";

export const metadata: Metadata = {
  title: "Templates",
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const templates = await listTemplates();

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Template metadata</h2>
          <p className="muted">Metadata only; no DOCX generation in Phase 1.</p>
        </div>
      </div>
      <Feedback error={params.error} />

      <section className="panel section-gap">
        <h3>Create template metadata</h3>
        <TemplateForm action={createTemplateAction} />
      </section>

      {templates.length === 0 ? (
        <section className="panel empty-state section-gap">
          No template metadata exists.
        </section>
      ) : (
        <div className="table-wrap section-gap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Status</th>
                <th>Required fields</th>
                <th>File</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>
                    <Link href={`/templates/${template.id}`}>{template.name}</Link>
                  </td>
                  <td>{template.version}</td>
                  <td>{template.status}</td>
                  <td>{template.required_fields.join(", ") || "—"}</td>
                  <td>{template.storage_path ? "Connected" : "Not connected"}</td>
                  <td>{new Date(template.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
