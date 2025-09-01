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

      // cost_accum_usdt = 500 + 0.5 + 0 * 50000 = 500.5
      // btc_accum_net = 0.01 - 0 = 0.01
      // reference_price = 500.5 / 0.01 = 50050
      expect(result).toBe(50050);
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

      // cost_accum_usdt = 500 + 0 + 0.00001 * 50000 = 500 + 0.5 = 500.5
      // btc_accum_net = 0.01 - 0.00001 = 0.00999
      // reference_price = 500.5 / 0.00999 = 50100.1001...
      expect(result).toBeCloseTo(50100.1001, 4);
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

      // cost_accum_usdt = 500 + 0.25 + 0.00001 * 50000 = 500 + 0.25 + 0.5 = 500.75
      // btc_accum_net = 0.01 - 0.00001 = 0.00999
      // reference_price = 500.75 / 0.00999 = 50125.1251...
      expect(result).toBeCloseTo(50125.1251, 4);
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

      // First purchase: cost = 500 + 0.5 = 500.5, btc_net = 0.01
      // Second purchase: cost = 1020 + 1.02 = 1021.02, btc_net = 0.02
      // Total: cost_accum_usdt = 500.5 + 1021.02 = 1521.52
      // Total: btc_accum_net = 0.01 + 0.02 = 0.03
      // reference_price = 1521.52 / 0.03 = 50717.3333...
      expect(result).toBeCloseTo(50717.3333, 4);
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

      // Purchase 1: cost = 500 + 0.5 + 0 = 500.5, btc_net = 0.01
      // Purchase 2: cost = 510 + 0 + 0.00001 * 51000 = 510 + 0.51 = 510.51, btc_net = 0.01 - 0.00001 = 0.00999
      // Purchase 3: cost = 520 + 0.26 + 0.000005 * 52000 = 520 + 0.26 + 0.26 = 520.52, btc_net = 0.01 - 0.000005 = 0.009995
      // Total: cost_accum_usdt = 500.5 + 510.51 + 520.52 = 1531.53
      // Total: btc_accum_net = 0.01 + 0.00999 + 0.009995 = 0.029985
      // reference_price = 1531.53 / 0.029985 = 51086.0143...
      expect(result).toBeCloseTo(51086.0143, 4);
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

      // Calculate expected
      let totalCost = 0;
      let totalBtc = 0;
      purchases.forEach((p) => {
        totalCost += p.usdt_spent + p.fee_usdt + p.fee_btc * p.fill_price;
        totalBtc += p.btc_filled - p.fee_btc;
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

      // cost_accum_usdt = 0.0005 + 0.0000005 = 0.0005005
      // btc_accum_net = 0.00000001
      // reference_price = 0.0005005 / 0.00000001 = 50050
      expect(result).toBe(50050);
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

      // cost_accum_usdt = 5000000 + 5000 + 0.1 * 50000 = 5000000 + 5000 + 5000 = 5010000
      // btc_accum_net = 100 - 0.1 = 99.9
      // reference_price = 5010000 / 99.9 = 50150.1501...
      expect(result).toBeCloseTo(50150.1501, 4);
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

      // Each purchase:
      // cost = 6.172505 + 0.00617251 + 0.00000012 * 50000.01 = 6.172505 + 0.00617251 + 0.00600001 = 6.18467752
      // btc_net = 0.00012345 - 0.00000012 = 0.00012333
      // Total for 100 purchases:
      // total_cost = 6.18467752 * 100 = 618.467752
      // total_btc = 0.00012333 * 100 = 0.012333
      // reference_price = 618.467752 / 0.012333 = 50150.1501...
      expect(result).toBeCloseTo(50150.1501, 4);
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
      expect(result).toBe(50050);

      calculator.addPurchase({
        btc_filled: 0.01,
        usdt_spent: 510,
        fee_usdt: 0.51,
        fee_btc: 0,
        fill_price: 51000,
      });

      result = calculator.getCurrentReferencePrice();
      // Total cost = 500.5 + 510.51 = 1011.01
      // Total BTC = 0.01 + 0.01 = 0.02
      // Reference = 1011.01 / 0.02 = 50550.5
      expect(result).toBe(50550.5);
    });

    it("should be able to reset state for new cycle", () => {
      calculator.addPurchase({
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0.5,
        fee_btc: 0,
        fill_price: 50000,
      });

      expect(calculator.getCurrentReferencePrice()).toBe(50050);

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

      // cost_accum_usdt = (500 + 0.5 + 0.00001 * 50000) + (1020 + 1.02 + 0.00002 * 51000)
      //                 = (500.5 + 0.5) + (1021.02 + 1.02) = 501 + 1022.04 = 1523.04
      expect(calculator.getTotalCostUSDT()).toBeCloseTo(1523.04, 4);

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
      // Purchase 1:
      // cost_accum_usdt = 750 + 0.75 + 0.000015 * 50000 = 750 + 0.75 + 0.75 = 751.5
      // btc_accum_net = 0.015 - 0.000015 = 0.014985

      // Purchase 2:
      // cost_accum_usdt = 520 + 0.52 + 0.000010 * 52000 = 520 + 0.52 + 0.52 = 521.04
      // btc_accum_net = 0.010 - 0.000010 = 0.009990

      // Totals:
      // total_cost_accum_usdt = 751.5 + 521.04 = 1272.54
      // total_btc_accum_net = 0.014985 + 0.009990 = 0.024975
      // reference_price = 1272.54 / 0.024975 = 50961.9615...

      const result = calculator.calculateReferencePrice(purchases);
      expect(result).toBeCloseTo(50961.9615, 4);
    });

    it("should correctly include fee_base converted to USDT in cost accumulator", () => {
      // Verify that BTC fees are converted at fill_price and added to cost
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0,
        fee_btc: 0.0001, // 0.01% in BTC
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // BTC fee in USDT = 0.0001 * 50000 = 5 USDT
      // cost_accum_usdt = 500 + 0 + 5 = 505
      // btc_accum_net = 0.01 - 0.0001 = 0.0099
      // reference_price = 505 / 0.0099 = 51010.101...
      expect(result).toBeCloseTo(51010.101, 3);
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

      const result = calculator.calculateReferencePrice([purchase]);

      // btc_accum_net should be 0.01 - 0.001 = 0.009
      expect(calculator.getNetBTCAccumulated()).toBe(0.009);

      // cost_accum_usdt = 500 + 0 + 0.001 * 50000 = 500 + 50 = 550
      // reference_price = 550 / 0.009 = 61111.111...
      expect(result).toBeCloseTo(61111.111, 3);
    });
  });
});
