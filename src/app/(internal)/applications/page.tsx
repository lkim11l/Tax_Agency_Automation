import type { Metadata } from "next";
import Link from "next/link";

import { Feedback } from "@/components/feedback";
import {
  applicationStatuses,
  type ApplicationStatus,
} from "@/modules/applications/domain";
import {
  listApplications,
  listAssignableProfiles,
} from "@/modules/applications/repository";

export const metadata: Metadata = {
  title: "Applications",
};

type ApplicationsPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function isStatus(value: string | undefined): value is ApplicationStatus {
  return applicationStatuses.includes(value as ApplicationStatus);
}

export default async function ApplicationsPage({
  searchParams,
}: ApplicationsPageProps) {
  const params = await searchParams;
  const filters = {
    number: params.number,
    title: params.title,
    counterparty: params.counterparty,
    status: isStatus(params.status) ? params.status : undefined,
    assignedTo: params.assigned_to,
    dateFrom: params.date_from,
    dateTo: params.date_to,
  };

  const [state, profiles] = await Promise.all([
    listApplications(filters),
    listAssignableProfiles(),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Applications</h2>
          <p className="muted">Manual internal application registry.</p>
        </div>
        <Link className="button-link" href="/applications/new">
          Create application
        </Link>
      </div>

      <Feedback error={params.error} />

      <section className="panel">
        <h3>Filters</h3>
        <form className="filter-grid">
          <label className="field">
            Number
            <input name="number" defaultValue={params.number} />
          </label>
          <label className="field">
            Title
            <input name="title" defaultValue={params.title} />
          </label>
          <label className="field">
            Counterparty name or INN
            <input name="counterparty" defaultValue={params.counterparty} />
          </label>
          <label className="field">
            Status
            <select name="status" defaultValue={filters.status ?? ""}>
              <option value="">All statuses</option>
              {applicationStatuses.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Responsible specialist
            <select name="assigned_to" defaultValue={params.assigned_to ?? ""}>
              <option value="">All specialists</option>
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.full_name ?? profile.email}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Received from
            <input type="date" name="date_from" defaultValue={params.date_from} />
          </label>
          <label className="field">
            Received to
            <input type="date" name="date_to" defaultValue={params.date_to} />
          </label>
          <div className="filter-actions">
            <button type="submit">Apply filters</button>
            <Link href="/applications">Clear</Link>
          </div>
        </form>
      </section>

      {state.kind === "error" ? (
        <p className="alert alert-error" role="alert">
          Database error: {state.message}
        </p>
      ) : state.kind === "empty" ? (
        <section className="panel empty-state">
          <p>No applications match the current filters.</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Title / subject</th>
                <th>Counterparty</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Amount</th>
                <th>Received</th>
                <th>Responsible</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((application) => (
                <tr key={application.id}>
                  <td>
                    <Link href={`/applications/${application.id}`}>
                      {application.application_number}
                    </Link>
                  </td>
                  <td>{application.title || application.contract_subject || "—"}</td>
                  <td>{application.counterparty?.legal_name ?? "—"}</td>
                  <td>{application.status}</td>
                  <td>{application.priority}</td>
                  <td>
                    {application.contract_amount === null
                      ? "—"
                      : `${application.contract_amount} ${application.currency ?? ""}`}
                  </td>
                  <td>{new Date(application.received_at).toLocaleDateString()}</td>
                  <td>
                    {application.assignee?.full_name ??
                      application.assignee?.email ??
                      "—"}
                  </td>
                  <td>{new Date(application.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
