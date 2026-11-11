import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. BYPASSES row-level security.
 * Only use it in server code, and only after you have verified the caller
 * owns whatever you are touching.
 */
export function createAdminClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
