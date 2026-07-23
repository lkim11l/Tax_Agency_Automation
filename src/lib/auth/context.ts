import { redirect } from "next/navigation";

import {
  assertOperationalAccess,
  AuthenticationRequiredError,
  InactiveProfileError,
  type OperationalProfile,
} from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export async function getOperationalContext() {
  const supabase = await createClient();
  if (!supabase) {
    throw new AuthenticationRequiredError();
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new AuthenticationRequiredError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load the signed-in profile: ${error.message}`);
  }

  const profile = data as OperationalProfile | null;
  if (!profile) {
    throw new InactiveProfileError();
  }
  assertOperationalAccess(profile);

  return { supabase, user, profile };
}

export async function requireOperationalContextOrRedirect() {
  try {
    return await getOperationalContext();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/login");
    }
    if (error instanceof InactiveProfileError) {
      redirect("/login?error=inactive");
    }
    throw error;
  }
}
