import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CounterpartyForm } from "@/components/counterparty-form";
import { Feedback } from "@/components/feedback";
import { updateCounterpartyAction } from "@/modules/counterparties/actions";
import { getCounterparty } from "@/modules/counterparties/repository";

export const metadata: Metadata = {
  title: "Counterparty detail",
};

export default async function CounterpartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  const counterparty = await getCounterparty(id);

  if (!counterparty) {
    notFound();
  }

  return (
    <>
      <div className="page-heading">
        <h2>{counterparty.legal_name}</h2>
        <Link href="/counterparties">Назад к контрагентам</Link>
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      <section className="panel">
        <CounterpartyForm
          action={updateCounterpartyAction}
          counterparty={counterparty}
        />
      </section>
    </>
  );
}
