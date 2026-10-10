import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let client: SupabaseClient | null | undefined;

/**
 * Server-only Supabase client using the secret key. All database access goes through
 * the server; the browser never receives a Supabase key, and RLS denies anon access.
 *
 * Returns `null` when Supabase isn't configured, which selects the in-memory repository.
 */
export function getSupabaseServerClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = serverEnv();
  if (env.PERSISTENCE !== "supabase" || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    client = null;
    return client;
  }
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
