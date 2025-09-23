#!/usr/bin/env tsx

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey);

async function resetCycle() {
  console.log("Resetting cycle state...");

  const { data, error } = await supabase
    .from("cycle_state")
    .update({
      btc_accumulated: 0,
      btc_accum_net: 0,
      cost_accum_usdt: 0,
      capital_available: 300,
      purchases_remaining: 10,
      reference_price: null,
      buy_amount: 30,
      status: "READY",
      ath_price: null,
      buy_grid: null,
      buy_index: 0,
      version: 15, // Increment from current
      updated_at: new Date().toISOString(),
    })
    .eq("id", "586bdd47-8eb5-44c7-9a16-54938fc3baee")
    .select()
    .single();

  if (error) {
    console.error("Error resetting cycle:", error);
    process.exit(1);
  }

  console.log("Cycle reset successfully:");
  console.log(JSON.stringify(data, null, 2));
}

resetCycle().catch(console.error);
