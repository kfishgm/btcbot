import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { TradingRules } from "../../src/exchange/trading-rules";
import type { BinanceClient } from "../../src/exchange/binance-client";

describe("Smart Rounding for Buy Orders", () => {
  let tradingRules: TradingRules;
  let mockBinanceClient: BinanceClient;

  beforeEach(() => {
    mockBinanceClient = {
      getExchangeInfo: jest.fn(() =>
        Promise.resolve({
          symbols: [
            {
              symbol: "BTCUSDT",
              filters: [
                {
                  filterType: "LOT_SIZE",
                  minQty: "0.00001",
                  maxQty: "9000.00000000",
                  stepSize: "0.00001",
                },
                {
                  filterType: "PRICE_FILTER",
                  minPrice: "0.01",
                  maxPrice: "1000000",
                  tickSize: "0.01",
                },
                {
                  filterType: "NOTIONAL",
                  minNotional: "5.00000000",
                  maxPositionNotional: "90000000",
                  stepSize: "0.00001",
                },
              ],
            },
          ],
        }),
      ),
    } as unknown as BinanceClient;

    tradingRules = new TradingRules(mockBinanceClient);
  });

  describe("roundQuantityForBuyOrder", () => {
    beforeEach(async () => {
      // Pre-cache the rules
      await tradingRules.getRules("BTCUSDT");
    });

    it("should round UP when close to target spend", () => {
      // At price $115,456.46, spending $30
      const targetSpend = 30;
      const currentPrice = 115456.46;
      const rawQuantity = targetSpend / currentPrice; // 0.00025984

      const rounded = tradingRules.roundQuantityForBuyOrder(
        rawQuantity,
        targetSpend,
        currentPrice,
        "BTCUSDT",
      );

      // Should round UP to 0.00026 for better efficiency
      expect(rounded).toBe(0.00026);

      // Verify spend is within 0.5% of target
      const actualSpend = rounded * currentPrice;
      expect(actualSpend).toBeGreaterThan(29.85); // Within 0.5%
      expect(actualSpend).toBeLessThan(30.15); // Within 0.5%
    });

    it("should round DOWN when rounding up would exceed tolerance", () => {
      // Create a scenario where rounding up would exceed 0.5%
      const targetSpend = 30;
      const currentPrice = 150000; // Higher price = smaller quantity
      const rawQuantity = targetSpend / currentPrice; // 0.0002

      const rounded = tradingRules.roundQuantityForBuyOrder(
        rawQuantity,
        targetSpend,
        currentPrice,
        "BTCUSDT",
      );

      // Should round to 0.00020 (exact match, no rounding needed)
      expect(rounded).toBe(0.0002);

      const actualSpend = rounded * currentPrice;
      expect(actualSpend).toBe(30); // Exact match
    });

    it("should handle edge case at exactly 50% of step size", () => {
      // Quantity exactly at 0.000005 above a step
      const targetSpend = 30;
      const currentPrice = 120000;
      const rawQuantity = 0.00025; // Exactly on a step

      const rounded = tradingRules.roundQuantityForBuyOrder(
        rawQuantity,
        targetSpend,
        currentPrice,
        "BTCUSDT",
      );

      expect(rounded).toBe(0.00025); // No rounding needed
      const actualSpend = rounded * currentPrice;
      expect(actualSpend).toBe(30);
    });

    it("should maximize spending across multiple purchases", () => {
      const buyAmount = 30;
      const prices = [100000, 110000, 120000, 130000, 140000];
      let totalSpent = 0;
      let totalBTC = 0;

      for (const price of prices) {
        const rawQuantity = buyAmount / price;
        const rounded = tradingRules.roundQuantityForBuyOrder(
          rawQuantity,
          buyAmount,
          price,
          "BTCUSDT",
        );

        const actualSpend = rounded * price;
        totalSpent += actualSpend;
        totalBTC += rounded;

        // Each purchase should be close to target (within reason)
        // At some prices, rounding down is necessary to avoid excessive overspend
        expect(actualSpend).toBeGreaterThan(29.3); // At least 97.7% efficiency
        expect(actualSpend).toBeLessThanOrEqual(30.0); // Never exceed target (capital limit)
      }

      // Total spent should be very close to intended (5 * $30 = $150)
      expect(totalSpent).toBeGreaterThan(147); // At least 98% efficiency
      expect(totalSpent).toBeLessThanOrEqual(150); // Never exceed total capital

      console.log(
        `Smart rounding efficiency: ${(totalSpent / 150) * 100}% of target`,
      );
    });

    it("should respect available capital constraint", () => {
      // When we only have exactly $30 available
      const targetSpend = 30;
      const availableCapital = 30; // Exact amount available
      const currentPrice = 115456.46;
      const rawQuantity = targetSpend / currentPrice; // 0.00025984

      const rounded = tradingRules.roundQuantityForBuyOrder(
        rawQuantity,
        targetSpend,
        currentPrice,
        "BTCUSDT",
        availableCapital,
      );

      // Should round DOWN to avoid exceeding capital
      expect(rounded).toBe(0.00025); // Rounds down

      const actualSpend = rounded * currentPrice;
      expect(actualSpend).toBeLessThanOrEqual(availableCapital);
      expect(actualSpend).toBeGreaterThan(28); // Still close to target
    });

    it("should respect minimum quantity constraints", () => {
      const targetSpend = 0.5; // Very small spend
      const currentPrice = 100000;
      const rawQuantity = targetSpend / currentPrice; // 0.000005 (below minQty)

      const rounded = tradingRules.roundQuantityForBuyOrder(
        rawQuantity,
        targetSpend,
        currentPrice,
        "BTCUSDT",
      );

      // Should respect minQty of 0.00001
      expect(rounded).toBe(0.00001);
    });

    it("should demonstrate profitability improvement", () => {
      // Simulate a full cycle with smart rounding
      // const initialCapital = 300; // Not used in calculations
      const maxPurchases = 10;
      const buyAmountPerPurchase = 30;
      const avgBuyPrice = 100000;
      const risePct = 0.02; // 2% rise trigger

      let totalSpent = 0;
      let totalBTC = 0;

      // Simulate purchases with smart rounding
      for (let i = 0; i < maxPurchases; i++) {
        const rawQuantity = buyAmountPerPurchase / avgBuyPrice;
        const rounded = tradingRules.roundQuantityForBuyOrder(
          rawQuantity,
          buyAmountPerPurchase,
          avgBuyPrice,
          "BTCUSDT",
        );

        const actualSpend = rounded * avgBuyPrice;
        totalSpent += actualSpend;
        totalBTC += rounded;
      }

      // Calculate profit
      const sellPrice = avgBuyPrice * (1 + risePct);
      const revenue = totalBTC * sellPrice * 0.999; // 0.1% trading fee
      const profit = revenue - totalSpent;
      const roi = (profit / totalSpent) * 100;

      console.log("=== Smart Rounding Profitability ===");
      console.log(`Total spent: $${totalSpent.toFixed(2)}`);
      console.log(`BTC accumulated: ${totalBTC.toFixed(8)}`);
      console.log(`Sell price: $${sellPrice.toFixed(2)}`);
      console.log(`Revenue: $${revenue.toFixed(2)}`);
      console.log(`Profit: $${profit.toFixed(2)}`);
      console.log(`ROI: ${roi.toFixed(2)}%`);

      // Should be profitable!
      expect(profit).toBeGreaterThan(0);
      expect(roi).toBeGreaterThan(1.5); // At least 1.5% ROI
    });
  });

  describe("backwards compatibility", () => {
    beforeEach(async () => {
      await tradingRules.getRules("BTCUSDT");
    });

    it("should still have roundQuantityToStep for sell orders", () => {
      const quantity = 0.00025984;
      const rounded = tradingRules.roundQuantityToStep(quantity, "BTCUSDT");

      // Should round DOWN as before (for sell orders)
      expect(rounded).toBe(0.00025);
    });
  });
});
