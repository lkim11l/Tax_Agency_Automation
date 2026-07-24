import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MANIFEST_PATH = join(tmpdir(), "tax-agency-production-cleanup-manifest.json");
const applicationMarker = /^(Integration Application |Hosted Phase |Phase \d+ live synthetic |TAA-PHASE\d+-)/u;
const mailboxNoise = new Set([
  "Первое письмо на почте",
  "Добавлен номер телефона +1541368**** в аккаунте",
]);
const counterpartyMarker = /^Integration Counterparty integration-\d+$/u;
const templateMarker = /(^Integration Template integration-\d+$)|(\bphase \d+\b|synthetic|mock)/iu;
const templateCodeMarker = /(phase\d+|synthetic|mock)/iu;

type Candidate = { id: string; label: string; storagePath?: string | null };
type Manifest = {
  createdAt: string;
  projectRef: string;
  actors: string[];
  applications: Candidate[];
  counterparties: Candidate[];
  templates: Candidate[];
  reports: Candidate[];
  storage: Array<{ bucket: string; path: string }>;
  checksum: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function stable(value: unknown) {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function checksum(value: Omit<Manifest, "checksum">) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ids(items: Candidate[]) {
  return items.map((item) => item.id).sort();
}

async function inventory(db: SupabaseClient): Promise<Omit<Manifest, "checksum">> {
  const testEmails = [
    process.env.SUPABASE_TEST_ADMIN_EMAIL,
    process.env.SUPABASE_TEST_SPECIALIST_EMAIL,
    process.env.SUPABASE_TEST_INACTIVE_EMAIL,
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim());
  if (testEmails.length === 0) throw new Error("Known integration user emails are required.");

  const [profiles, applications, counterparties, templates, reports] = await Promise.all([
    db.from("profiles").select("id,email,role,is_active").in("email", testEmails),
    db.from("applications").select("id,application_number,title"),
    db.from("counterparties").select("id,legal_name"),
    db.from("contract_templates").select("id,name,code,version,storage_path"),
    db.from("report_exports").select("id,filename,storage_path,generated_by"),
  ]);
  const firstError = profiles.error ?? applications.error ?? counterparties.error ?? templates.error ?? reports.error;
  if (firstError) throw new Error(`Inventory failed: ${firstError.message}`);

  const actorIds = (profiles.data ?? []).map((row) => row.id as string).sort();
  const admin = (profiles.data ?? []).find((row) => row.role === "admin" && row.is_active);
  if (!admin) throw new Error("An active known admin profile is required.");

  const appCandidates = (applications.data ?? [])
    .filter((row) => applicationMarker.test(row.title) || mailboxNoise.has(row.title))
    .map((row) => ({ id: row.id, label: `${row.application_number} · ${row.title}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const appIds = ids(appCandidates);
  const counterpartyCandidates = (counterparties.data ?? [])
    .filter((row) => counterpartyMarker.test(row.legal_name))
    .map((row) => ({ id: row.id, label: row.legal_name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const templateCandidates = (templates.data ?? [])
    .filter((row) => templateMarker.test(row.name) || templateCodeMarker.test(row.code ?? ""))
    .map((row) => ({
      id: row.id,
      label: `${row.name} · ${row.code ?? "без кода"} · ${row.version}`,
      storagePath: row.storage_path,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const reportCandidates = (reports.data ?? [])
    .filter((row) => actorIds.includes(row.generated_by))
    .map((row) => ({ id: row.id, label: row.filename ?? row.id, storagePath: row.storage_path }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const [attachments, versions] = appIds.length
    ? await Promise.all([
        db.from("attachments").select("id,storage_path").in("application_id", appIds),
        db.from("contract_versions")
          .select("id,storage_path,contract:contracts!contract_versions_contract_id_fkey(application_id)"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (attachments.error || versions.error) {
    throw new Error(`Storage inventory failed: ${attachments.error?.message ?? versions.error?.message}`);
  }
  const versionPaths = (versions.data ?? []).filter((row) => {
    const contract = Array.isArray(row.contract) ? row.contract[0] : row.contract;
    return contract && appIds.includes(contract.application_id);
  });
  const storage = [
    ...(attachments.data ?? []).map((row) => ({ bucket: "email-attachments", path: row.storage_path })),
    ...versionPaths.map((row) => ({ bucket: "contract-documents", path: row.storage_path })),
    ...templateCandidates.flatMap((row) => row.storagePath ? [{ bucket: "contract-documents", path: row.storagePath }] : []),
    ...reportCandidates.flatMap((row) => row.storagePath ? [{ bucket: "report-exports", path: row.storagePath }] : []),
  ].sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));

  const url = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
  return {
    createdAt: new Date().toISOString(),
    projectRef: url.hostname.split(".")[0] ?? "unknown",
    actors: actorIds,
    applications: appCandidates,
    counterparties: counterpartyCandidates,
    templates: templateCandidates,
    reports: reportCandidates,
    storage,
  };
}

function summary(manifest: Manifest) {
  console.table([
    { table: "applications", count: manifest.applications.length, criteria: "explicit integration/phase/TAA prefixes or two exact mailbox onboarding subjects" },
    { table: "counterparties", count: manifest.counterparties.length, criteria: "Integration Counterparty integration-<run id>" },
    { table: "contract_templates", count: manifest.templates.length, criteria: "Integration/Phase/synthetic/MOCK marker" },
    { table: "report_exports", count: manifest.reports.length, criteria: "generated by known integration user IDs" },
    { table: "storage.objects", count: manifest.storage.length, criteria: "paths referenced only by selected records" },
  ]);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Checksum: ${manifest.checksum}`);
  console.log("Preserved: profiles, auth users, migrations, settings, mailbox configuration, security/audit infrastructure, and every row without an explicit marker.");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run");
  if (apply === dryRun) throw new Error("Use exactly one of --dry-run or --apply.");
  const db = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const currentBase = await inventory(db);
  const current: Manifest = { ...currentBase, checksum: checksum(currentBase) };

  if (dryRun) {
    await writeFile(MANIFEST_PATH, JSON.stringify(current, null, 2), { encoding: "utf8", mode: 0o600 });
    summary(current);
    return;
  }

  const saved = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Manifest;
  if (saved.checksum !== checksum({
    createdAt: saved.createdAt,
    projectRef: saved.projectRef,
    actors: saved.actors,
    applications: saved.applications,
    counterparties: saved.counterparties,
    templates: saved.templates,
    reports: saved.reports,
    storage: saved.storage,
  })) {
    throw new Error("Cleanup manifest checksum is invalid.");
  }
  for (const key of ["actors", "applications", "counterparties", "templates", "reports"] as const) {
    const savedValues = key === "actors" ? saved[key] : ids(saved[key]);
    const currentValues = key === "actors" ? current[key] : ids(current[key]);
    if (stable(savedValues) !== stable(currentValues)) {
      throw new Error(`Cleanup manifest changed for ${key}; run --dry-run again.`);
    }
  }

  const adminEmail = required("SUPABASE_TEST_ADMIN_EMAIL");
  const admin = await db.from("profiles").select("id").eq("email", adminEmail).eq("role", "admin").eq("is_active", true).single();
  if (admin.error || !admin.data) throw new Error("Known active admin profile was not found.");
  const result = await db.rpc("cleanup_synthetic_records", {
    p_application_ids: ids(saved.applications),
    p_counterparty_ids: ids(saved.counterparties),
    p_template_ids: ids(saved.templates),
    p_report_ids: ids(saved.reports),
    p_allowed_actor_ids: saved.actors,
    p_actor_id: admin.data.id,
  });
  if (result.error) throw new Error(`Database cleanup failed: ${result.error.message}`);

  for (const bucket of new Set(saved.storage.map((item) => item.bucket))) {
    const paths = saved.storage.filter((item) => item.bucket === bucket).map((item) => item.path);
    for (let start = 0; start < paths.length; start += 100) {
      const removed = await db.storage.from(bucket).remove(paths.slice(start, start + 100));
      if (removed.error) throw new Error(`Storage cleanup failed for ${bucket}: ${removed.error.message}`);
    }
  }
  const after = await inventory(db);
  if (after.applications.length || after.counterparties.length || after.templates.length || after.reports.length) {
    throw new Error("Synthetic records remain after cleanup.");
  }
  console.log(JSON.stringify({ deleted: result.data, storageObjectsRemoved: saved.storage.length, orphanedSelectedPaths: 0 }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Production cleanup failed.");
  process.exitCode = 1;
});
