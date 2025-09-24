import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { SellOrderStateUpdater } from "../../src/cycle/sell-order-state-updater";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscordNotifier } from "../../src/notifications/discord-notifier";
import type { OrderResult } from "../../src/order/sell-order-placer";
import type { CycleState } from "../../src/cycle/cycle-state-manager";
import { Decimal } from "decimal.js";

describe("SellOrderStateUpdater - Fills-Based Reconciliation", () => {
  let stateUpdater: SellOrderStateUpdater;
  let mockSupabase: SupabaseClient;
  let mockDiscordNotifier: DiscordNotifier;

  beforeEach(() => {
    // Create mock Supabase client
    mockSupabase = {
      from: jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({
                  data: { success: true },
                  error: null,
                }),
              ),
            })),
          })),
        })),
      })),
    } as unknown as SupabaseClient;

    // Create mock Discord notifier
    mockDiscordNotifier = {
      sendCycleCompleteAlert: jest.fn(),
      sendSellOrderAlert: jest.fn(),
    } as unknown as DiscordNotifier;

    // Create state updater with configuration
    stateUpdater = new SellOrderStateUpdater(
      mockSupabase,
      { maxPurchases: 10 },
      mockDiscordNotifier,
    );
  });

  describe("Fills-based reconciliation", () => {
    it("should use fills data for precise BTC and USDT calculation", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 100,
        btc_accumulated: 0.5,
        purchases_remaining: 5,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderResult: OrderResult = {
        orderId: 12345,
        clientOrderId: "SELL_123",
        status: "FILLED",
        executedQty: new Decimal(0.5),
        cummulativeQuoteQty: new Decimal(25500), // Total USDT
        avgPrice: new Decimal(51000),
        fills: [
          {
            price: "50900",
            qty: "0.2",
            commission: "0.00001",
            commissionAsset: "BTC",
          },
          {
            price: "51050",
            qty: "0.15",
            commission: "0.0000075",
            commissionAsset: "BTC",
          },
          {
            price: "51100",
            qty: "0.15",
            commission: "0.0000075",
            commissionAsset: "BTC",
          },
        ],
        feeBTC: new Decimal(0.000025),
        feeUSDT: new Decimal(0),
        feeOther: {},
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      // Verify fills were used for calculation
      const expectedUsdtReceived = 0.2 * 50900 + 0.15 * 51050 + 0.15 * 51100; // 25,495

      expect(result.success).toBe(true);
      expect(result.updatedState?.btc_accumulated).toBeCloseTo(0, 8);
      expect(result.updatedState?.capital_available).toBeCloseTo(
        100 + expectedUsdtReceived,
        2,
      );

      // Verify reconciliation details
      expect(result.reconciliation).toBeDefined();
      expect(result.reconciliation?.actualBtcSold).toBe(0.5);
      expect(result.reconciliation?.actualUsdtReceived).toBe(25495);
      expect(result.reconciliation?.fills).toHaveLength(3);
    });

    it("should handle partial fills correctly", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 200,
        btc_accumulated: 1.0,
        purchases_remaining: 3,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 200,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderResult: OrderResult = {
        orderId: 12346,
        clientOrderId: "SELL_124",
        status: "PARTIALLY_FILLED",
        executedQty: new Decimal(0.7), // Only 0.7 of 1.0 sold
        cummulativeQuoteQty: new Decimal(35700),
        avgPrice: new Decimal(51000),
        fills: [
          {
            price: "51000",
            qty: "0.5",
            commission: "0.000025",
            commissionAsset: "BTC",
          },
          {
            price: "51000",
            qty: "0.2",
            commission: "0.00001",
            commissionAsset: "BTC",
          },
        ],
        feeBTC: new Decimal(0.000035),
        feeUSDT: new Decimal(0),
        feeOther: {},
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      expect(result.success).toBe(true);
      // Should have 0.3 BTC remaining (1.0 - 0.7)
      expect(result.updatedState?.btc_accumulated).toBeCloseTo(0.3, 8);
      // Capital should increase by USDT received
      expect(result.updatedState?.capital_available).toBeCloseTo(
        200 + 35700,
        2,
      );
      // Status should remain HOLDING since BTC still accumulated
      expect(result.updatedState?.status).toBe("HOLDING");

      // Verify reconciliation
      expect(result.reconciliation?.actualBtcSold).toBe(0.7);
      expect(result.reconciliation?.actualUsdtReceived).toBe(35700);
    });

    it("should fallback to order data when fills are unavailable", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 150,
        btc_accumulated: 0.3,
        purchases_remaining: 7,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderResult: OrderResult = {
        orderId: 12347,
        clientOrderId: "SELL_125",
        status: "FILLED",
        executedQty: new Decimal(0.3),
        cummulativeQuoteQty: new Decimal(15300),
        avgPrice: new Decimal(51000),
        fills: [], // No fills data available
        feeBTC: new Decimal(0.000015),
        feeUSDT: new Decimal(0),
        feeOther: {},
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      expect(result.success).toBe(true);
      // Should use executedQty and cummulativeQuoteQty from order
      expect(result.updatedState?.btc_accumulated).toBeCloseTo(0, 8);
      expect(result.updatedState?.capital_available).toBeCloseTo(
        150 + 15300,
        2,
      );

      // Verify fallback was used
      expect(result.reconciliation?.actualBtcSold).toBe(0.3);
      expect(result.reconciliation?.actualUsdtReceived).toBe(15300);
      expect(result.reconciliation?.fills).toHaveLength(0);
    });

    it("should calculate fees correctly from fills", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 500,
        btc_accumulated: 0.25,
        purchases_remaining: 2,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 250,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderResult: OrderResult = {
        orderId: 12348,
        clientOrderId: "SELL_126",
        status: "FILLED",
        executedQty: new Decimal(0.25),
        cummulativeQuoteQty: new Decimal(12750),
        avgPrice: new Decimal(51000),
        fills: [
          {
            price: "51000",
            qty: "0.1",
            commission: "0.1", // USDT fee
            commissionAsset: "USDT",
          },
          {
            price: "51000",
            qty: "0.1",
            commission: "0.000005", // BTC fee
            commissionAsset: "BTC",
          },
          {
            price: "51000",
            qty: "0.05",
            commission: "0.001", // BNB fee
            commissionAsset: "BNB",
          },
        ],
        feeBTC: new Decimal(0.000005),
        feeUSDT: new Decimal(0.1),
        feeOther: { BNB: new Decimal(0.001) },
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      expect(result.success).toBe(true);

      // Verify fee calculations
      expect(result.reconciliation?.totalFeeBTC).toBe(0.000005);
      expect(result.reconciliation?.totalFeeUSDT).toBe(0.1);
      expect(result.reconciliation?.feeDetails?.BNB).toBe(0.001);
    });

    it("should handle complete cycle (all BTC sold) correctly", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 0, // All capital was used to buy BTC
        btc_accumulated: 0.1,
        purchases_remaining: 0, // All purchases used
        ath_price: 60000,
        reference_price: 45000,
        buy_amount: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderResult: OrderResult = {
        orderId: 12349,
        clientOrderId: "SELL_127",
        status: "FILLED",
        executedQty: new Decimal(0.1),
        cummulativeQuoteQty: new Decimal(5500), // Sold at profit
        avgPrice: new Decimal(55000),
        fills: [
          {
            price: "55000",
            qty: "0.1",
            commission: "0.000005",
            commissionAsset: "BTC",
          },
        ],
        feeBTC: new Decimal(0.000005),
        feeUSDT: new Decimal(0),
        feeOther: {},
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      expect(result.success).toBe(true);
      // Cycle should be reset
      expect(result.updatedState?.status).toBe("READY");
      expect(result.updatedState?.btc_accumulated).toBe(0);
      expect(result.updatedState?.purchases_remaining).toBe(10); // Reset to max
      expect(result.updatedState?.capital_available).toBe(5500); // All USDT from sale
      expect(result.updatedState?.reference_price).toBeNull();
      expect(result.updatedState?.last_action).toBe("SELL");

      // Verify Discord notification was sent for cycle completion
      expect(mockDiscordNotifier.sendCycleCompleteAlert).toHaveBeenCalled();
    });

    it("should maintain precision for very small BTC amounts", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 50,
        btc_accumulated: 0.00012345, // Small amount
        purchases_remaining: 8,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderResult: OrderResult = {
        orderId: 12350,
        clientOrderId: "SELL_128",
        status: "FILLED",
        executedQty: new Decimal(0.00012345),
        cummulativeQuoteQty: new Decimal(6.29595), // 0.00012345 * 51000
        avgPrice: new Decimal(51000),
        fills: [
          {
            price: "51000",
            qty: "0.00012345",
            commission: "0.00000001",
            commissionAsset: "BTC",
          },
        ],
        feeBTC: new Decimal(0.00000001),
        feeUSDT: new Decimal(0),
        feeOther: {},
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      expect(result.success).toBe(true);
      // Should handle small amounts precisely
      expect(result.updatedState?.btc_accumulated).toBeLessThan(0.00000001); // Dust
      expect(result.updatedState?.capital_available).toBeCloseTo(
        50 + 6.29595,
        5,
      );

      // Verify precision in reconciliation
      expect(result.reconciliation?.actualBtcSold).toBe(0.00012345);
      expect(result.reconciliation?.actualUsdtReceived).toBeCloseTo(6.29595, 5);
    });

    it("should verify fills match order totals", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 300,
        btc_accumulated: 0.4,
        purchases_remaining: 4,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 150,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Create fills that sum to order totals
      const fills = [
        {
          price: "51000",
          qty: "0.15",
          commission: "0.0000075",
          commissionAsset: "BTC",
        },
        {
          price: "51010",
          qty: "0.10",
          commission: "0.000005",
          commissionAsset: "BTC",
        },
        {
          price: "51020",
          qty: "0.15",
          commission: "0.0000075",
          commissionAsset: "BTC",
        },
      ];

      // Calculate expected totals from fills
      const expectedQty = 0.15 + 0.1 + 0.15; // 0.4
      const expectedQuote = 0.15 * 51000 + 0.1 * 51010 + 0.15 * 51020; // 20,404

      const orderResult: OrderResult = {
        orderId: 12351,
        clientOrderId: "SELL_129",
        status: "FILLED",
        executedQty: new Decimal(expectedQty),
        cummulativeQuoteQty: new Decimal(expectedQuote),
        avgPrice: new Decimal(expectedQuote / expectedQty),
        fills: fills,
        feeBTC: new Decimal(0.00002),
        feeUSDT: new Decimal(0),
        feeOther: {},
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      expect(result.success).toBe(true);

      // Verify fills were properly summed
      expect(result.reconciliation?.actualBtcSold).toBeCloseTo(expectedQty, 8);
      expect(result.reconciliation?.actualUsdtReceived).toBeCloseTo(
        expectedQuote,
        2,
      );

      // Verify state was updated correctly
      expect(result.updatedState?.btc_accumulated).toBeCloseTo(0, 8);
      expect(result.updatedState?.capital_available).toBeCloseTo(
        300 + expectedQuote,
        2,
      );
    });
  });

  describe("Error handling", () => {
    it("should handle missing order result gracefully", async () => {
      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 100,
        btc_accumulated: 0.5,
        purchases_remaining: 5,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        null as unknown as OrderResult,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid order result");
    });

    it("should handle database update failures", async () => {
      // Mock database failure
      mockSupabase.from = jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({
                  data: null,
                  error: { message: "Database error" },
                }),
              ),
            })),
          })),
        })),
      })) as unknown as (typeof mockSupabase)["from"];

      const currentState: CycleState = {
        id: "test-cycle-id",
        status: "HOLDING",
        capital_available: 100,
        btc_accumulated: 0.5,
        purchases_remaining: 5,
        ath_price: 60000,
        reference_price: 50000,
        buy_amount: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderResult: OrderResult = {
        orderId: 12352,
        clientOrderId: "SELL_130",
        status: "FILLED",
        executedQty: new Decimal(0.5),
        cummulativeQuoteQty: new Decimal(25500),
        avgPrice: new Decimal(51000),
        fills: [],
        feeBTC: new Decimal(0.000025),
        feeUSDT: new Decimal(0),
        feeOther: {},
      };

      const result = await stateUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to update cycle state");
    });
  });
});
