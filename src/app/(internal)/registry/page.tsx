import type { Metadata } from "next";
import Link from "next/link";

import { listAssignableProfiles } from "@/modules/applications/repository";
import { parseRegistryFilters } from "@/modules/reports/domain";
import { listRegistry } from "@/modules/reports/repository";

export const metadata: Metadata = { title: "Contract registry" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function query(filters: ReturnType<typeof parseRegistryFilters>, page: number) {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) {
    if (value !== undefined) values.set(key, String(value));
  }
  return `?${values.toString()}`;
}

export default async function RegistryPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = parseRegistryFilters(params);
  const [result, profiles] = await Promise.all([listRegistry(filters), listAssignableProfiles()]);
  return (
    <>
      <div className="page-heading">
        <div><h2>Contract registry</h2><p className="muted">Server-filtered operational registry.</p></div>
        <Link href="/reports">Monthly reports</Link>
      </div>
      <section className="panel registry-panel">
        <h3>Filters</h3>
        <form className="filter-grid">
          <label className="field">From<input type="date" name="dateFrom" defaultValue={filters.dateFrom} /></label>
          <label className="field">To<input type="date" name="dateTo" defaultValue={filters.dateTo} /></label>
          <label className="field">Application number<input name="applicationNumber" defaultValue={filters.applicationNumber} /></label>
          <label className="field">Contract number<input name="contractNumber" defaultValue={filters.contractNumber} /></label>
          <label className="field">Counterparty<input name="counterparty" defaultValue={filters.counterparty} /></label>
          <label className="field">INN<input name="inn" defaultValue={filters.inn} /></label>
          <label className="field">Application status<input name="applicationStatus" defaultValue={filters.applicationStatus} /></label>
          <label className="field">Contract status<input name="contractStatus" defaultValue={filters.contractStatus} /></label>
          <label className="field">Specialist<select name="assignedTo" defaultValue={filters.assignedTo ?? ""}><option value="">All</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.full_name ?? profile.email}</option>)}</select></label>
          <label className="field">Template type<select name="templateType" defaultValue={filters.templateType ?? ""}><option value="">All</option><option value="services">Services</option><option value="consulting">Consulting</option><option value="supply">Supply</option></select></label>
          <label className="field">Currency<input name="currency" maxLength={3} defaultValue={filters.currency} /></label>
          <label className="field">Conflicts<select name="conflicts" defaultValue={filters.conflicts}><option value="any">Any</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label className="field">Delivery<select name="sent" defaultValue={filters.sent}><option value="any">Any</option><option value="sent">Sent</option><option value="unsent">Not sent</option></select></label>
          <label className="field">Sort<select name="sort" defaultValue={filters.sort}><option value="received_at">Received</option><option value="contract_amount">Amount</option><option value="contract_number">Contract number</option><option value="counterparty_name">Counterparty</option><option value="application_status">Status</option></select></label>
          <label className="field">Direction<select name="direction" defaultValue={filters.direction}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
          <input type="hidden" name="pageSize" value={filters.pageSize} />
          <div className="filter-actions"><button type="submit">Apply</button><Link href="/registry">Reset</Link></div>
        </form>
      </section>
      <dl className="summary-grid section-gap">
        <div><dt>Applications</dt><dd>{result.totals.applicationCount}</dd></div>
        <div><dt>Contracts</dt><dd>{result.totals.contractCount}</dd></div>
        <div><dt>Approved</dt><dd>{result.totals.approvedContractCount}</dd></div>
        <div><dt>Without contract</dt><dd>{result.totals.unpreparedApplicationCount}</dd></div>
        <div><dt>Conflicts</dt><dd>{result.totals.conflictApplicationCount}</dd></div>
        <div><dt>Average delivery</dt><dd className="summary-text">{result.totals.averageDeliveryHours === null ? "—" : `${result.totals.averageDeliveryHours.toFixed(1)} h`}</dd></div>
        {Object.entries(result.totals.amountsByCurrency).map(([currency, amount]) => <div key={currency}><dt>Total {currency}</dt><dd className="summary-text">{amount.toLocaleString()}</dd></div>)}
      </dl>
      <div className="table-wrap section-gap">
        <table>
          <thead><tr><th>Application</th><th>Contract</th><th>Counterparty / INN</th><th>Subject</th><th>Amount</th><th>Status</th><th>Specialist</th><th>Template</th><th>Completeness</th><th>Links</th></tr></thead>
          <tbody>{result.rows.map((row) => (
            <tr key={`${row.application_id}:${row.contract_id ?? "none"}`}>
              <td><Link href={`/applications/${row.application_id}`}>{row.application_number}</Link><br />{new Date(row.received_at).toLocaleDateString()}</td>
              <td>{row.contract_number ?? "—"}<br />{row.contract_date ?? ""}</td>
              <td>{row.counterparty_id ? <Link href={`/counterparties/${row.counterparty_id}`}>{row.counterparty_name ?? "Counterparty"}</Link> : "—"}<br />{row.inn ?? ""}</td>
              <td>{row.contract_subject ?? "—"}</td>
              <td>{row.contract_amount === null ? "—" : `${row.contract_amount} ${row.currency ?? ""}`}</td>
              <td>{row.application_status}<br />{row.contract_status ?? "No contract"}{row.has_conflicts ? <><br /><strong>Conflicts</strong></> : null}</td>
              <td>{row.specialist_name ?? row.specialist_email ?? "Unassigned"}</td>
              <td>{row.template_name ?? "—"} {row.template_version ?? ""}</td>
              <td>{row.completeness_percentage}%</td>
              <td><Link href={`/applications/${row.application_id}#contract`}>Contract</Link>{" · "}<Link href={`/applications/${row.application_id}#correspondence`}>Correspondence ({row.correspondence_count})</Link>{row.current_version_id ? <><br /><Link href={`/api/contracts/versions/${row.current_version_id}`}>Download version</Link></> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <nav className="pagination" aria-label="Registry pages">
        {filters.page > 1 ? <Link href={query(filters, filters.page - 1)}>Previous</Link> : <span />}
        <span>Page {result.page} of {result.pageCount} ({result.count} rows)</span>
        {filters.page < result.pageCount ? <Link href={query(filters, filters.page + 1)}>Next</Link> : <span />}
      </nav>
    </>
  );
}
