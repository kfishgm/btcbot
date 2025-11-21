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

      // Per spec Section 3: When commissionAsset = BASE, cost = cummQuote (no BTC fee added)
      // cost_accum_usdt = 500 + 0 = 500
      // btc_accum_net = 0.01 - 0.00001 = 0.00999
      // reference_price = 500 / 0.00999 = 50050.0500...
      expect(result).toBeCloseTo(50050.05, 2);
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

      // Per spec Section 3: cost = usdt_spent + fee_usdt (no BTC fee added)
      // cost_accum_usdt = 500 + 0.25 = 500.25
      // btc_accum_net = 0.01 - 0.00001 = 0.00999
      // reference_price = 500.25 / 0.00999 = 50075.075...
      expect(result).toBeCloseTo(50075.075, 3);
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

      // Per spec Section 3: cost = usdt_spent + fee_usdt (no BTC fee conversion)
      // Purchase 1: cost = 500 + 0.5 = 500.5, btc_net = 0.01
      // Purchase 2: cost = 510 + 0 = 510, btc_net = 0.01 - 0.00001 = 0.00999
      // Purchase 3: cost = 520 + 0.26 = 520.26, btc_net = 0.01 - 0.000005 = 0.009995
      // Total: cost_accum_usdt = 500.5 + 510 + 520.26 = 1530.76
      // Total: btc_accum_net = 0.01 + 0.00999 + 0.009995 = 0.029985
      // reference_price = 1530.76 / 0.029985 = 51050.8588...
      expect(result).toBeCloseTo(51050.859, 1);
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

      // Calculate expected per spec Section 3: cost = usdt_spent + fee_usdt
      let totalCost = 0;
      let totalBtc = 0;
      purchases.forEach((p) => {
        totalCost += p.usdt_spent + p.fee_usdt; // No BTC fee conversion
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
      expect(result).toBeCloseTo(50050, 8);
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

      // Per spec: cost = usdt_spent + fee_usdt (no BTC fee conversion)
      // cost_accum_usdt = 5000000 + 5000 = 5005000
      // btc_accum_net = 100 - 0.1 = 99.9
      // reference_price = 5005000 / 99.9 = 50100.10010...
      expect(result).toBeCloseTo(50100.1001, 4);
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

      // Each purchase per spec: cost = usdt_spent + fee_usdt
      // cost = 6.172505 + 0.00617251 = 6.17867751
      // btc_net = 0.00012345 - 0.00000012 = 0.00012333
      // Total for 100 purchases:
      // total_cost = 6.17867751 * 100 = 617.867751
      // total_btc = 0.00012333 * 100 = 0.012333
      // reference_price = 617.867751 / 0.012333 = 50098.739...
      expect(result).toBeCloseTo(50098.74, 1);
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

      // Per spec: cost = usdt_spent + fee_usdt
      // cost_accum_usdt = (500 + 0.5) + (1020 + 1.02) = 500.5 + 1021.02 = 1521.52
      expect(calculator.getTotalCostUSDT()).toBeCloseTo(1521.52, 2);

      // btc_accum_net = (0.01 - 0.00001) + (0.02 - 0.00002) = 0.00999 + 0.01998 = 0.02997
      expect(calculator.getNetBTCAccumulated()).toBeCloseTo(0.02997, 8);
    });
  });

  describe("Spec Section 3: Buy Fill Normalization (Commission Handling)", () => {
    it("should handle commissionAsset = BASE (BTC fee only)", () => {
      // Spec Section 3: When commissionAsset = BASE
      // base_net = executedQty - commission
      // cost_quote = cummQuote (NO fee added to cost)
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500, // cummQuote
        fee_usdt: 0, // No USDT fee
        fee_btc: 0.00001, // BTC fee charged
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // cost = 500 + 0 = 500 (BTC fee NOT added)
      // btc_net = 0.01 - 0.00001 = 0.00999
      // SRP = 500 / 0.00999 = 50050.05...
      expect(result).toBeCloseTo(50050.05, 2);
    });

    it("should handle commissionAsset = QUOTE (USDT fee only)", () => {
      // Spec Section 3: When commissionAsset = QUOTE
      // base_net = executedQty (no BTC deduction)
      // cost_quote = cummQuote + commission (USDT fee ADDED to cost)
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500, // cummQuote
        fee_usdt: 0.5, // USDT fee charged
        fee_btc: 0, // No BTC fee
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // cost = 500 + 0.5 = 500.5 (USDT fee added)
      // btc_net = 0.01 - 0 = 0.01
      // SRP = 500.5 / 0.01 = 50050
      expect(result).toBe(50050);
    });

    it("should handle commissionAsset = other (BNB, no fee impact)", () => {
      // Spec Section 3: When commissionAsset = other (e.g., BNB)
      // base_net = executedQty (no BTC deduction)
      // cost_quote = cummQuote (no USDT fee added)
      // Note: BNB fees are tracked separately but don't affect SRP calculation
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500, // cummQuote
        fee_usdt: 0, // No USDT fee
        fee_btc: 0, // No BTC fee
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // cost = 500 + 0 = 500
      // btc_net = 0.01 - 0 = 0.01
      // SRP = 500 / 0.01 = 50000
      expect(result).toBe(50000);
    });

    it("should correctly handle mixed commission assets across multiple purchases", () => {
      // Real-world scenario: Different purchases may have different commission assets
      const purchases = [
        {
          // Purchase 1: BTC fee
          btc_filled: 0.01,
          usdt_spent: 500,
          fee_usdt: 0,
          fee_btc: 0.00001,
          fill_price: 50000,
        },
        {
          // Purchase 2: USDT fee
          btc_filled: 0.02,
          usdt_spent: 1020,
          fee_usdt: 1.02,
          fee_btc: 0,
          fill_price: 51000,
        },
        {
          // Purchase 3: BNB fee (no impact)
          btc_filled: 0.015,
          usdt_spent: 780,
          fee_usdt: 0,
          fee_btc: 0,
          fill_price: 52000,
        },
      ];

      const result = calculator.calculateReferencePrice(purchases);

      // Purchase 1: cost = 500, btc_net = 0.00999
      // Purchase 2: cost = 1020 + 1.02 = 1021.02, btc_net = 0.02
      // Purchase 3: cost = 780, btc_net = 0.015
      // Total: cost = 500 + 1021.02 + 780 = 2301.02
      // Total: btc_net = 0.00999 + 0.02 + 0.015 = 0.04499
      // SRP = 2301.02 / 0.04499 = 51145.143...
      expect(result).toBeCloseTo(51145.14, 1);
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

      // Manual calculation per spec Section 3: cost = usdt_spent + fee_usdt
      // Purchase 1:
      // cost_accum_usdt = 750 + 0.75 = 750.75
      // btc_accum_net = 0.015 - 0.000015 = 0.014985

      // Purchase 2:
      // cost_accum_usdt = 520 + 0.52 = 520.52
      // btc_accum_net = 0.010 - 0.000010 = 0.009990

      // Totals:
      // total_cost_accum_usdt = 750.75 + 520.52 = 1271.27
      // total_btc_accum_net = 0.014985 + 0.009990 = 0.024975
      // reference_price = 1271.27 / 0.024975 = 50901.70...

      const result = calculator.calculateReferencePrice(purchases);
      expect(result).toBeCloseTo(50901.7, 1);
    });

    it("should NOT convert BTC fees to USDT in cost (spec Section 3)", () => {
      // Per spec Section 3: When commissionAsset = BASE, cost = cummQuote only
      // BTC fees reduce net BTC but are NOT added to cost
      const purchase = {
        btc_filled: 0.01,
        usdt_spent: 500,
        fee_usdt: 0,
        fee_btc: 0.0001, // 1% in BTC
        fill_price: 50000,
      };

      const result = calculator.calculateReferencePrice([purchase]);

      // Per spec: cost = usdt_spent + fee_usdt = 500 + 0 = 500
      // btc_accum_net = 0.01 - 0.0001 = 0.0099
      // reference_price = 500 / 0.0099 = 50505.05...
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

      // Per spec: cost = usdt_spent + fee_usdt = 500 + 0 = 500
      // reference_price = 500 / 0.009 = 55555.5556...
      expect(result).toBeCloseTo(55555.556, 2);
    });
  });
});
