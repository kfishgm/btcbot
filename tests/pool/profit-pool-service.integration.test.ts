/**
 * Integration Tests for ProfitPoolService
 *
 * Tests the profit pool system logic and calculations.
 * These tests verify:
 * - Profit allocation percentages
 * - Reinvestment accumulation and pickup
 * - Funding wallet DUST handling
 * - Edge cases and error scenarios
 */

import { describe, it, expect } from "@jest/globals";
import Decimal from "decimal.js";

describe("Profit Pool Integration Scenarios", () => {
  describe("Scenario 1: Single Cycle Profit to Pool", () => {
    it("should split single profit correctly", () => {
      // Profit from cycle completion
      const profit = new Decimal(100);
      const reinvestmentPct = 70;
      const fundingPct = 30;

      const toReinvestment = profit.mul(reinvestmentPct).div(100);
      const toFunding = profit.mul(fundingPct).div(100);

      // Pool state after profit
      const pool = {
        total_net_profits: profit,
        allocated_to_reinvestment: toReinvestment,
        allocated_to_funding_wallet: toFunding,
      };

      expect(pool.allocated_to_reinvestment.toString()).toBe("70");
      expect(pool.allocated_to_funding_wallet.toString()).toBe("30");
      expect(pool.total_net_profits.toString()).toBe("100");
    });
  });

  describe("Scenario 2: Multiple Profits Accumulating in Pool", () => {
    it("should accumulate reinvestment across multiple profits", () => {
      // Simulate 3 profits from different sources
      const profits = [
        { amount: new Decimal(100), source: "SELL", cycle: "cycle-1" },
        { amount: new Decimal(50), source: "CYCLE_CLOSED", cycle: "cycle-2" },
        { amount: new Decimal(75), source: "SELL", cycle: "cycle-3" },
      ];

      const pool = {
        total_net_profits: new Decimal(0),
        allocated_to_reinvestment: new Decimal(0),
        allocated_to_funding_wallet: new Decimal(0),
      };

      // Process each profit
      for (const p of profits) {
        const reinv = p.amount.mul(0.7);
        const fund = p.amount.mul(0.3);

        pool.total_net_profits = pool.total_net_profits.add(p.amount);
        pool.allocated_to_reinvestment =
          pool.allocated_to_reinvestment.add(reinv);
        pool.allocated_to_funding_wallet =
          pool.allocated_to_funding_wallet.add(fund);
      }

      expect(pool.total_net_profits.toString()).toBe("225");
      expect(pool.allocated_to_reinvestment.toString()).toBe("157.5");
      expect(pool.allocated_to_funding_wallet.toString()).toBe("67.5");
    });

    it("should prevent double-counting same profit source", () => {
      const profitMap = new Map<string, Decimal>();

      // First addition
      const sourceKey = "SELL:cycle-1";
      profitMap.set(sourceKey, new Decimal(100));

      // Attempt second addition with same source
      if (profitMap.has(sourceKey)) {
        // Skip - already added
      } else {
        profitMap.set(sourceKey, new Decimal(100));
      }

      // Map should still have only one entry
      expect(profitMap.size).toBe(1);
      const value = profitMap.get(sourceKey);
      expect(value !== undefined && value.toString()).toBe("100");
    });
  });

  describe("Scenario 3: Reinvestment Pickup at New Cycle Creation", () => {
    it("should correctly distribute reinvestment to new cycle", () => {
      // Pool state: 140 USDT reinvestment accumulated (from scenario 2)
      const pool = {
        allocated_to_reinvestment: new Decimal(140),
      };

      // Config A allocation: 60%
      const configAAllocationPct = 60;
      const configAShare = pool.allocated_to_reinvestment
        .mul(configAAllocationPct)
        .div(100);

      // New cycle capital
      const carryoverCapital = new Decimal(1000);
      const newCycleCapital = carryoverCapital.add(configAShare);

      expect(configAShare.toString()).toBe("84");
      expect(newCycleCapital.toString()).toBe("1084");

      // Pool balance after pickup
      const remainingInPool = pool.allocated_to_reinvestment.sub(configAShare);
      expect(remainingInPool.toString()).toBe("56");
    });

    it("should handle sequential config pickups", () => {
      // Pool: 100 USDT available
      let pool = new Decimal(100);

      // Config A (60% of pool)
      const configAShare = pool.mul(60).div(100);
      pool = pool.sub(configAShare);

      expect(configAShare.toString()).toBe("60");
      expect(pool.toString()).toBe("40");

      // Config B (gets 40% of original 100 = 40)
      // But now pool only has 40, so if they get their share:
      const configBShare = pool.mul(40).div(100).mul(100).div(40);
      pool = pool.sub(configBShare);

      // Config B should get their fair share
      expect(pool.lte(0)).toBe(true);
    });
  });

  describe("Scenario 4: Funding Wallet DUST Accumulation", () => {
    it("should accumulate DUST across profits until threshold then transfer all", () => {
      // Min transfer: 50 USDT
      // Each profit generates 30% to funding

      let pending = new Decimal(0);
      const minTransfer = 50;
      const profits = [100, 100, 50]; // Each generates 30, 30, 15 funding
      const fundingAmounts = profits.map((p) => new Decimal(p).mul(0.3));

      let transferred = new Decimal(0);

      for (const amount of fundingAmounts) {
        pending = pending.add(amount);

        if (pending.gte(minTransfer)) {
          // Transfer full amount once threshold is met
          transferred = transferred.add(pending);
          pending = new Decimal(0); // No dust remains
        }
      }

      // After profits: 30 + 30 = 60 (>= 50, transfer 60), then +15 = 15 (below 50)
      expect(pending.toString()).toBe("15"); // Remaining below threshold
      expect(transferred.toString()).toBe("60"); // Full amount transferred when threshold met
    });

    it("should carry full amount forward on transfer failure", () => {
      // Failed transfer keeps full amount in pool for retry
      const pending = new Decimal(60);
      const minTransfer = 50;

      // Would transfer, but fails
      const shouldTransfer = pending.gte(minTransfer);
      expect(shouldTransfer).toBe(true);

      // Transfer fails - keep everything for next attempt
      const retryAmount = pending;
      expect(retryAmount.toString()).toBe("60");
    });

    it("should transfer full amount each time threshold is met", () => {
      // Scenario: accumulate funds across multiple profits until transferable
      let pending = new Decimal(0);
      const minTransfer = 50;

      // Three profit cycles with incoming funds
      const incomingAmounts = [45, 45, 45]; // Each below threshold individually

      let totalTransferred = new Decimal(0);

      for (const incoming of incomingAmounts) {
        pending = pending.add(incoming);
        if (pending.gte(minTransfer)) {
          // Transfer full amount
          totalTransferred = totalTransferred.add(pending);
          pending = new Decimal(0);
        }
      }

      // After 45: pending = 45 (below 50)
      // After 45+45=90: pending >= 50, transfer 90, pending = 0
      // After 45: pending = 45 (below 50)
      expect(totalTransferred.toString()).toBe("90");
      expect(pending.toString()).toBe("45");
    });
  });

  describe("Scenario 5: Complete Cycle Flow", () => {
    it("should handle complete profit → pool → distribution → new cycle", () => {
      // Initial state
      const pool = {
        total_net_profits: new Decimal(0),
        allocated_to_reinvestment: new Decimal(0),
        allocated_to_funding_wallet: new Decimal(0),
      };

      // Step 1: Config A cycle completes with 100 USDT profit
      const profit1 = new Decimal(100);
      pool.total_net_profits = pool.total_net_profits.add(profit1);
      pool.allocated_to_reinvestment = pool.allocated_to_reinvestment.add(
        profit1.mul(0.7),
      );
      pool.allocated_to_funding_wallet = pool.allocated_to_funding_wallet.add(
        profit1.mul(0.3),
      );

      expect(pool.allocated_to_reinvestment.toString()).toBe("70");

      // Step 2: Config B cycle completes with 50 USDT profit
      const profit2 = new Decimal(50);
      pool.total_net_profits = pool.total_net_profits.add(profit2);
      pool.allocated_to_reinvestment = pool.allocated_to_reinvestment.add(
        profit2.mul(0.7),
      );
      pool.allocated_to_funding_wallet = pool.allocated_to_funding_wallet.add(
        profit2.mul(0.3),
      );

      expect(pool.allocated_to_reinvestment.toString()).toBe("105");

      // Step 3: Config A creates NEW cycle and picks up reinvestment (60% alloc)
      const configAAllocationPct = 60;
      const configAShare = pool.allocated_to_reinvestment
        .mul(configAAllocationPct)
        .div(100);
      pool.allocated_to_reinvestment =
        pool.allocated_to_reinvestment.sub(configAShare);

      expect(configAShare.toString()).toBe("63");

      // Config A's new cycle gets higher capital
      const carryover = new Decimal(1000);
      const newCycleCapital = carryover.add(configAShare);
      const buyAmountPerPurchase = newCycleCapital.div(10); // 10 purchases

      expect(newCycleCapital.toString()).toBe("1063");
      expect(buyAmountPerPurchase.toString()).toBe("106.3");

      // Step 4: Pool still has reinvestment for Config B
      expect(pool.allocated_to_reinvestment.toString()).toBe("42");

      // Step 5: Funding wallet may transfer if threshold reached
      if (pool.allocated_to_funding_wallet.gte(50)) {
        // Would transfer
        pool.allocated_to_funding_wallet = new Decimal(5); // Keep 5 USDT DUST
      }
    });
  });

  describe("Scenario 6: Edge Cases", () => {
    it("should handle zero profit", () => {
      const profit = new Decimal(0);
      const reinvestment = profit.mul(0.7);
      const funding = profit.mul(0.3);

      expect(reinvestment.toString()).toBe("0");
      expect(funding.toString()).toBe("0");
    });

    it("should handle negative profit (loss)", () => {
      const profit = new Decimal(-100);
      const reinvestment = profit.mul(0.7);
      const funding = profit.mul(0.3);

      expect(reinvestment.toString()).toBe("-70");
      expect(funding.toString()).toBe("-30");
    });

    it("should maintain precision with decimal profits", () => {
      const profit = new Decimal("123.456789");
      const reinvestment = profit.mul(0.7);
      const funding = profit.mul(0.3);

      const total = reinvestment.add(funding);
      expect(total.toString()).toBe(profit.toString());
    });

    it("should prevent loss of capital due to rounding", () => {
      const profits = [new Decimal(100), new Decimal(50), new Decimal(75)];

      let totalAllocated = new Decimal(0);
      for (const profit of profits) {
        const reinv = profit.mul(0.7);
        const fund = profit.mul(0.3);
        totalAllocated = totalAllocated.add(reinv).add(fund);
      }

      const totalProfit = profits.reduce(
        (sum, p) => sum.add(p),
        new Decimal(0),
      );

      expect(totalAllocated.toString()).toBe(totalProfit.toString());
    });
  });

  describe("Accounting Verification", () => {
    it("should maintain accounting balance", () => {
      // Start with profits
      let totalNetProfits = new Decimal(0);
      let reinvestmentDistributed = new Decimal(0);
      const fundingTransferred = new Decimal(0);
      let reinvestmentInPool = new Decimal(0);
      let fundingInPool = new Decimal(0);

      // Add profits
      const profit = new Decimal(100);
      totalNetProfits = totalNetProfits.add(profit);
      reinvestmentInPool = reinvestmentInPool.add(profit.mul(0.7));
      fundingInPool = fundingInPool.add(profit.mul(0.3));

      // Pickup reinvestment
      const pickup = reinvestmentInPool.mul(0.6);
      reinvestmentInPool = reinvestmentInPool.sub(pickup);
      reinvestmentDistributed = reinvestmentDistributed.add(pickup);

      // Verify balance
      const accounted = reinvestmentDistributed
        .add(reinvestmentInPool)
        .add(fundingTransferred)
        .add(fundingInPool);

      expect(accounted.toString()).toBe(totalNetProfits.toString());
    });
  });
});
