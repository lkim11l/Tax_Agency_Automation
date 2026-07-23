import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import { getOperationalContext } from "@/lib/auth/context";
import { completenessRuleSets } from "@/modules/clarification/rules";
import { contractPlaceholders } from "@/modules/contracts/constants";
import { uploadTemplateAction } from "@/modules/templates/actions";
import { listTemplates } from "@/modules/templates/repository";

export const metadata: Metadata = { title: "Contract templates" };

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const feedback = await searchParams;
  const [templates, { profile }] = await Promise.all([
    listTemplates(),
    getOperationalContext(),
  ]);
  return (
    <>
      <div className="page-heading">
        <div><h2>Contract templates</h2><p className="muted">Versioned DOCX templates. Upload does not imply legal approval.</p></div>
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      {profile.role === "admin" ? <section className="panel section-gap">
        <h3>Upload new template version</h3>
        <form action={uploadTemplateAction} className="form-grid">
          <label className="field">Name<input name="name" required maxLength={200} /></label>
          <label className="field">Code<input name="code" required pattern="[a-z0-9][a-z0-9_-]{1,99}" /></label>
          <label className="field">Version<input name="version" required defaultValue="1.0.0" /></label>
          <label className="field">Type<select name="template_type"><option value="services">services</option><option value="consulting">consulting</option><option value="supply">supply</option></select></label>
          <label className="field">Rule set<select name="required_rule_set">{completenessRuleSets.map((rule) => <option key={rule.id} value={rule.id}>{rule.label} v{rule.version}</option>)}</select></label>
          <label className="field field-wide">Description<textarea name="description" rows={2} /></label>
          <label className="field field-wide">Required placeholders<input name="required_placeholders" required defaultValue={contractPlaceholders.join(", ")} /></label>
          <label className="field field-wide">DOCX file<input name="file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
          <div className="field-wide"><button type="submit">Upload and validate</button></div>
        </form>
      </section> : <p className="muted">Template upload and lifecycle actions require an administrator.</p>}
      <div className="table-wrap section-gap">
        <table><thead><tr><th>Name</th><th>Type</th><th>Version</th><th>Status</th><th>Checksum</th><th>Validation</th><th>Updated</th></tr></thead>
          <tbody>{templates.map((template) => <tr key={template.id}>
            <td><Link href={`/templates/${template.id}`}>{template.name}</Link></td>
            <td>{template.template_type ?? "—"}</td><td>{template.version}</td>
            <td>{template.status}{template.is_active ? " · active" : ""}</td>
            <td>{template.checksum?.slice(0, 12) ?? "—"}</td>
            <td>{template.validation_report?.valid ? "passed" : "blocked"}</td>
            <td>{new Date(template.updated_at).toLocaleString()}</td>
          </tr>)}</tbody></table>
      </div>
    </>
  );
}
