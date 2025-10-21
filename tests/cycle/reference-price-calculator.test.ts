import { ReferencePriceCalculator } from "../../src/cycle/reference-price-calculator";

describe("ReferencePriceCalculator", () => {
  let calculator: ReferencePriceCalculator;

  beforeEach(() => {
    calculator = new ReferencePriceCalculator();
  });

  describe("Initial Reference Price", () => {
    it("should return ATH value when no BTC accumulated", () => {
      const athPrice = 67890.5;
      const result = calculator.getInitialReferencePrice(athPrice);

      expect(result).toBe(athPrice);
    });

    it("should handle zero ATH value", () => {
      const result = calculator.getInitialReferencePrice(0);

      expect(result).toBe(0);
    });

    it("should handle negative ATH value (edge case)", () => {
      const result = calculator.getInitialReferencePrice(-100);

      expect(result).toBe(-100);
    });
  });

  describe("Calculate Reference Price - Single Purchase", () => {
    it("should calculate reference price for single purchase with USDT fee only", () => {
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0,
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // Per STRATEGY.md: cost_accum_usdt = usdt_spent ONLY (no fee additions)
      // cost_accum_usdt = 500
      // btc_accum_net = 0.01 - 0 = 0.01
      // reference_price = 500 / 0.01 = 50000
      expect(result).toBe(50000);
    });

    it("should calculate reference price for single purchase with BTC fee only", () => {
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0,
        fee_btc: 0.00001,
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // Per STRATEGY.md: cost = usdt_spent, BTC fee reduces denominator
      // cost_accum_usdt = 500
      // btc_accum_net = 0.01 - 0.00001 = 0.00999
      // reference_price = 500 / 0.00999 = 50050.0500...
      expect(result).toBeCloseTo(50050.05005, 4);
    });

    it("should calculate reference price for single purchase with both BTC and USDT fees", () => {
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.25,
        fee_btc: 0.00001,
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // Per STRATEGY.md: cost = usdt_spent, fees not added
      // cost_accum_usdt = 500
      // btc_accum_net = 0.01 - 0.00001 = 0.00999
      // reference_price = 500 / 0.00999 = 50050.0500...
      expect(result).toBeCloseTo(50050.05005, 4);
    });

    it("should handle zero fees", () => {
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0,
        fee_btc: 0,
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // cost_accum_usdt = 500 + 0 + 0 * 50000 = 500
      // btc_accum_net = 0.01 - 0 = 0.01
      // reference_price = 500 / 0.01 = 50000
      expect(result).toBe(50000);
    });
  });

  describe("Calculate Reference Price - Multiple Purchases", () => {
    it("should calculate weighted average for two purchases at different prices", () => {
      const purchases = [
        {
          btc_filled: 0.01,
          usdt_spent: 500,
          fee_usdt: 0.5,
          fee_btc: 0,
          fill_price: 50000,
        },
        {
          btc_filled: 0.02,
          usdt_spent: 1020,
          fee_usdt: 1.02,
          fee_btc: 0,
          fill_price: 51000,
        },
      ];

      const result = calculator.calculateReferencePrice(purchases);

      // Per STRATEGY.md: cost = usdt_spent only
      // First purchase: cost = 500, btc_net = 0.01
      // Second purchase: cost = 1020, btc_net = 0.02
      // Total: cost_accum_usdt = 500 + 1020 = 1520
      // Total: btc_accum_net = 0.01 + 0.02 = 0.03
      // reference_price = 1520 / 0.03 = 50666.6666...
      expect(result).toBeCloseTo(50666.6666, 4);
    });

    it("should handle multiple purchases with mixed fee currencies", () => {
      const purchases = [
        {
          btc_filled: 0.01,
          usdt_spent: 500,
          fee_usdt: 0.5,
          fee_btc: 0,
          fill_price: 50000,
        },
        {
          btc_filled: 0.01,
          usdt_spent: 510,
          fee_usdt: 0,
          fee_btc: 0.00001,
          fill_price: 51000,
        },
        {
          btc_filled: 0.01,
          usdt_spent: 520,
          fee_usdt: 0.26,
          fee_btc: 0.000005,
          fill_price: 52000,
        },
      ];

      const result = calculator.calculateReferencePrice(purchases);

      // Per STRATEGY.md: cost = usdt_spent only, BTC fees reduce denominator
      // Purchase 1: cost = 500, btc_net = 0.01
      // Purchase 2: cost = 510, btc_net = 0.01 - 0.00001 = 0.00999
      // Purchase 3: cost = 520, btc_net = 0.01 - 0.000005 = 0.009995
      // Total: cost_accum_usdt = 500 + 510 + 520 = 1530
      // Total: btc_accum_net = 0.01 + 0.00999 + 0.009995 = 0.029985
      // reference_price = 1530 / 0.029985 = 51025.512...
      expect(result).toBeCloseTo(51025.512, 2);
    });

    it("should calculate correctly for many small purchases", () => {
      const purchases = Array(10)
        .fill(null)
        .map((_, i) => ({
          btc_filled: 0.001,
          usdt_spent: 50 + i,
          fee_usdt: 0.05,
          fee_btc: 0.000001,
          fill_price: 50000 + i * 100,
        }));

      const result = calculator.calculateReferencePrice(purchases);

      // Calculate expected per STRATEGY.md formula
      let totalCost = 0;
      let totalBtc = 0;
      purchases.forEach((p) => {
        totalCost += p.usdt_spent; // Only usdt_spent, no fee additions
        totalBtc += p.btc_filled - p.fee_btc; // BTC fees reduce amount
      });
      const expected = totalCost / totalBtc;

      expect(result).toBeCloseTo(expected, 4);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle division by zero when net BTC is zero", () => {
      const purchase = {
        btc_filled: 0.00001,
        usdt_spent: 500,
        fee_usdt: 0,
        fee_btc: 0.00001, // Fee equals filled amount
        fill_price: 50000,
      };

      // btc_accum_net = 0.00001 - 0.00001 = 0
      // Should handle division by zero gracefully
      expect(() => calculator.calculateReferencePrice([purchase])).toThrow(
        "Cannot calculate reference price: net BTC accumulated is zero",
      );
    });

    it("should handle empty purchase array", () => {
      // With no purchases, should throw appropriate error
      expect(() => calculator.calculateReferencePrice([])).toThrow(
        "Cannot calculate reference price: no purchases provided",
      );
    });

    it("should handle very small BTC amounts (precision test)", () => {
      const purchase = {
        btc_filled: 0.00000001, // 1 satoshi
        usdt_spent: 0.0005,
        fee_usdt: 0.0000005,
        fee_btc: 0,
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // Per STRATEGY.md: cost = usdt_spent only
      // cost_accum_usdt = 0.0005
      // btc_accum_net = 0.00000001
      // reference_price = 0.0005 / 0.00000001 = 50000
      expect(result).toBeCloseTo(50000, 8);
    });

    it("should handle very large USDT amounts", () => {
      const purchase = {
        btc_filled: 100,
        usdt_spent: 5000000,
        fee_usdt: 5000,
        fee_btc: 0.1,
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // Per STRATEGY.md: cost = usdt_spent only
      // cost_accum_usdt = 5000000
      // btc_accum_net = 100 - 0.1 = 99.9
      // reference_price = 5000000 / 99.9 = 50050.05005...
      expect(result).toBeCloseTo(50050.05005, 4);
    });

    it("should handle negative values (should validate)", () => {
      const purchase = {
        btc_filled: -0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0,
        fill_price: 50000,
      };

      expect(() => calculator.calculateReferencePrice([purchase])).toThrow(
        "Invalid purchase data: negative values not allowed",
      );
    });

    it("should maintain precision for accumulated calculations", () => {
      // Test that accumulation doesn't lose precision over many operations
      const purchases = Array(100)
        .fill(null)
        .map(() => ({
          btc_filled: 0.00012345,
          usdt_spent: 6.172505,
          fee_usdt: 0.00617251,
          fee_btc: 0.00000012,
          fill_price: 50000.01,
        }));

      const result = calculator.calculateReferencePrice(purchases);

      // Per STRATEGY.md: cost = usdt_spent only
      // Each purchase:
      // cost = 6.172505
      // btc_net = 0.00012345 - 0.00000012 = 0.00012333
      // Total for 100 purchases:
      // total_cost = 6.172505 * 100 = 617.2505
      // total_btc = 0.00012333 * 100 = 0.012333
      // reference_price = 617.2505 / 0.012333 = 50048.337...
      expect(result).toBeCloseTo(50048.337, 2);
    });
  });

  describe("Interface Requirements", () => {
    it("should accept purchase data in the expected format", () => {
      // Test that the interface matches what the trading system will provide
      const purchaseData = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0.00001,
        fill_price: 50000,
      };

      // Should not throw
      expect(() =>
        calculator.calculateReferencePrice([purchaseData]),
      ).not.toThrow();
    });

    it("should return a number type for reference price", () => {
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0,
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      expect(typeof result).toBe("number");
      expect(isNaN(result)).toBe(false);
      expect(isFinite(result)).toBe(true);
    });

    it("should be able to calculate incrementally (adding purchases one by one)", () => {
      // Test that calculator can maintain state and add purchases incrementally
      calculator.addPurchase({
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0,
        fill_price: 50000,
      });

      let result = calculator.getCurrentReferencePrice();
      expect(result).toBe(50000); // 500 / 0.01

      calculator.addPurchase({
        btc_filled: 0.01,
        usdt_spent: 510,
        fee_usdt: 0.51,
        fee_btc: 0,
        fill_price: 51000,
      });

      result = calculator.getCurrentReferencePrice();
      // Per STRATEGY.md: cost = usdt_spent only
      // Total cost = 500 + 510 = 1010
      // Total BTC = 0.01 + 0.01 = 0.02
      // Reference = 1010 / 0.02 = 50500
      expect(result).toBe(50500);
    });

    it("should be able to reset state for new cycle", () => {
      calculator.addPurchase({
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0,
        fill_price: 50000,
      });

      expect(calculator.getCurrentReferencePrice()).toBe(50000); // 500 / 0.01

      calculator.reset();

      expect(() => calculator.getCurrentReferencePrice()).toThrow(
        "Cannot calculate reference price: no purchases in current cycle",
      );
    });

    it("should provide getters for accumulated values", () => {
      calculator.addPurchase({
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0.00001,
        fill_price: 50000,
      });

      calculator.addPurchase({
        btc_filled: 0.02,
        usdt_spent: 1020,
        fee_usdt: 1.02,
        fee_btc: 0.00002,
        fill_price: 51000,
      });

      // Per STRATEGY.md: cost_accum_usdt = usdt_spent only
      // cost_accum_usdt = 500 + 1020 = 1520
      expect(calculator.getTotalCostUSDT()).toBeCloseTo(1520, 4);

      // btc_accum_net = (0.01 - 0.00001) + (0.02 - 0.00002) = 0.00999 + 0.01998 = 0.02997
      expect(calculator.getNetBTCAccumulated()).toBeCloseTo(0.02997, 8);
    });
  });

  describe("Formula Verification", () => {
    it("should match STRATEGY.md formula: reference_price = cost_accum_usdt / btc_accum_net", () => {
      // Direct formula verification test
      const purchases = [
        {
          btc_filled: 0.015,
          usdt_spent: 750,
          fee_usdt: 0.75,
          fee_btc: 0.000015,
          fill_price: 50000,
        },
        {
          btc_filled: 0.01,
          usdt_spent: 520,
          fee_usdt: 0.52,
          fee_btc: 0.00001,
          fill_price: 52000,
        },
      ];

      // Manual calculation following STRATEGY.md formula exactly
      // Per STRATEGY.md lines 209-218: cost_accum_usdt = Σ(usdt_spent) ONLY
      // Purchase 1:
      // cost_accum_usdt = 750
      // btc_accum_net = 0.015 - 0.000015 = 0.014985

      // Purchase 2:
      // cost_accum_usdt = 520
      // btc_accum_net = 0.010 - 0.000010 = 0.009990

      // Totals:
      // total_cost_accum_usdt = 750 + 520 = 1270
      // total_btc_accum_net = 0.014985 + 0.009990 = 0.024975
      // reference_price = 1270 / 0.024975 = 50851.35...

      const result = calculator.calculateReferencePrice(purchases);
      expect(result).toBeCloseTo(50851.35, 2);
    });

    it("should NOT add BTC fees to cost (avoids double-counting)", () => {
      // Verify that BTC fees only reduce BTC, NOT added to cost
      // This is CRITICAL to avoid double-counting per STRATEGY.md
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0,
        fee_btc: 0.0001, // 1% fee in BTC (high for testing)
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // Per STRATEGY.md: NO double-counting
      // cost_accum_usdt = 500 (ONLY usdt_spent, BTC fee NOT added)
      // btc_accum_net = 0.01 - 0.0001 = 0.0099 (BTC fee reduces amount)
      // reference_price = 500 / 0.0099 = 50505.050...
      // Note: This is higher than fill_price due to reduced BTC (correct!)
      expect(result).toBeCloseTo(50505.05, 2);
    });

    it("should correctly reduce BTC accumulated by fee_base", () => {
      // Verify that BTC fees reduce the net BTC accumulated
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0,
        fee_btc: 0.001, // 10% fee in BTC (extreme for testing)
        fill_price: 50000,
      };

      // Use instance method to update state
      calculator.addPurchase(purchase);
      const result = calculator.getCurrentReferencePrice();

      // btc_accum_net should be 0.01 - 0.001 = 0.009
      expect(calculator.getNetBTCAccumulated()).toBeCloseTo(0.009, 10);

      // Per STRATEGY.md: cost = usdt_spent only
      // cost_accum_usdt = 500
      // reference_price = 500 / 0.009 = 55555.555...
      // Note: Higher than fill_price due to 10% BTC fee reducing amount
      expect(result).toBeCloseTo(55555.555, 3);
    });
  });

  describe("Cross-Validation", () => {
    it("should match BuyOrderStateUpdater calculation logic", () => {
      // This test ensures ReferencePriceCalculator matches the production
      // implementation in BuyOrderStateUpdater (buy-order-state-updater.ts:254-378)

      const purchases = [
        {
          btc_filled: 0.01,
          usdt_spent: 500,
          fee_usdt: 0.5,
          fee_btc: 0.00001,
          fill_price: 50000,
        },
        {
          btc_filled: 0.02,
          usdt_spent: 1020,
          fee_usdt: 1.02,
          fee_btc: 0.00002,
          fill_price: 51000,
        },
      ];

      const result = calculator.calculateReferencePrice(purchases);

      // BuyOrderStateUpdater logic (lines 239-257):
      // totalCostUsdt = usdtSpent (no fee addition)
      // newBtcAccumNet = btcFilled - feeBTC
      // referencePrice = totalCostUsdt / newBtcAccumNet

      // Manual calculation per BuyOrderStateUpdater:
      // Purchase 1: cost = 500, btc_net = 0.01 - 0.00001 = 0.00999
      // Purchase 2: cost = 1020, btc_net = 0.02 - 0.00002 = 0.01998
      // Total: cost = 1520, btc_net = 0.02997
      // Reference price = 1520 / 0.02997 = 50717.517...

      expect(result).toBeCloseTo(50717.517, 2);
    });

    it("should avoid double-counting fees per STRATEGY.md", () => {
      // Verify the critical fix: fees affect ONLY denominator, NOT numerator
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 1000,
        fee_usdt: 1.0,
        fee_btc: 0.0001,
        fill_price: 100000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // CORRECT (current implementation):
      // cost = 1000 (fees NOT added)
      // btc_net = 0.01 - 0.0001 = 0.0099
      // reference_price = 1000 / 0.0099 = 101010.101...

      // INCORRECT (old buggy implementation would have been):
      // cost = 1000 + 1.0 + (0.0001 * 100000) = 1000 + 1 + 10 = 1011
      // btc_net = 0.01 - 0.0001 = 0.0099
      // reference_price = 1011 / 0.0099 = 102121.212...

      expect(result).toBeCloseTo(101010.101, 2);
      expect(result).not.toBeCloseTo(102121.212, 2); // Ensure old bug is fixed
    });
  });
});
