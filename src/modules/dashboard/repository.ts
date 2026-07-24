import { getOperationalContext } from "@/lib/auth/context";

export type DashboardSummary = {
  new_applications: number;
  waiting_for_client: number;
  review_required: number;
  contracts_under_review: number;
  contracts_sent: number;
  last_mailbox_sync: string | null;
  system_status: string;
};

export async function getDashboardSummary() {
  const { supabase } = await getOperationalContext();
  const result = await supabase.rpc("presentation_dashboard_summary");
  if (result.error || !result.data || result.data.access_denied) {
    throw new Error("Unable to load dashboard summary.");
  }
  return result.data as DashboardSummary;
}
