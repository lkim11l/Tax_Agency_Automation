import type { Metadata } from "next";
import Link from "next/link";

import { ApplicationForm } from "@/components/application-form";
import { Feedback } from "@/components/feedback";
import { createApplicationAction } from "@/modules/applications/actions";
import { listAssignableProfiles } from "@/modules/applications/repository";
import { listCounterpartyOptions } from "@/modules/counterparties/repository";
import { listTemplateOptions } from "@/modules/templates/repository";
import { getLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Create application",
};

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const [counterparties, profiles, templates, locale] = await Promise.all([
    listCounterpartyOptions(),
    listAssignableProfiles(),
    listTemplateOptions(),
    getLocale(),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>{locale === "ru" ? "Создать заявку" : "Create application"}</h2>
          <p className="muted">{locale === "ru" ? "Источник будет отмечен как ручной." : "The source will be recorded as manual."}</p>
        </div>
        <Link href="/applications">{locale === "ru" ? "К списку заявок" : "Back to applications"}</Link>
      </div>
      <Feedback error={params.error} />
      <section className="panel">
        <ApplicationForm
          locale={locale}
          action={createApplicationAction}
          counterparties={counterparties.map((item) => ({
            id: item.id,
            label: `${item.legal_name}${item.inn ? ` — ${item.inn}` : ""}`,
          }))}
          profiles={profiles.map((item) => ({
            id: item.id,
            label: item.full_name ?? item.email,
          }))}
          templates={templates.map((item) => ({
            id: item.id,
            label: `${item.name} v${item.version}`,
          }))}
        />
      </section>
    </>
  );
}
