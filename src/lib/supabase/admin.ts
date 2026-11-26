import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use only in server code that has
 * already validated input and authorised the caller (e.g. the public
 * application endpoint, the message sender, signed resume links).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. See .env.example.");
  return createClient(publicEnv.supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
