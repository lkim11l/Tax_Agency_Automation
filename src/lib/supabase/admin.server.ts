import { createClient } from "@supabase/supabase-js";

import { loadSupabaseSecretConfig } from "@/modules/email/config";

export function createAdminClient() {
  const { url, secretKey } = loadSupabaseSecretConfig();
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
