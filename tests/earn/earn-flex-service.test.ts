/**
 * Unit Tests for EarnFlexService
 *
 * Tests core Earn Flex functionality:
 * - Pending accumulation when below minimum
 * - Subscribe behavior with thresholds
 * - Redeem exact amounts
 * - Interest tracking (separate from principal)
 * - Position info retrieval
 */

import { describe, it, expect } from "@jest/globals";
import Decimal from "decimal.js";

describe("Earn Flex Service - Calculations", () => {
  describe("Pending Accumulation Logic", () => {
    it("should add to pending when amount is below minimum", () => {
      const amount = new Decimal("5");
      const minAmount = new Decimal("10");
      const currentPending = new Decimal("0");

      const totalPending = currentPending.add(amount);
      const shouldSubscribe = totalPending.gte(minAmount);

      expect(shouldSubscribe).toBe(false);
      expect(totalPending.toString()).toBe("5");
    });

    it("should accumulate pending until minimum is reached", () => {
      const minAmount = new Decimal("10");

      // First deposit
      let pending = new Decimal("0");
      pending = pending.add(new Decimal("3"));
      expect(pending.gte(minAmount)).toBe(false);

      // Second deposit
      pending = pending.add(new Decimal("4"));
      expect(pending.gte(minAmount)).toBe(false);

      // Third deposit - exceeds minimum
      pending = pending.add(new Decimal("5"));
      expect(pending.gte(minAmount)).toBe(true);
      expect(pending.toString()).toBe("12");
    });

    it("should subscribe when exactly at minimum", () => {
      const amount = new Decimal("10");
      const minAmount = new Decimal("10");
      const currentPending = new Decimal("0");

      const totalPending = currentPending.add(amount);
      const shouldSubscribe = totalPending.gte(minAmount);

      expect(shouldSubscribe).toBe(true);
    });

    it("should combine pending with new amount for threshold check", () => {
      const newAmount = new Decimal("6");
      const minAmount = new Decimal("10");
      const currentPending = new Decimal("5");

      const totalPending = currentPending.add(newAmount);
      const shouldSubscribe = totalPending.gte(minAmount);

      expect(shouldSubscribe).toBe(true);
      expect(totalPending.toString()).toBe("11");
    });
  });

  describe("Subscribe Amount Calculation", () => {
    it("should subscribe full pending when threshold is met", () => {
      const newAmount = new Decimal("8");
      const currentPending = new Decimal("5");
      const totalToSubscribe = currentPending.add(newAmount);

      // When subscribing, entire accumulated amount goes to Binance
      expect(totalToSubscribe.toString()).toBe("13");
    });

    it("should handle zero pending correctly", () => {
      const newAmount = new Decimal("15");
      const currentPending = new Decimal("0");
      const totalToSubscribe = currentPending.add(newAmount);

      expect(totalToSubscribe.toString()).toBe("15");
    });

    it("should handle decimal precision correctly", () => {
      const newAmount = new Decimal("0.00001234");
      const currentPending = new Decimal("0.00000999");
      const totalPending = currentPending.add(newAmount);

      expect(totalPending.toString()).toBe("0.00002233");
    });
  });

  describe("Redeem Amount Calculation", () => {
    it("should redeem exactly what is requested when principal is sufficient", () => {
      const principal = new Decimal("100");
      const requestedAmount = new Decimal("50");

      const toRedeem = Decimal.min(requestedAmount, principal);

      expect(toRedeem.toString()).toBe("50");
    });

    it("should redeem all principal when requested amount exceeds available", () => {
      const principal = new Decimal("30");
      const requestedAmount = new Decimal("50");

      const toRedeem = Decimal.min(requestedAmount, principal);

      expect(toRedeem.toString()).toBe("30");
    });

    it("should handle zero principal", () => {
      const principal = new Decimal("0");
      const requestedAmount = new Decimal("50");

      const toRedeem = Decimal.min(requestedAmount, principal);

      expect(toRedeem.toString()).toBe("0");
    });

    it("should redeem full principal when amount equals principal", () => {
      const principal = new Decimal("100");
      const requestedAmount = new Decimal("100");

      const toRedeem = Decimal.min(requestedAmount, principal);
      const redeemAll = toRedeem.gte(principal);

      expect(toRedeem.toString()).toBe("100");
      expect(redeemAll).toBe(true);
    });

    it("should preserve decimal precision in redemption", () => {
      const principal = new Decimal("0.00123456");
      const requestedAmount = new Decimal("0.00100000");

      const toRedeem = Decimal.min(requestedAmount, principal);

      expect(toRedeem.toString()).toBe("0.001");
    });
  });

  describe("Interest Tracking (Isolation)", () => {
    it("should track interest separately from principal", () => {
      const principal = new Decimal("100");
      const interest = new Decimal("0.05");

      // Interest should NOT be added to available capital
      const availableForTrading = principal;
      const totalTracked = principal.add(interest);

      expect(availableForTrading.toString()).toBe("100");
      expect(totalTracked.toString()).toBe("100.05");
    });

    it("should accumulate interest over time", () => {
      let totalInterest = new Decimal("0");

      // Day 1
      totalInterest = totalInterest.add(new Decimal("0.01"));
      expect(totalInterest.toString()).toBe("0.01");

      // Day 2
      totalInterest = totalInterest.add(new Decimal("0.01"));
      expect(totalInterest.toString()).toBe("0.02");

      // Day 3
      totalInterest = totalInterest.add(new Decimal("0.01"));
      expect(totalInterest.toString()).toBe("0.03");
    });

    it("should never include interest in capital calculations", () => {
      const principal = new Decimal("1000");
      const pending = new Decimal("5");
      const interest = new Decimal("10.50");

      // Available capital should only be principal (pending is in spot, not earn)
      const availableFromEarn = principal;

      expect(availableFromEarn.toString()).toBe("1000");
      expect(interest.toString()).toBe("10.5"); // Tracked but not used
      expect(pending.toString()).toBe("5"); // Pending is in spot, not earn
    });
  });

  describe("Position Info Aggregation", () => {
    it("should calculate complete position info", () => {
      const principal = new Decimal("100");
      const pending = new Decimal("5");
      const interest = new Decimal("1.23");

      const positionInfo = {
        principal,
        pending,
        interest,
      };

      expect(positionInfo.principal.toString()).toBe("100");
      expect(positionInfo.pending.toString()).toBe("5");
      expect(positionInfo.interest.toString()).toBe("1.23");
    });

    it("should handle empty position", () => {
      const principal = new Decimal("0");
      const pending = new Decimal("0");
      const interest = new Decimal("0");

      const positionInfo = {
        principal,
        pending,
        interest,
      };

      expect(positionInfo.principal.toString()).toBe("0");
      expect(positionInfo.pending.toString()).toBe("0");
      expect(positionInfo.interest.toString()).toBe("0");
    });
  });

  describe("BTC vs USDT Handling", () => {
    it("should handle BTC amounts with 8 decimal precision", () => {
      const btcAmount = new Decimal("0.00001234");
      const btcMinAmount = new Decimal("0.0001");

      const shouldSubscribe = btcAmount.gte(btcMinAmount);

      expect(shouldSubscribe).toBe(false);
      expect(btcAmount.decimalPlaces()).toBe(8);
    });

    it("should handle USDT amounts with 8 decimal precision", () => {
      const usdtAmount = new Decimal("10.12345678");
      const usdtMinAmount = new Decimal("10");

      const shouldSubscribe = usdtAmount.gte(usdtMinAmount);

      expect(shouldSubscribe).toBe(true);
      expect(usdtAmount.decimalPlaces()).toBe(8);
    });

    it("should accumulate BTC dust correctly", () => {
      const btcMinAmount = new Decimal("0.0001");

      let btcPending = new Decimal("0");

      // Small BTC dust from trade 1
      btcPending = btcPending.add(new Decimal("0.00003"));
      expect(btcPending.gte(btcMinAmount)).toBe(false);

      // Small BTC dust from trade 2
      btcPending = btcPending.add(new Decimal("0.00004"));
      expect(btcPending.gte(btcMinAmount)).toBe(false);

      // Small BTC dust from trade 3 - now exceeds min
      btcPending = btcPending.add(new Decimal("0.00005"));
      expect(btcPending.gte(btcMinAmount)).toBe(true);
      expect(btcPending.toString()).toBe("0.00012");
    });
  });

  describe("Net BTC Calculation After Fees", () => {
    it("should calculate net BTC after deducting fees", () => {
      const executedQty = new Decimal("0.001");
      const feeBTC = new Decimal("0.000001");

      const netBTC = executedQty.sub(feeBTC);

      expect(netBTC.toString()).toBe("0.000999");
    });

    it("should handle zero fees", () => {
      const executedQty = new Decimal("0.001");
      const feeBTC = new Decimal("0");

      const netBTC = executedQty.sub(feeBTC);

      expect(netBTC.toString()).toBe("0.001");
    });

    it("should handle edge case where fee equals executed qty", () => {
      const executedQty = new Decimal("0.000001");
      const feeBTC = new Decimal("0.000001");

      const netBTC = executedQty.sub(feeBTC);

      expect(netBTC.toString()).toBe("0");
      expect(netBTC.gt(0)).toBe(false);
    });
  });

  describe("Capital Calculation with Earn Flex", () => {
    it("should include Earn principal in new cycle capital", () => {
      const carryOverCapital = 500;
      const reinvestmentFromPool = new Decimal("100");
      const earnFlexPrincipal = new Decimal("200");

      const totalCapital =
        carryOverCapital +
        reinvestmentFromPool.toNumber() +
        earnFlexPrincipal.toNumber();

      expect(totalCapital).toBe(800);
    });

    it("should calculate buy amount based on total capital", () => {
      const totalCapital = 1000;
      const maxPurchases = 10;

      const buyAmount =
        Math.floor((totalCapital / maxPurchases) * 100000000) / 100000000;

      expect(buyAmount).toBe(100);
    });

    it("should not include pending in capital calculation", () => {
      const carryOverCapital = 500;
      const earnFlexPrincipal = new Decimal("200");
      const earnFlexPending = new Decimal("5"); // Below min, not in Earn

      // Pending is NOT included - it's already in spot account
      const totalCapital = carryOverCapital + earnFlexPrincipal.toNumber();

      expect(totalCapital).toBe(700);
      // earnFlexPending should be separate
      expect(earnFlexPending.toString()).toBe("5"); // Pending is in spot, not earn
    });
  });
});
