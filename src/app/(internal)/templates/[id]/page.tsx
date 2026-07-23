import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Feedback } from "@/components/feedback";
import { TemplateForm } from "@/components/template-form";
import { updateTemplateAction } from "@/modules/templates/actions";
import { getTemplate } from "@/modules/templates/repository";

export const metadata: Metadata = {
  title: "Template metadata detail",
};

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  const template = await getTemplate(id);

  if (!template) {
    notFound();
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{template.name}</h2>
          <p className="muted">Version {template.version}</p>
        </div>
        <Link href="/templates">Back to templates</Link>
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      <section className="panel">
        <TemplateForm action={updateTemplateAction} template={template} />
      </section>
    </>
  );
}
