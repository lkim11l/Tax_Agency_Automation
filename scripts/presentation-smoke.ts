import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { createServerClient } from "@supabase/ssr";

const baseUrl = (process.env.PRESENTATION_BASE_URL ?? "https://tax-agency-automation.vercel.app").replace(/\/$/u, "");
const acceptance = process.argv.includes("--acceptance");

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

type CookieValue = { name: string; value: string };

async function authenticatedCookie() {
  let values: CookieValue[] = [];
  const client = createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => values,
        setAll: (next) => {
          values = next.map(({ name, value }) => ({ name, value }));
        },
      },
    },
  );
  const login = await client.auth.signInWithPassword({
    email: required("SUPABASE_TEST_ADMIN_EMAIL"),
    password: required("SUPABASE_TEST_ADMIN_PASSWORD"),
  });
  if (login.error || !login.data.user) throw new Error("Production smoke login failed.");
  return {
    header: values.map(({ name, value }) => `${name}=${value}`).join("; "),
    signOut: () => client.auth.signOut(),
  };
}

async function measure(path: string, cookie: string, mobile = false) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: {
      cookie,
      "user-agent": mobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile"
        : "TaxAgencyPresentationSmoke/1.0",
    },
  });
  const headersAt = performance.now();
  const body = await response.text();
  const ended = performance.now();
  return {
    path,
    status: response.status,
    ttfbMs: Math.round(headersAt - started),
    totalMs: Math.round(ended - started),
    payloadBytes: Buffer.byteLength(body),
    body,
  };
}

async function main() {
  const anonymous = await fetch(`${baseUrl}/applications`, { redirect: "manual" });
  if (![302, 303, 307, 308].includes(anonymous.status) || !anonymous.headers.get("location")?.includes("/login")) {
    throw new Error("Anonymous route protection failed.");
  }
  const health = await fetch(`${baseUrl}/api/health`);
  const healthBody = await health.json() as { status?: string };
  if (!healthBody.status || (acceptance && (!health.ok || healthBody.status !== "ok"))) {
    throw new Error("Health endpoint failed.");
  }

  const session = await authenticatedCookie();
  const routes = ["/applications", "/registry", "/templates", "/reports", "/settings"];
  const measurements = [];
  for (const path of routes) {
    const cold = await measure(path, session.header);
    const warm = await measure(path, session.header);
    if (cold.status !== 200 || warm.status !== 200) throw new Error(`${path} returned ${warm.status}.`);
    measurements.push({
      path,
      cold: { ttfbMs: cold.ttfbMs, totalMs: cold.totalMs, payloadBytes: cold.payloadBytes },
      warm: { ttfbMs: warm.ttfbMs, totalMs: warm.totalMs, payloadBytes: warm.payloadBytes },
    });
    if (acceptance && /(Integration |Hosted Phase|MOCK|TAA-PHASE)/u.test(warm.body)) {
      throw new Error(`Synthetic marker is visible on ${path}.`);
    }
    const mobile = await measure(path, session.header, true);
    if (mobile.status !== 200) throw new Error(`Mobile smoke failed on ${path}.`);
  }
  const templates = await measure("/templates", session.header);
  if (acceptance) {
    for (const label of [
      "Договор консультационных услуг",
      "Договор возмездного оказания услуг",
      "Договор поставки",
      "Ожидает утверждения заказчиком",
    ]) {
      if (!templates.body.includes(label)) throw new Error(`Template acceptance label missing: ${label}`);
    }
  }
  const logout = await session.signOut();
  if (logout.error) throw new Error("Smoke logout failed.");

  const output = {
    productionUrl: baseUrl,
    measuredAt: new Date().toISOString(),
    health: healthBody.status,
    anonymousRedirect: anonymous.headers.get("location"),
    measurements,
  };
  const outputPath = join(tmpdir(), acceptance ? "tax-agency-performance-after.json" : "tax-agency-performance-before.json");
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify({ ...output, outputPath }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Presentation smoke failed.");
  process.exitCode = 1;
});
