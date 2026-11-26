import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Anonymous, cookie-free client for public careers pages. RLS limits it to
 * published jobs and public organisation columns. Because it reads no
 * cookies, pages using it can be statically cached.
 */
export function createPublicClient() {
  return createClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
