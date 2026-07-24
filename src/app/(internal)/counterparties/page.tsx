import type { Metadata } from "next";
import Link from "next/link";

import { CounterpartyForm } from "@/components/counterparty-form";
import { Feedback } from "@/components/feedback";
import { createCounterpartyAction } from "@/modules/counterparties/actions";
import { listCounterparties } from "@/modules/counterparties/repository";

export const metadata: Metadata = {
  title: "Контрагенты",
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
          <h2>Контрагенты</h2>
          <p className="muted">Справочник контрагентов для привязки к заявкам.</p>
        </div>
      </div>
      <Feedback error={params.error} />

      <section className="panel section-gap">
        <h3>Поиск</h3>
        <form className="inline-form">
          <input
            name="q"
            placeholder="Юридическое наименование или ИНН"
            defaultValue={params.q}
          />
          <button type="submit">Найти</button>
          <Link href="/counterparties">Очистить</Link>
        </form>
      </section>

      <section className="panel section-gap">
        <h3>Создать контрагента</h3>
        <CounterpartyForm action={createCounterpartyAction} />
      </section>

      <section className="section-gap">
        {counterparties.length === 0 ? (
          <div className="panel empty-state">Контрагенты не найдены.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Юридическое наименование</th>
                  <th>Краткое наименование</th>
                  <th>ИНН</th>
                  <th>Контакт</th>
                  <th>Обновлено</th>
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
                    <td>{new Date(item.updated_at).toLocaleString("ru-RU")}</td>
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
