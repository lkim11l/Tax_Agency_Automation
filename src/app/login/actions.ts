"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/applications";
  }

  return value;
}

export async function signIn(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");
  const nextPath = safeNextPath(formData.get("next"));

  if (typeof email !== "string" || typeof password !== "string") {
    redirect("/login?error=invalid-input");
  }

  const supabase = await createClient();
  if (!supabase) {
    redirect("/login?reason=configuration");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect("/login?error=invalid-credentials");
  }

  redirect(nextPath);
}
