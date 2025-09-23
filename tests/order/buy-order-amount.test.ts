import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Decimal } from "decimal.js";
import { BuyOrderPlacer } from "../../src/order/buy-order-placer";
import { TradingRules } from "../../src/exchange/trading-rules";
import type { BinanceClient } from "../../src/exchange/binance-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SymbolTradingRules } from "../../src/exchange/types";
import type { BinanceOrder, CreateOrderParams } from "../../src/exchange/types";

type MockBinanceClient = {
  createOrder: jest.Mock<(params: CreateOrderParams) => Promise<BinanceOrder>>;
  getOrder: jest.Mock;
  getMyTrades: jest.Mock;
};

type MockTradingRules = {
  getRules: jest.Mock;
  roundQuantityToStep: jest.Mock;
  roundQuantityForBuyOrder: jest.Mock;
  roundPriceToTick: jest.Mock;
};

describe("Buy Order Amount Issues", () => {
  let buyOrderPlacer: BuyOrderPlacer;
  let mockBinanceClient: MockBinanceClient;
  let mockTradingRules: MockTradingRules;
  let mockSupabaseClient: SupabaseClient;

  const mockSymbolRules: SymbolTradingRules = {
    symbol: "BTCUSDT",
    minQty: 0.00001,
    maxQty: 9000.0,
    stepSize: 0.00001,
    minPrice: 0.01,
    maxPrice: 1000000,
    tickSize: 0.01,
    minNotional: 10.0,
    lastUpdated: Date.now(),
  };

  beforeEach(() => {
    mockBinanceClient = {
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      getMyTrades: jest.fn(),
    };

    mockTradingRules = {
      getRules: jest.fn(() => Promise.resolve(mockSymbolRules)),
      roundQuantityToStep: jest.fn((qty: unknown) => {
        const stepSize = 0.00001;
        const quantity = qty as number;
        return Math.floor(quantity / stepSize) * stepSize;
      }),
      roundQuantityForBuyOrder: jest.fn((qty: unknown) => {
        // Just round down to step size for now
        const stepSize = 0.00001;
        const quantity = qty as number;
        return Math.floor(quantity / stepSize) * stepSize;
      }),
      roundPriceToTick: jest.fn((price: unknown) => {
        const tickSize = 0.01;
        const priceNum = price as number;
        return Math.round(priceNum / tickSize) * tickSize;
      }),
    };

    const mockQueryBuilder = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(() =>
        Promise.resolve({ data: { id: "test-id" }, error: null }),
      ),
    };

    mockSupabaseClient = {
      from: jest.fn().mockReturnValue(mockQueryBuilder),
    } as unknown as SupabaseClient;

    buyOrderPlacer = new BuyOrderPlacer(
      mockBinanceClient as unknown as BinanceClient,
      mockTradingRules as unknown as TradingRules,
      mockSupabaseClient,
      "BTCUSDT",
    );
  });

  describe("Bug: Bot spends less than target amount", () => {
    it("should demonstrate the issue from Discord notification", async () => {
      // From Discord: Bot wanted to spend $30 but only spent $27.82
      const targetSpend = new Decimal(30);
      const currentPrice = new Decimal(115912.49);
      const slippage = 0.003; // 0.3% default

      const orderParams = await buyOrderPlacer.prepareOrder(
        targetSpend,
        currentPrice,
        slippage,
      );

      // Calculate what actually gets spent
      const actualSpendAtMarket = orderParams.quantity.mul(currentPrice);

      console.log("Target spend: $" + targetSpend.toString());
      console.log("Limit price: $" + orderParams.limitPrice.toString());
      console.log("Quantity: " + orderParams.quantity.toString() + " BTC");
      console.log("Actual spend at market: $" + actualSpendAtMarket.toString());
      console.log(
        "Lost amount: $" + targetSpend.sub(actualSpendAtMarket).toString(),
      );

      // With the fix: We now use current price to calculate quantity
      // So we get closer to the target spend (still slightly less due to rounding)
      expect(actualSpendAtMarket.toNumber()).toBeLessThan(
        targetSpend.toNumber(),
      );
      expect(actualSpendAtMarket.toNumber()).toBeCloseTo(28.98, 1); // Much closer to $30 target
    });

    it("should calculate loss from using limit price for quantity calculation", async () => {
      const targetSpend = new Decimal(30);
      const currentPrice = new Decimal(100000); // Round number for easy calculation
      const slippage = 0.01; // 1% for clearer example

      const orderParams = await buyOrderPlacer.prepareOrder(
        targetSpend,
        currentPrice,
        slippage,
      );

      // With 1% slippage, limit price is $101,000
      expect(orderParams.limitPrice.toNumber()).toBe(101000);

      // Quantity is calculated as $30 / $101,000 = 0.000297...
      // Rounded down to 0.00029 BTC
      expect(orderParams.quantity.toNumber()).toBe(0.00029);

      // At market price, we only spend 0.00029 * $100,000 = $29
      const actualSpend = orderParams.quantity.mul(currentPrice);
      expect(actualSpend.toNumber()).toBe(29);

      // We lost $1 (3.33% of target)
      const lostAmount = targetSpend.sub(actualSpend);
      expect(lostAmount.toNumber()).toBe(1);
    });

    it("should show cumulative loss over multiple purchases", async () => {
      const buyAmount = new Decimal(30);
      const prices = [100000, 110000, 120000, 130000, 140000]; // 5 purchases
      const slippage = 0.003;
      let totalLost = new Decimal(0);

      for (const price of prices) {
        const currentPrice = new Decimal(price);
        const orderParams = await buyOrderPlacer.prepareOrder(
          buyAmount,
          currentPrice,
          slippage,
        );

        const actualSpend = orderParams.quantity.mul(currentPrice);
        const lost = buyAmount.sub(actualSpend);
        totalLost = totalLost.add(lost);

        console.log(`Price: $${price}, Lost: $${lost.toFixed(2)}`);
      }

      console.log(`Total lost over 5 purchases: $${totalLost.toFixed(2)}`);

      // We're losing money on every purchase
      expect(totalLost.toNumber()).toBeGreaterThan(0);
    });

    it("should show how much BTC we miss out on", async () => {
      const targetSpend = new Decimal(300); // Full initial capital
      const currentPrice = new Decimal(100000);
      const slippage = 0.003;

      // Current implementation
      const orderParams = await buyOrderPlacer.prepareOrder(
        targetSpend,
        currentPrice,
        slippage,
      );

      // Ideal implementation (using market price for calculation)
      const idealQuantity = targetSpend.div(currentPrice);
      const idealRounded =
        Math.floor(idealQuantity.toNumber() / 0.00001) * 0.00001;

      const btcMissed = idealRounded - orderParams.quantity.toNumber();
      const btcMissedPercent = (btcMissed / idealRounded) * 100;

      console.log(
        "Current implementation: " + orderParams.quantity.toString() + " BTC",
      );
      console.log("Ideal implementation: " + idealRounded + " BTC");
      console.log("BTC missed: " + btcMissed.toFixed(8) + " BTC");
      console.log("Percentage missed: " + btcMissedPercent.toFixed(2) + "%");

      // With the fix, we should get the ideal rounded quantity
      expect(orderParams.quantity.toNumber()).toBe(idealRounded);
    });
  });

  describe("Proposed fix: Use market price for quantity calculation", () => {
    it("should spend closer to target amount with proposed fix", async () => {
      const targetSpend = new Decimal(30);
      const currentPrice = new Decimal(115912.49);

      // Proposed fix: Calculate quantity based on current price, not limit price
      const quantity = targetSpend.div(currentPrice); // Use current price
      const roundedQty = Math.floor(quantity.toNumber() / 0.00001) * 0.00001;

      const actualSpend = roundedQty * currentPrice.toNumber();

      console.log("Proposed fix:");
      console.log("Target: $" + targetSpend.toString());
      console.log("Quantity: " + roundedQty + " BTC");
      console.log("Actual spend: $" + actualSpend.toFixed(2));
      console.log("Lost: $" + (30 - actualSpend).toFixed(2));

      // Should be closer to $30 (within 5% is acceptable due to rounding)
      expect(actualSpend).toBeGreaterThan(28.5); // At least 95% of target
      expect(actualSpend).toBeLessThanOrEqual(30);
    });
  });
});
