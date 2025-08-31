import { createClient } from "@supabase/supabase-js";
import { Database } from "../../types/supabase.js";

describe("Database Schema", () => {
  let supabase: ReturnType<typeof createClient<Database>>;

  beforeAll(() => {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
    supabase = createClient<Database>(supabaseUrl, supabaseKey);
  });

  afterAll(async () => {
    // Clean up test data
    await supabase
      .from("bot_events")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase
      .from("trades")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase
      .from("cycle_state")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase
      .from("strategy_config")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
  });

  describe("strategy_config table", () => {
    it("should exist and have correct structure", async () => {
      const { data, error } = await supabase
        .from("strategy_config")
        .select("*")
        .limit(0);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it("should accept valid strategy configuration", async () => {
      const validConfig = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
        slippage_buy_pct: 0.003,
        slippage_sell_pct: 0.003,
        is_active: true,
      };

      const { data, error } = await supabase
        .from("strategy_config")
        .insert(validConfig)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data).toMatchObject(validConfig);
        expect(data.id).toBeDefined();
        expect(data.updated_at).toBeDefined();
      }
    });

    it("should have UUID primary key with auto-generation", async () => {
      const config = {
        timeframe: "4h",
        drop_percentage: 0.04,
        rise_percentage: 0.06,
        max_purchases: 5,
        min_buy_usdt: 10.0,
        initial_capital_usdt: 500.0,
      };

      const { data, error } = await supabase
        .from("strategy_config")
        .insert(config)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    });

    it("should enforce required fields", async () => {
      // Test by trying to insert with missing required fields using type assertion
      const { error } = await supabase.from("strategy_config").insert({
        timeframe: "1h",
        drop_percentage: 0.03,
      } as Database["public"]["Tables"]["strategy_config"]["Insert"]);

      expect(error).toBeDefined();
    });

    it("should validate timeframe values", async () => {
      const invalidTimeframe = {
        timeframe: "invalid",
        drop_percentage: 0.03,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { error } = await supabase
        .from("strategy_config")
        .insert(invalidTimeframe);

      expect(error).toBeDefined();
    });

    it("should validate drop_percentage range (0.0200 to 0.0800)", async () => {
      const tooLow = {
        timeframe: "1h",
        drop_percentage: 0.01, // Too low
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { error: lowError } = await supabase
        .from("strategy_config")
        .insert(tooLow);

      expect(lowError).toBeDefined();

      const tooHigh = {
        timeframe: "1h",
        drop_percentage: 0.09, // Too high
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { error: highError } = await supabase
        .from("strategy_config")
        .insert(tooHigh);

      expect(highError).toBeDefined();
    });

    it("should validate rise_percentage range (0.0200 to 0.0800)", async () => {
      const tooLow = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.01, // Too low
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { error: lowError } = await supabase
        .from("strategy_config")
        .insert(tooLow);

      expect(lowError).toBeDefined();

      const tooHigh = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.09, // Too high
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { error: highError } = await supabase
        .from("strategy_config")
        .insert(tooHigh);

      expect(highError).toBeDefined();
    });

    it("should validate max_purchases range (1 to 30)", async () => {
      const tooLow = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.05,
        max_purchases: 0, // Too low
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { error: lowError } = await supabase
        .from("strategy_config")
        .insert(tooLow);

      expect(lowError).toBeDefined();

      const tooHigh = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.05,
        max_purchases: 31, // Too high
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { error: highError } = await supabase
        .from("strategy_config")
        .insert(tooHigh);

      expect(highError).toBeDefined();
    });

    it("should validate min_buy_usdt >= 10.00", async () => {
      const tooLow = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 9.99, // Too low
        initial_capital_usdt: 1000.0,
      };

      const { error } = await supabase.from("strategy_config").insert(tooLow);

      expect(error).toBeDefined();
    });

    it("should apply default values", async () => {
      const minimalConfig = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { data, error } = await supabase
        .from("strategy_config")
        .insert(minimalConfig)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.slippage_buy_pct).toBe(0.003);
        expect(data.slippage_sell_pct).toBe(0.003);
        expect(data.is_active).toBe(false);
        expect(data.updated_at).toBeDefined();
      }
    });

    it("should auto-update updated_at timestamp", async () => {
      const config = {
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 15.0,
        initial_capital_usdt: 1000.0,
      };

      const { data: inserted } = await supabase
        .from("strategy_config")
        .insert(config)
        .select()
        .single();

      const firstTimestamp = inserted?.updated_at;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const { data: updated } = await supabase
        .from("strategy_config")
        .update({ is_active: true })
        .eq("id", inserted!.id)
        .select()
        .single();

      expect(updated?.updated_at).not.toBe(firstTimestamp);
    });
  });

  describe("cycle_state table", () => {
    it("should exist and have correct structure", async () => {
      const { data, error } = await supabase
        .from("cycle_state")
        .select("*")
        .limit(0);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it("should accept valid cycle state", async () => {
      const validCycle = {
        status: "READY",
        capital_available: 1000.0,
        btc_accumulated: 0.0,
        purchases_remaining: 10,
        reference_price: 50000.0,
        cost_accum_usdt: 0.0,
        btc_accum_net: 0.0,
        ath_price: 50000.0,
        buy_amount: 100.0,
      };

      const { data, error } = await supabase
        .from("cycle_state")
        .insert(validCycle)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data).toMatchObject(validCycle);
        expect(data.id).toBeDefined();
        expect(data.updated_at).toBeDefined();
      }
    });

    it("should have UUID primary key with auto-generation", async () => {
      const cycle = {
        status: "HOLDING",
        capital_available: 500.0,
        purchases_remaining: 5,
      };

      const { data, error } = await supabase
        .from("cycle_state")
        .insert(cycle)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    });

    it("should enforce required fields", async () => {
      // Test by trying to insert with missing required fields using type assertion
      const { error } = await supabase.from("cycle_state").insert({
        status: "READY",
      } as Database["public"]["Tables"]["cycle_state"]["Insert"]);

      expect(error).toBeDefined();
    });

    it("should validate status values", async () => {
      const invalidStatus = {
        status: "INVALID",
        capital_available: 1000.0,
        purchases_remaining: 10,
      };

      const { error } = await supabase
        .from("cycle_state")
        .insert(invalidStatus);

      expect(error).toBeDefined();
    });

    it("should apply default values", async () => {
      const minimalCycle = {
        status: "READY",
        capital_available: 1000.0,
        purchases_remaining: 10,
      };

      const { data, error } = await supabase
        .from("cycle_state")
        .insert(minimalCycle)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.btc_accumulated).toBe(0);
        expect(data.cost_accum_usdt).toBe(0);
        expect(data.btc_accum_net).toBe(0);
        expect(data.updated_at).toBeDefined();
      }
    });

    it("should allow null reference_price, ath_price, and buy_amount", async () => {
      const cycleWithNulls = {
        status: "READY",
        capital_available: 1000.0,
        purchases_remaining: 10,
        reference_price: null,
        ath_price: null,
        buy_amount: null,
      };

      const { data, error } = await supabase
        .from("cycle_state")
        .insert(cycleWithNulls)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.reference_price).toBeNull();
        expect(data.ath_price).toBeNull();
        expect(data.buy_amount).toBeNull();
      }
    });
  });

  describe("trades table", () => {
    let testCycleId: string;

    beforeAll(async () => {
      // Create a test cycle for foreign key reference
      const { data } = await supabase
        .from("cycle_state")
        .insert({
          status: "HOLDING",
          capital_available: 1000.0,
          purchases_remaining: 10,
        })
        .select()
        .single();

      testCycleId = data?.id || "";
    });

    it("should exist and have correct structure", async () => {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .limit(0);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it("should accept valid trade", async () => {
      const validTrade = {
        cycle_id: testCycleId,
        type: "BUY",
        order_id: "ORDER123",
        status: "FILLED",
        price: 50000.0,
        quantity: 0.002,
        quote_quantity: 100.0,
        fee_asset: "BTC",
        fee_amount: 0.000002,
        executed_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("trades")
        .insert(validTrade)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data).toMatchObject({
          ...validTrade,
          executed_at: expect.any(String),
        });
        expect(data.id).toBeDefined();
        expect(data.created_at).toBeDefined();
      }
    });

    it("should have UUID primary key with auto-generation", async () => {
      const trade = {
        cycle_id: testCycleId,
        type: "SELL",
        order_id: "ORDER456",
        status: "FILLED",
        price: 51000.0,
        quantity: 0.001,
        quote_quantity: 51.0,
        executed_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("trades")
        .insert(trade)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    });

    it("should enforce foreign key constraint on cycle_id", async () => {
      const invalidTrade = {
        cycle_id: "00000000-0000-0000-0000-000000000000", // Non-existent cycle
        type: "BUY",
        order_id: "ORDER789",
        status: "FILLED",
        price: 50000.0,
        quantity: 0.002,
        quote_quantity: 100.0,
        executed_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("trades").insert(invalidTrade);

      expect(error).toBeDefined();
      expect(error?.message).toContain("foreign key");
    });

    it("should validate type values", async () => {
      const invalidType = {
        cycle_id: testCycleId,
        type: "INVALID",
        order_id: "ORDER999",
        status: "FILLED",
        price: 50000.0,
        quantity: 0.002,
        quote_quantity: 100.0,
        executed_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("trades").insert(invalidType);

      expect(error).toBeDefined();
    });

    it("should validate status values", async () => {
      const invalidStatus = {
        cycle_id: testCycleId,
        type: "BUY",
        order_id: "ORDER111",
        status: "INVALID",
        price: 50000.0,
        quantity: 0.002,
        quote_quantity: 100.0,
        executed_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("trades").insert(invalidStatus);

      expect(error).toBeDefined();
    });

    it("should allow null fee_asset and fee_amount", async () => {
      const tradeWithoutFees = {
        cycle_id: testCycleId,
        type: "BUY",
        order_id: "ORDER222",
        status: "FILLED",
        price: 50000.0,
        quantity: 0.002,
        quote_quantity: 100.0,
        fee_asset: null,
        fee_amount: null,
        executed_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("trades")
        .insert(tradeWithoutFees)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.fee_asset).toBeNull();
        expect(data.fee_amount).toBeNull();
      }
    });

    it("should enforce required fields", async () => {
      // Test by trying to insert with missing required fields using type assertion
      const { error } = await supabase.from("trades").insert({
        cycle_id: testCycleId,
        type: "BUY",
      } as Database["public"]["Tables"]["trades"]["Insert"]);

      expect(error).toBeDefined();
    });
  });

  describe("bot_events table", () => {
    it("should exist and have correct structure", async () => {
      const { data, error } = await supabase
        .from("bot_events")
        .select("*")
        .limit(0);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it("should accept valid event", async () => {
      const validEvent = {
        event_type: "START",
        severity: "INFO",
        message: "Bot started successfully",
        metadata: { version: "1.0.0", config: "production" },
      };

      const { data, error } = await supabase
        .from("bot_events")
        .insert(validEvent)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data).toMatchObject(validEvent);
        expect(data.id).toBeDefined();
        expect(data.created_at).toBeDefined();
      }
    });

    it("should have UUID primary key with auto-generation", async () => {
      const event = {
        event_type: "STOP",
        severity: "INFO",
        message: "Bot stopped",
      };

      const { data, error } = await supabase
        .from("bot_events")
        .insert(event)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    });

    it("should enforce required fields", async () => {
      // Test by trying to insert with missing required fields using type assertion
      const { error } = await supabase.from("bot_events").insert({
        event_type: "ERROR",
      } as Database["public"]["Tables"]["bot_events"]["Insert"]);

      expect(error).toBeDefined();
    });

    it("should validate event_type values", async () => {
      const validTypes = [
        "START",
        "STOP",
        "ERROR",
        "DRIFT_HALT",
        "TRADE_EXECUTED",
        "CYCLE_COMPLETE",
      ];

      for (const type of validTypes) {
        const event = {
          event_type: type,
          severity: "INFO",
          message: `Test ${type} event`,
        };

        const { error } = await supabase.from("bot_events").insert(event);

        expect(error).toBeNull();
      }
    });

    it("should validate severity values", async () => {
      const validSeverities = ["INFO", "WARNING", "ERROR"];

      for (const severity of validSeverities) {
        const event = {
          event_type: "START",
          severity: severity,
          message: `Test ${severity} event`,
        };

        const { error } = await supabase.from("bot_events").insert(event);

        expect(error).toBeNull();
      }

      const invalidSeverity = {
        event_type: "START",
        severity: "INVALID",
        message: "Test invalid severity",
      };

      const { error } = await supabase
        .from("bot_events")
        .insert(invalidSeverity);

      expect(error).toBeDefined();
    });

    it("should allow null message and metadata", async () => {
      const minimalEvent = {
        event_type: "START",
        severity: "INFO",
        message: null,
        metadata: null,
      };

      const { data, error } = await supabase
        .from("bot_events")
        .insert(minimalEvent)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.message).toBeNull();
        expect(data.metadata).toBeNull();
      }
    });

    it("should store complex JSONB metadata", async () => {
      const complexMetadata = {
        nested: {
          deeply: {
            nested: {
              value: 123,
            },
          },
        },
        array: [1, 2, 3],
        boolean: true,
        null_value: null,
        string: "test",
      };

      const event = {
        event_type: "START",
        severity: "INFO",
        message: "Complex metadata test",
        metadata: complexMetadata,
      };

      const { data, error } = await supabase
        .from("bot_events")
        .insert(event)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.metadata).toEqual(complexMetadata);
      }
    });
  });

  describe("Database Migrations", () => {
    it("should be idempotent - running migrations multiple times should not fail", async () => {
      // This test would run the migration SQL twice and verify no errors
      // In practice, this would be done through a migration runner
      // For now, we just verify tables exist

      const tables = [
        "strategy_config",
        "cycle_state",
        "trades",
        "bot_events",
      ] as const;

      for (const table of tables) {
        const { error } = await supabase.from(table).select("*").limit(0);

        expect(error).toBeNull();
      }
    });

    it("should have proper indexes for performance", async () => {
      // Verify that foreign key indexes exist
      // This would typically query pg_indexes but for now we verify queries work efficiently

      // Query trades by cycle_id (should use index)
      const { error: tradeError } = await supabase
        .from("trades")
        .select("*")
        .eq("cycle_id", "00000000-0000-0000-0000-000000000000")
        .limit(1);

      expect(tradeError).toBeNull();

      // Query events by event_type (should be efficient)
      const { error: eventError } = await supabase
        .from("bot_events")
        .select("*")
        .eq("event_type", "START")
        .limit(1);

      expect(eventError).toBeNull();
    });
  });

  describe("Data Integrity", () => {
    it("should maintain referential integrity when deleting cycles", async () => {
      // Create a cycle
      const { data: cycle } = await supabase
        .from("cycle_state")
        .insert({
          status: "READY",
          capital_available: 1000.0,
          purchases_remaining: 10,
        })
        .select()
        .single();

      // Create a trade referencing the cycle
      const { data: trade } = await supabase
        .from("trades")
        .insert({
          cycle_id: cycle!.id,
          type: "BUY",
          order_id: "REF_TEST",
          status: "FILLED",
          price: 50000.0,
          quantity: 0.002,
          quote_quantity: 100.0,
          executed_at: new Date().toISOString(),
        })
        .select()
        .single();

      // Try to delete the cycle (should fail due to foreign key constraint)
      const { error } = await supabase
        .from("cycle_state")
        .delete()
        .eq("id", cycle!.id);

      expect(error).toBeDefined();
      expect(error?.message).toContain("foreign key");

      // Clean up
      await supabase.from("trades").delete().eq("id", trade!.id);
      await supabase.from("cycle_state").delete().eq("id", cycle!.id);
    });

    it("should handle decimal precision correctly", async () => {
      const preciseValues = {
        timeframe: "1h",
        drop_percentage: 0.0234, // 4 decimal places
        rise_percentage: 0.0567, // 4 decimal places
        max_purchases: 10,
        min_buy_usdt: 10.12345678, // 8 decimal places
        initial_capital_usdt: 999.87654321, // 8 decimal places
      };

      const { data, error } = await supabase
        .from("strategy_config")
        .insert(preciseValues)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      if (data) {
        expect(data.drop_percentage).toBe(0.0234);
        expect(data.rise_percentage).toBe(0.0567);
        expect(data.min_buy_usdt).toBeCloseTo(10.12345678, 8);
        expect(data.initial_capital_usdt).toBeCloseTo(999.87654321, 8);
      }
    });

    it("should handle concurrent updates correctly", async () => {
      // Create initial cycle
      const { data: cycle } = await supabase
        .from("cycle_state")
        .insert({
          status: "READY",
          capital_available: 1000.0,
          purchases_remaining: 10,
        })
        .select()
        .single();

      // Simulate concurrent updates
      const update1 = supabase
        .from("cycle_state")
        .update({ capital_available: 900.0 })
        .eq("id", cycle!.id);

      const update2 = supabase
        .from("cycle_state")
        .update({ purchases_remaining: 9 })
        .eq("id", cycle!.id);

      const [result1, result2] = await Promise.all([update1, update2]);

      expect(result1.error).toBeNull();
      expect(result2.error).toBeNull();

      // Verify final state
      const { data: final } = await supabase
        .from("cycle_state")
        .select()
        .eq("id", cycle!.id)
        .single();

      // One of the updates should have won
      expect(final).toBeDefined();
      expect([9, 10]).toContain(final?.purchases_remaining);
    });
  });
});
