"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getOperationalContext } from "@/lib/auth/context";
import { safeFailure } from "@/modules/operations/domain";
import { runMailboxPipeline } from "@/modules/operations/service";

export async function runPilotPipelineAction() {
  let destination: string;
  try {
    const { profile } = await getOperationalContext();
    if (profile.role !== "admin") throw new Error("Administrator access is required.");
    const result = await runMailboxPipeline("manual");
    revalidatePath("/settings");
    destination = `/settings?success=${result.claimed ? "pipeline-completed" : "pipeline-skipped"}`;
  } catch (error) {
    const failure = safeFailure(error);
    destination = `/settings?error=${failure.code}`;
  }
  redirect(destination);
}
