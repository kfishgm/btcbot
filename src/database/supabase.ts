import { createClient } from "@supabase/supabase-js";
import { Database } from "../../types/database.js";

export function getSupabaseClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";

  return createClient<Database>(supabaseUrl, supabaseKey);
}

export type SupabaseClient = ReturnType<typeof getSupabaseClient>;
