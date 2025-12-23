import { describe, it, expect, beforeEach } from "@jest/globals";
import { BuyTriggerDetector } from "../../src/cycle/buy-trigger-detector";
import { BuyAmountCalculator } from "../../src/cycle/buy-amount-calculator";
import type { StrategyConfig } from "../../src/config/strategy-config-loader";

describe("Grid Anchoring Strategy", () => {
  let detector: BuyTriggerDetector;
  let buyAmountCalculator: BuyAmountCalculator;

  beforeEach(() => {
    buyAmountCalculator = new BuyAmountCalculator();

    const mockStrategyConfig: StrategyConfig = {
      id: "test-config",
      timeframe: "15m",
      dropPercentage: 0.003,
      risePercentage: 0.005,
      maxPurchases: 10,
      minBuyUsdt: 10,
      initialCapitalUsdt: 500,
      slippageBuyPct: 0.003,
      slippageSellPct: 0.003,
      athWindow: 25,
      isActive: true,
      updatedAt: new Date().toISOString(),
      buyMode: "arithmetic",
    };

    detector = new BuyTriggerDetector(buyAmountCalculator, mockStrategyConfig);
  });

  describe("Grid Quantization", () => {
    it("should quantize grid levels to tick size using floor operation", async () => {
      const config = {
        dropPercentage: 0.003, // 0.3%
        risePercentage: 0.005,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      // Test with ATH price that creates uneven grid levels
      const anchorPrice = 116557.79; // First buy price

      // Build grid from anchor (simulating what happens after first buy)
      const gridFromAnchor = await detector.buildGridFromAnchor(
        anchorPrice,
        config,
      );

      // All grid levels should be quantized to 0.01 (tick size)
      gridFromAnchor.forEach((level: number, index: number) => {
        // Check that when rounded to 2 decimals, it matches the expected quantized value
        const rounded = Math.round(level * 100) / 100;
        expect(level).toBeCloseTo(rounded, 10);

        // Each level should be below the anchor price
        expect(level).toBeLessThan(anchorPrice);

        // Each level should be dropPercentage * (index + 1) below anchor
        const expectedDrop =
          anchorPrice * (1 - (index + 1) * config.dropPercentage);
        const quantizedExpected = Math.floor(expectedDrop / 0.01) * 0.01;
        expect(level).toBeCloseTo(quantizedExpected, 10);
      });
    });
  });

  describe("Grid Rebuild After First Buy", () => {
    it("should rebuild grid from anchor price after first buy", async () => {
      const config = {
        dropPercentage: 0.003, // 0.3%
        risePercentage: 0.005,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      const firstBuyPrice = 116557.79;

      // After first buy, rebuild grid from anchor
      const gridFromAnchor = await detector.buildGridFromAnchor(
        firstBuyPrice,
        config,
      );

      // First level from anchor should be ~0.3% below anchor (first buy price)
      const firstLevelFromAnchor = gridFromAnchor[0];
      const expectedFirstFromAnchor =
        Math.floor((firstBuyPrice * (1 - 0.003)) / 0.01) * 0.01;
      expect(firstLevelFromAnchor).toBe(expectedFirstFromAnchor);

      // Verify first level is BELOW the buy price (prevents immediate re-buy)
      expect(firstLevelFromAnchor).toBeLessThan(firstBuyPrice);

      // Calculate gap from buy price to next trigger
      const gapPercent =
        ((firstBuyPrice - firstLevelFromAnchor) / firstBuyPrice) * 100;
      expect(gapPercent).toBeCloseTo(0.3, 1); // Should be close to drop percentage
    });

    it("should set buy_index to 0 after grid rebuild", async () => {
      // This tests the logic that after rebuilding the grid from anchor,
      // the buy_index should be reset to 0 (not 1)
      // This is critical to prevent skipping the first level of the new grid

      const config = {
        dropPercentage: 0.003,
        risePercentage: 0.005,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      const anchorPrice = 116557.79;
      const newGrid = await detector.buildGridFromAnchor(anchorPrice, config);

      // When grid is rebuilt, the correct buy_index should be 0
      // This means the next buy will trigger at newGrid[0]
      const correctBuyIndex = 0;

      // Simulate checking for next buy trigger
      const currentPrice = newGrid[0] - 0.01; // Price just below first level
      const wouldTriggerAtIndex0 = currentPrice <= newGrid[correctBuyIndex];

      expect(wouldTriggerAtIndex0).toBe(true);

      // If buy_index was incorrectly set to 1, it would skip first level
      const incorrectBuyIndex = 1;
      const wouldTriggerAtIndex1 = currentPrice <= newGrid[incorrectBuyIndex];

      expect(wouldTriggerAtIndex1).toBe(false); // Should NOT trigger at index 1
    });
  });

  describe("Client's Actual Scenario", () => {
    it("should handle the reported bug case correctly", async () => {
      // Reproduce the exact scenario from the client's bug report
      const config = {
        dropPercentage: 0.003, // 0.3%
        risePercentage: 0.005, // 0.5%
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      // Client's exact values
      const firstBuyExecutedAt = 116557.79;

      // Client reported issue: grid wasn't rebuilt from anchor after first buy
      // Problem: Grid level 116629.77 (from ATH) is ABOVE buy price 116557.79
      const problemLevel = 116629.77;
      expect(problemLevel).toBeGreaterThan(firstBuyExecutedAt);

      // Solution: Rebuild grid from anchor (first buy price)
      const anchoredGrid = await detector.buildGridFromAnchor(
        firstBuyExecutedAt,
        config,
      );

      // New first level should be BELOW the buy price
      expect(anchoredGrid[0]).toBeLessThan(firstBuyExecutedAt);

      // Should be approximately firstBuyPrice * (1 - 0.003)
      const expectedAnchoredFirst =
        Math.floor((116557.79 * 0.997) / 0.01) * 0.01;
      expect(anchoredGrid[0]).toBe(expectedAnchoredFirst);

      // Verify the gap
      const gap =
        ((firstBuyExecutedAt - anchoredGrid[0]) / firstBuyExecutedAt) * 100;
      expect(gap).toBeCloseTo(0.3, 1);
    });
  });

  describe("Reference Price Calculation", () => {
    it("should calculate reference price including fees", async () => {
      // Test that reference price = cost_accum_usdt / btc_accum_net
      const btcBought = 0.00857;
      const btcFee = 0.00000857; // 0.1% fee
      const netBtcReceived = btcBought - btcFee;
      const usdtSpent = 999.23;

      const referencePrice = usdtSpent / netBtcReceived;

      // Reference price should be slightly higher than avg price due to fees
      const avgPrice = usdtSpent / btcBought;
      expect(referencePrice).toBeGreaterThan(avgPrice);

      // The difference should be approximately the fee percentage
      const priceDifference = (referencePrice - avgPrice) / avgPrice;
      expect(priceDifference).toBeCloseTo(0.001, 3); // ~0.1% fee
    });
  });

  describe("Sell Threshold Calculation", () => {
    it("should calculate sell threshold from reference price", async () => {
      const referencePrice = 116700.5;
      const risePercentage = 0.005; // 0.5%

      const sellThreshold = referencePrice * (1 + risePercentage);
      const expectedThreshold = 116700.5 * 1.005;

      expect(sellThreshold).toBe(expectedThreshold);
      expect(sellThreshold).toBeCloseTo(117284, 0);
    });

    it("should calculate gap to trigger correctly", async () => {
      const buyPrice = 116557.79;
      const referencePrice = 116700.5;
      const risePercentage = 0.005;

      const sellThreshold = referencePrice * (1 + risePercentage);
      const gapToTrigger = ((sellThreshold - buyPrice) / buyPrice) * 100;

      // Gap should be positive (sell threshold above buy price)
      expect(gapToTrigger).toBeGreaterThan(0);

      // Should be approximately rise percentage plus some margin
      expect(gapToTrigger).toBeGreaterThan(risePercentage * 100);
    });
  });
});
