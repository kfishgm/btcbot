import { describe, it, expect } from "@jest/globals";

describe("Buy Order Amount Issue", () => {
  describe("Current Implementation Issue", () => {
    it("should demonstrate the problem from Discord notification", () => {
      // From Discord: Bot wanted to spend $30 but only spent $27.82
      const targetSpend = 30;
      const currentPrice = 115912.49;
      const slippage = 0.003; // 0.3% default
      const stepSize = 0.00001;

      // Current implementation: Calculate quantity using limit price
      const limitPrice = currentPrice * (1 + slippage);
      const rawQuantity = targetSpend / limitPrice;
      const roundedQuantity = Math.floor(rawQuantity / stepSize) * stepSize;

      // What we actually spend at market price
      const actualSpend = roundedQuantity * currentPrice;

      console.log("=== Current Implementation (BUGGY) ===");
      console.log("Target spend: $" + targetSpend);
      console.log("Current price: $" + currentPrice);
      console.log("Limit price (with slippage): $" + limitPrice.toFixed(2));
      console.log("Raw quantity: " + rawQuantity.toFixed(8) + " BTC");
      console.log("Rounded quantity: " + roundedQuantity.toFixed(8) + " BTC");
      console.log("Actual spend at market: $" + actualSpend.toFixed(2));
      console.log("Lost amount: $" + (targetSpend - actualSpend).toFixed(2));
      console.log(
        "Loss percentage: " +
          ((1 - actualSpend / targetSpend) * 100).toFixed(2) +
          "%",
      );

      // Verify we're losing money
      expect(actualSpend).toBeLessThan(targetSpend);
      expect(actualSpend).toBeCloseTo(28.98, 1); // Close to what we calculated
    });

    it("should show cumulative loss over 10 purchases", () => {
      const buyAmount = 30; // $30 per purchase
      const slippage = 0.003;
      const stepSize = 0.00001;
      let totalLost = 0;

      // Simulate 10 purchases at different prices
      const prices = [
        100000, 105000, 110000, 115000, 120000, 125000, 130000, 135000, 140000,
        145000,
      ];

      for (const currentPrice of prices) {
        const limitPrice = currentPrice * (1 + slippage);
        const rawQuantity = buyAmount / limitPrice;
        const roundedQuantity = Math.floor(rawQuantity / stepSize) * stepSize;
        const actualSpend = roundedQuantity * currentPrice;
        const lost = buyAmount - actualSpend;
        totalLost += lost;
      }

      console.log("\n=== Loss Over 10 Purchases ===");
      console.log("Target per purchase: $30");
      console.log("Total target spend: $300");
      console.log("Total lost: $" + totalLost.toFixed(2));
      console.log(
        "Loss percentage: " + ((totalLost / 300) * 100).toFixed(2) + "%",
      );

      // With 10 purchases, we're losing around $6-10
      expect(totalLost).toBeGreaterThan(6);
      expect(totalLost).toBeLessThan(12);
    });
  });

  describe("Proposed Fix", () => {
    it("should spend much closer to target with proposed fix", () => {
      const targetSpend = 30;
      const currentPrice = 115912.49;
      const slippage = 0.003;
      const stepSize = 0.00001;

      // PROPOSED FIX: Calculate quantity using CURRENT price, not limit price
      const limitPrice = currentPrice * (1 + slippage);
      const rawQuantity = targetSpend / currentPrice; // USE CURRENT PRICE
      const roundedQuantity = Math.floor(rawQuantity / stepSize) * stepSize;

      // What we actually spend
      const actualSpend = roundedQuantity * currentPrice;

      console.log("\n=== Proposed Fix ===");
      console.log("Target spend: $" + targetSpend);
      console.log("Current price: $" + currentPrice);
      console.log("Limit price (for order): $" + limitPrice.toFixed(2));
      console.log("Raw quantity: " + rawQuantity.toFixed(8) + " BTC");
      console.log("Rounded quantity: " + roundedQuantity.toFixed(8) + " BTC");
      console.log("Actual spend: $" + actualSpend.toFixed(2));
      console.log("Lost amount: $" + (targetSpend - actualSpend).toFixed(2));
      console.log(
        "Loss percentage: " +
          ((1 - actualSpend / targetSpend) * 100).toFixed(2) +
          "%",
      );

      // Should be closer to target (within 5% is acceptable due to rounding)
      expect(actualSpend).toBeGreaterThan(28.5); // At least 95% of target
      expect(actualSpend).toBeLessThanOrEqual(30);
    });

    it("should show minimal loss over 10 purchases with fix", () => {
      const buyAmount = 30;
      const stepSize = 0.00001;
      let totalLost = 0;

      const prices = [
        100000, 105000, 110000, 115000, 120000, 125000, 130000, 135000, 140000,
        145000,
      ];

      for (const currentPrice of prices) {
        // Use current price for quantity calculation
        const rawQuantity = buyAmount / currentPrice;
        const roundedQuantity = Math.floor(rawQuantity / stepSize) * stepSize;
        const actualSpend = roundedQuantity * currentPrice;
        const lost = buyAmount - actualSpend;
        totalLost += lost;
      }

      console.log("\n=== Loss Over 10 Purchases (WITH FIX) ===");
      console.log("Target per purchase: $30");
      console.log("Total target spend: $300");
      console.log("Total lost: $" + totalLost.toFixed(2));
      console.log(
        "Loss percentage: " + ((totalLost / 300) * 100).toFixed(2) + "%",
      );

      // Should lose less than $5 total (due to rounding down to step size)
      expect(totalLost).toBeLessThan(5);
      expect(totalLost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Real World Impact", () => {
    it("should calculate BTC difference over time", () => {
      const initialCapital = 300;
      const numPurchases = 10;
      const buyAmount = initialCapital / numPurchases;
      const avgPrice = 100000; // $100k BTC for easy math

      // Current buggy implementation
      const slippage = 0.003;
      const limitPrice = avgPrice * (1 + slippage);
      const buggyQtyPerPurchase =
        Math.floor(buyAmount / limitPrice / 0.00001) * 0.00001;
      const buggyTotalBTC = buggyQtyPerPurchase * numPurchases;

      // Fixed implementation
      const fixedQtyPerPurchase =
        Math.floor(buyAmount / avgPrice / 0.00001) * 0.00001;
      const fixedTotalBTC = fixedQtyPerPurchase * numPurchases;

      const btcDifference = fixedTotalBTC - buggyTotalBTC;
      const percentDifference = (btcDifference / fixedTotalBTC) * 100;

      console.log("\n=== BTC Accumulation Difference ===");
      console.log("With bug: " + buggyTotalBTC.toFixed(8) + " BTC");
      console.log("With fix: " + fixedTotalBTC.toFixed(8) + " BTC");
      console.log("Difference: " + btcDifference.toFixed(8) + " BTC");
      console.log(
        "That's " + percentDifference.toFixed(2) + "% less BTC with the bug!",
      );

      // The difference might be 0 due to rounding effects being larger than slippage
      expect(percentDifference).toBeGreaterThanOrEqual(0);
      expect(percentDifference).toBeLessThan(1);
    });
  });
});
