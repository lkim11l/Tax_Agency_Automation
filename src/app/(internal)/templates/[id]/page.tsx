import Link from "next/link";
import { notFound } from "next/navigation";

import { Feedback } from "@/components/feedback";
import { getOperationalContext } from "@/lib/auth/context";
import { templateLifecycleAction } from "@/modules/templates/actions";
import { getTemplate } from "@/modules/templates/repository";

export default async function TemplateDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  const [template, { profile }] = await Promise.all([
    getTemplate(id),
    getOperationalContext(),
  ]);
  if (!template) notFound();
  const report = template.validation_report ?? {};
  return <>
    <div className="page-heading"><div><h2>{template.name}</h2><p className="muted">{template.code} · {template.template_type} · v{template.version}</p></div><Link href="/templates">Back</Link></div>
    <Feedback {...feedback} />
    <section className="panel">
      <dl className="summary-grid">
        <div><dt>Status</dt><dd>{template.status}{template.is_active ? " · active" : ""}</dd></div>
        <div><dt>Checksum</dt><dd>{template.checksum ?? "—"}</dd></div>
        <div><dt>File</dt><dd>{template.original_filename ?? "—"}</dd></div>
        <div><dt>Rule set</dt><dd>{template.required_rule_set ?? "—"}</dd></div>
        <div><dt>Uploaded by</dt><dd>{template.creator?.[0]?.full_name ?? template.creator?.[0]?.email ?? "—"}</dd></div>
        <div><dt>Approved by</dt><dd>{template.approver?.[0]?.full_name ?? template.approver?.[0]?.email ?? "—"}</dd></div>
      </dl>
      <h3>Validation report</h3>
      <p>{report.valid ? "Passed" : "Blocking errors present"}</p>
      {report.errors?.length ? <ul>{report.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      {report.warnings?.length ? <ul>{report.warnings.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      <h3>Placeholders</h3><p>{report.placeholders?.join(", ") || "None"}</p>
      {profile.role === "admin" ? <div className="inline-actions">
        {template.status === "awaiting_approval" && report.valid ? <form action={templateLifecycleAction}><input type="hidden" name="template_id" value={id}/><input type="hidden" name="lifecycle_action" value="approve"/><button>Approve template</button></form> : null}
        {template.status === "approved" ? <form action={templateLifecycleAction}><input type="hidden" name="template_id" value={id}/><input type="hidden" name="lifecycle_action" value="deactivate"/><button>Deactivate</button></form> : null}
        {!["archived", "approved"].includes(template.status) ? <form action={templateLifecycleAction}><input type="hidden" name="template_id" value={id}/><input type="hidden" name="lifecycle_action" value="archive"/><button>Archive</button></form> : null}
      </div> : null}
    </section>
  </>;
}
