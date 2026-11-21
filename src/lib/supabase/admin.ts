import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. It bypasses Row Level Security, so use it only for
 * work that has no signed-in user (sign-in checks, Drive scans, audit writes)
 * and always after checking the caller's role in application code.
 */
export function createAdminClient() {
  return createSupabaseClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
