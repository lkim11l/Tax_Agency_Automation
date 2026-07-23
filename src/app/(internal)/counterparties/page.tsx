import type { Metadata } from "next";
import Link from "next/link";

import { CounterpartyForm } from "@/components/counterparty-form";
import { Feedback } from "@/components/feedback";
import { createCounterpartyAction } from "@/modules/counterparties/actions";
import { listCounterparties } from "@/modules/counterparties/repository";

export const metadata: Metadata = {
  title: "Counterparties",
};

export default async function CounterpartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  const params = await searchParams;
  const counterparties = await listCounterparties(params.q);

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Counterparties</h2>
          <p className="muted">Minimal directory for application assignment.</p>
        </div>
      </div>
      <Feedback error={params.error} />

      <section className="panel section-gap">
        <h3>Search</h3>
        <form className="inline-form">
          <input
            name="q"
            placeholder="Legal name or INN"
            defaultValue={params.q}
          />
          <button type="submit">Search</button>
          <Link href="/counterparties">Clear</Link>
        </form>
      </section>

      <section className="panel section-gap">
        <h3>Create counterparty</h3>
        <CounterpartyForm action={createCounterpartyAction} />
      </section>

      <section className="section-gap">
        {counterparties.length === 0 ? (
          <div className="panel empty-state">No counterparties found.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Legal name</th>
                  <th>Short name</th>
                  <th>INN</th>
                  <th>Contact</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {counterparties.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/counterparties/${item.id}`}>
                        {item.legal_name}
                      </Link>
                    </td>
                    <td>{item.short_name ?? "—"}</td>
                    <td>{item.inn ?? "—"}</td>
                    <td>{item.contact_name ?? item.contact_email ?? "—"}</td>
                    <td>{new Date(item.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
