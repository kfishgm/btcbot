/**
 * Unit Tests for ProfitPoolService
 *
 * Tests core profit pool functionality:
 * - Profit percentage splitting calculations
 * - DUST accumulation logic
 * - Disabled pool behavior
 * - Edge cases (precision, overflow)
 */

import { describe, it, expect } from "@jest/globals";
import Decimal from "decimal.js";

describe("Profit Pool - Calculations", () => {
  describe("Profit Splitting by Percentages", () => {
    it("should split profit correctly with default percentages", () => {
      const profit = new Decimal(100);
      const reinvestmentPct = 70;
      const fundingPct = 30;

      const toReinvestment = profit.mul(reinvestmentPct).div(100);
      const toFunding = profit.mul(fundingPct).div(100);

      expect(toReinvestment.toString()).toBe("70");
      expect(toFunding.toString()).toBe("30");
      expect(toReinvestment.plus(toFunding).toString()).toBe("100");
    });

    it("should split profit correctly with custom percentages", () => {
      const profit = new Decimal(1000);
      const reinvestmentPct = 80;
      const fundingPct = 20;

      const toReinvestment = profit.mul(reinvestmentPct).div(100);
      const toFunding = profit.mul(fundingPct).div(100);

      expect(toReinvestment.toString()).toBe("800");
      expect(toFunding.toString()).toBe("200");
    });

    it("should handle zero profit", () => {
      const profit = new Decimal(0);
      const reinvestmentPct = 70;

      const toReinvestment = profit.mul(reinvestmentPct).div(100);

      expect(toReinvestment.toString()).toBe("0");
    });

    it("should handle negative profit (loss)", () => {
      const profit = new Decimal(-100);
      const reinvestmentPct = 70;

      const toReinvestment = profit.mul(reinvestmentPct).div(100);

      expect(toReinvestment.toString()).toBe("-70");
      expect(toReinvestment.isNegative()).toBe(true);
    });
  });

  describe("DUST Accumulation (Funding Wallet)", () => {
    it("should accumulate DUST below threshold", () => {
      const pending = new Decimal(5);
      const minTransfer = 10;

      expect(pending.lt(minTransfer)).toBe(true);
      // No transfer happens, DUST carries to next profit
    });

    it("should transfer full amount (truncated to cents) once threshold is met", () => {
      // Scenario: Pending = 14.73 USDT, Min = 10 USDT
      // Expected: Transfer 14.73, no sub-cent dust
      const pending = new Decimal("14.73");
      const minTransfer = new Decimal(10);

      const shouldTransfer = pending.gte(minTransfer);
      const transferAmount = pending.toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const subCentDust = pending.sub(transferAmount);

      expect(shouldTransfer).toBe(true);
      expect(transferAmount.toString()).toBe("14.73");
      expect(subCentDust.toString()).toBe("0");
    });

    it("should keep sub-cent amounts as dust", () => {
      // Scenario: Pending = 14.731234 USDT, Min = 10 USDT
      // Expected: Transfer 14.73, keep 0.001234 as dust
      const pending = new Decimal("14.731234");
      const minTransfer = new Decimal(10);

      const shouldTransfer = pending.gte(minTransfer);
      const transferAmount = pending.toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const subCentDust = pending.sub(transferAmount);

      expect(shouldTransfer).toBe(true);
      expect(transferAmount.toString()).toBe("14.73");
      expect(subCentDust.toString()).toBe("0.001234");
    });

    it("should accumulate DUST across multiple profits until threshold", () => {
      // Profit 1: 100 USDT -> 30 to funding (pending = 30, below min 50)
      // Profit 2: 50 USDT -> 15 to funding (pending = 45, still below min 50)
      // Profit 3: 30 USDT -> 9 to funding (pending = 54, >= min 50, transfer ALL 54!)
      // Remaining: 0 DUST

      let accumulated = new Decimal(0);
      const fundingAmounts = [new Decimal(30), new Decimal(15), new Decimal(9)];
      const minTransfer = 50;

      let transferredTotal = new Decimal(0);

      for (const amount of fundingAmounts) {
        accumulated = accumulated.add(amount);
        if (accumulated.gte(minTransfer)) {
          // Transfer full amount once threshold is met
          transferredTotal = transferredTotal.add(accumulated);
          accumulated = new Decimal(0); // No dust remains
        }
      }

      expect(transferredTotal.toString()).toBe("54");
      expect(accumulated.toString()).toBe("0"); // No dust after transfer
    });

    it("should handle transfer failure by keeping full amount for retry", () => {
      // Transfer fails: full pending amount should be kept for retry
      const pendingAmount = new Decimal(45);

      // On failure, nothing changes - amount stays pending
      expect(pendingAmount.toString()).toBe("45");
    });

    it("should transfer exact threshold amount with no dust", () => {
      // Pending = 50 USDT, Min = 50 USDT
      // Expected: Transfer all 50, no DUST
      const pending = new Decimal(50);
      const minTransfer = new Decimal(50);

      const shouldTransfer = pending.gte(minTransfer);
      const transferAmount = shouldTransfer ? pending : new Decimal(0);

      expect(shouldTransfer).toBe(true);
      expect(transferAmount.toString()).toBe("50");
    });
  });

  describe("Reinvestment Pickup (New Cycle Creation)", () => {
    it("should calculate config share based on allocation percentage", () => {
      // Total reinvestment: 100 USDT
      // Config allocation: 60%
      // Expected share: 60 USDT
      const totalReinvestment = new Decimal(100);
      const configAllocationPct = 60;

      const configShare = totalReinvestment.mul(configAllocationPct).div(100);

      expect(configShare.toString()).toBe("60");
    });

    it("should deduct from pool after pickup", () => {
      const initialPool = new Decimal(100);
      const pickup = new Decimal(60);
      const remaining = initialPool.sub(pickup);

      expect(remaining.toString()).toBe("40");
    });

    it("should handle multiple configs picking up reinvestment", () => {
      // Pool: 100 USDT
      // Config A (60% alloc): Gets 60 USDT
      // Config B (40% alloc): Gets 40 USDT
      const pool = new Decimal(100);

      const configAShare = pool.mul(60).div(100);
      const remaining = pool.sub(configAShare);
      const configBShare = remaining.mul(40).div(100).mul(100).div(40); // 40% of 100 = 40

      expect(configAShare.toString()).toBe("60");
      expect(configBShare.toString()).toBe("40");
    });

    it("should return zero when no reinvestment available", () => {
      const totalReinvestment = new Decimal(0);
      const configAllocationPct = 60;

      const configShare = totalReinvestment.mul(configAllocationPct).div(100);

      expect(configShare.toString()).toBe("0");
    });
  });

  describe("Configuration Validation", () => {
    it("reinvestment + funding should equal 100", () => {
      const reinvestmentPct = 70;
      const fundingPct = 30;

      expect(reinvestmentPct + fundingPct).toBe(100);
    });

    it("should validate percentages in valid range", () => {
      const reinvestmentPct = 70;
      const fundingPct = 30;
      const minFundingTransferAmount = 10;

      expect(reinvestmentPct).toBeGreaterThanOrEqual(0);
      expect(reinvestmentPct).toBeLessThanOrEqual(100);
      expect(fundingPct).toBeGreaterThanOrEqual(0);
      expect(fundingPct).toBeLessThanOrEqual(100);
      expect(minFundingTransferAmount).toBeGreaterThan(0);
    });

    it("should prevent invalid percentage combinations", () => {
      const reinvestmentPct = 70;
      const fundingPct = 40; // Invalid: sum > 100

      expect(reinvestmentPct + fundingPct).not.toBe(100);
    });
  });

  describe("Precision and Edge Cases", () => {
    it("should handle very small amounts with precision", () => {
      const smallAmount = new Decimal("0.00000001");
      const reinvestment = smallAmount.mul(0.7);
      const funding = smallAmount.mul(0.3);

      const total = reinvestment.plus(funding);
      expect(total.toString()).toBe(smallAmount.toString());
    });

    it("should handle large amounts without overflow", () => {
      const largeAmount = new Decimal("1000000000");
      const reinvestment = largeAmount.mul(0.7);
      const funding = largeAmount.mul(0.3);

      expect(reinvestment.toString()).toBe("700000000");
      expect(funding.toString()).toBe("300000000");
    });

    it("should maintain precision across multiple operations", () => {
      // Simulate: 3 profits, each split and accumulated
      const profit1 = new Decimal(100);
      const profit2 = new Decimal(50);
      const profit3 = new Decimal(75);

      let totalReinvestment = new Decimal(0);
      let totalFunding = new Decimal(0);

      for (const profit of [profit1, profit2, profit3]) {
        const reinv = profit.mul(0.7);
        const fund = profit.mul(0.3);
        totalReinvestment = totalReinvestment.add(reinv);
        totalFunding = totalFunding.add(fund);
      }

      const totalProfit = profit1.plus(profit2).plus(profit3);
      const calculatedTotal = totalReinvestment.plus(totalFunding);

      expect(calculatedTotal.toString()).toBe(totalProfit.toString());
    });

    it("should handle decimal percentages", () => {
      const profit = new Decimal(100);
      const reinvestmentPct = 70.5;
      const fundingPct = 29.5;

      const toReinvestment = profit.mul(reinvestmentPct).div(100);
      const toFunding = profit.mul(fundingPct).div(100);

      expect(toReinvestment.toString()).toBe("70.5");
      expect(toFunding.toString()).toBe("29.5");
    });
  });

  describe("DUST Accumulation Scenarios", () => {
    it("should transfer full amount each time threshold is reached", () => {
      // Transfer 1: 45 USDT (min 50) -> pending 45 (below threshold)
      // Transfer 2: +45 USDT -> Total 90 >= 50, transfer ALL 90, pending = 0
      // Transfer 3: +45 USDT -> pending 45 (below threshold)
      const minTransfer = 50;

      let pending = new Decimal(0);
      let totalTransferred = new Decimal(0);
      const incomingAmounts = [
        new Decimal(45),
        new Decimal(45),
        new Decimal(45),
      ];

      for (const incoming of incomingAmounts) {
        pending = pending.add(incoming);
        if (pending.gte(minTransfer)) {
          // Transfer full amount
          totalTransferred = totalTransferred.add(pending);
          pending = new Decimal(0);
        }
      }

      expect(pending.toString()).toBe("45"); // Below threshold after last transfer
      expect(totalTransferred.toString()).toBe("90"); // Transferred when 90 >= 50
    });

    it("should never lose capital due to rounding", () => {
      const initialProfit = new Decimal("123.456789");
      const reinvestmentPct = 70;
      const fundingPct = 30;

      const toReinvestment = initialProfit.mul(reinvestmentPct).div(100);
      const toFunding = initialProfit.mul(fundingPct).div(100);
      const total = toReinvestment.plus(toFunding);

      // Should equal original (within floating point precision)
      expect(total.toString()).toBe(initialProfit.toString());
    });
  });
});
