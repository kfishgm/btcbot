import { BinanceClient } from "../exchange/binance-client";
import { TradingRules } from "../exchange/trading-rules";
import {
  OrderSide,
  OrderType,
  TimeInForce,
  BinanceOrder,
  OrderStatus,
  SymbolTradingRules,
} from "../exchange/types";
import { Decimal } from "decimal.js";
import { EventEmitter } from "events";
import { logger } from "../utils/logger";
import { SupabaseClient } from "@supabase/supabase-js";

export interface OrderPrepareParams {
  symbol: string;
  quantity: Decimal;
  limitPrice: Decimal;
  clientOrderId: string;
}

export interface OrderResult {
  orderId: number;
  clientOrderId: string;
  status: OrderStatus;
  executedQty: Decimal;
  cummulativeQuoteQty: Decimal;
  avgPrice: Decimal;
  fills: OrderFill[];
  feeBTC: Decimal;
  feeUSDT: Decimal;
  feeOther: Record<string, Decimal>;
}

export interface OrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId?: number;
}

export interface TradeRecord {
  cycle_id?: string; // Will be set by caller
  type: "BUY" | "SELL";
  order_id: string;
  status: "FILLED" | "PARTIAL" | "CANCELLED";
  price: number;
  quantity: number;
  quote_quantity: number;
  fee_asset?: string;
  fee_amount?: number;
  executed_at: Date;
}

interface BinanceOrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId?: number;
}

interface BinanceTrade {
  id: number;
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
}

interface BinanceOrderWithFills {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime?: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: OrderStatus;
  timeInForce: TimeInForce;
  type: OrderType;
  side: OrderSide;
  fills?: BinanceOrderFill[];
}

interface ErrorWithCode extends Error {
  code?: string;
}

export class BuyOrderPlacer extends EventEmitter {
  private binanceClient: BinanceClient;
  private tradingRules: TradingRules;
  private supabaseClient: SupabaseClient;
  private symbol: string;
  private retryCount = 3;
  private retryDelay = 1000; // Start with 1 second
  private tradingRulesCache: SymbolTradingRules | null = null; // Cache trading rules
  private cycleId: string | null = null; // Cycle ID for database saves

  constructor(
    binanceClient: BinanceClient,
    tradingRules: TradingRules,
    supabaseClient: SupabaseClient,
    symbol: string,
  ) {
    super();
    this.binanceClient = binanceClient;
    this.tradingRules = tradingRules;
    this.supabaseClient = supabaseClient;
    this.symbol = symbol;
  }

  // Set the cycle ID for database operations
  setCycleId(cycleId: string): void {
    this.cycleId = cycleId;
  }

  async prepareOrder(
    buyAmount: Decimal,
    currentPrice: Decimal,
    slippageGuardPct: number,
  ): Promise<OrderPrepareParams> {
    // Validate inputs
    if (buyAmount.lte(0)) {
      throw new Error("Buy amount must be greater than 0");
    }
    if (currentPrice.lte(0)) {
      throw new Error("Current price must be greater than 0");
    }
    if (slippageGuardPct < 0 || slippageGuardPct > 0.1) {
      throw new Error("Slippage guard percentage must be between 0 and 0.1");
    }

    // Ensure we have trading rules
    if (!this.tradingRulesCache) {
      this.tradingRulesCache = await this.tradingRules.getRules(this.symbol);
    }

    // Calculate limit price with slippage guard
    const rawLimitPrice = currentPrice.mul(1 + slippageGuardPct).toNumber();
    const limitPriceNumber = this.tradingRules.roundPriceToTick(
      rawLimitPrice,
      this.symbol,
    );
    const limitPrice = new Decimal(limitPriceNumber);

    // Calculate quantity
    const rawQuantity = buyAmount.div(limitPrice).toNumber();
    const quantityNumber = this.tradingRules.roundQuantityToStep(
      rawQuantity,
      this.symbol,
    );
    const quantity = new Decimal(quantityNumber);

    // Generate unique client order ID
    const clientOrderId = this.generateClientOrderId();

    return {
      symbol: this.symbol,
      quantity,
      limitPrice,
      clientOrderId,
    };
  }

  async validateOrder(params: OrderPrepareParams): Promise<void> {
    // Ensure we have trading rules
    if (!this.tradingRulesCache) {
      this.tradingRulesCache = await this.tradingRules.getRules(this.symbol);
    }

    const rules = this.tradingRulesCache;
    const minQty = new Decimal(rules.minQty);
    const maxQty = new Decimal(rules.maxQty);
    const minNotional = new Decimal(rules.minNotional);

    // Check quantity constraints
    if (params.quantity.lt(minQty)) {
      throw new Error(
        `Order quantity ${params.quantity.toString()} is below minimum ${minQty.toString()}`,
      );
    }

    if (params.quantity.gt(maxQty)) {
      throw new Error(
        `Order quantity ${params.quantity.toString()} exceeds maximum ${maxQty.toString()}`,
      );
    }

    // Check notional value
    const notional = params.quantity.mul(params.limitPrice);
    if (notional.lt(minNotional)) {
      throw new Error(
        `Order notional value ${notional.toString()} is below minimum ${minNotional.toString()}`,
      );
    }
  }

  async placeOrder(
    buyAmount: Decimal,
    currentPrice: Decimal,
    slippageGuardPct: number = 0.003,
  ): Promise<OrderResult> {
    // Prepare order
    const orderParams = await this.prepareOrder(
      buyAmount,
      currentPrice,
      slippageGuardPct,
    );

    // Validate order
    await this.validateOrder(orderParams);

    // Emit order placement event
    this.emit("orderPlacing", orderParams);

    // Place order with retry logic
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.retryCount) {
      try {
        const startTime = Date.now();

        // Submit order to Binance
        const order = await this.binanceClient.createOrder({
          symbol: this.symbol,
          side: "BUY" as OrderSide,
          type: "LIMIT" as OrderType,
          timeInForce: "IOC" as TimeInForce,
          quantity: Number(orderParams.quantity.toString()),
          price: Number(orderParams.limitPrice.toString()),
          newClientOrderId: orderParams.clientOrderId,
        });

        const executionTime = Date.now() - startTime;
        this.emit("orderExecuted", { order, executionTime });

        // Verify order is complete and get final state
        const finalOrder = await this.verifyOrderComplete(
          order.orderId,
          order.clientOrderId,
        );

        // Validate the response from Binance
        this.validateBinanceResponse(finalOrder as BinanceOrderWithFills);

        // Process order result with verified data
        const result = await this.processOrderResult(
          finalOrder as BinanceOrderWithFills,
        );

        // Save to database
        await this.saveTradeRecord(result);

        // Emit completion event
        this.emit("orderCompleted", result);

        return result;
      } catch (error: unknown) {
        lastError = error as Error;

        // Check if error is retryable
        if (this.isRetryableError(error)) {
          attempt++;
          if (attempt < this.retryCount) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            this.emit("orderRetry", { attempt, delay, error });
            await this.sleep(delay);
            continue;
          }
        }

        // Non-retryable error or max retries reached
        this.emit("orderFailed", { error, orderParams });
        throw error;
      }
    }

    // Max retries reached
    throw lastError || new Error("Max retries reached");
  }

  private async processOrderResult(
    order: BinanceOrderWithFills,
  ): Promise<OrderResult> {
    const executedQty = new Decimal(order.executedQty || "0");
    const cummulativeQuoteQty = new Decimal(order.cummulativeQuoteQty || "0");

    // Calculate average price
    const avgPrice = executedQty.gt(0)
      ? cummulativeQuoteQty.div(executedQty)
      : new Decimal(0);

    // Process fills and calculate fees
    const fills: OrderFill[] = (order.fills || []).map(
      (fill: BinanceOrderFill) => ({
        price: fill.price,
        qty: fill.qty,
        commission: fill.commission,
        commissionAsset: fill.commissionAsset,
        tradeId: fill.tradeId,
      }),
    );

    // Calculate fees by currency
    let feeBTC = new Decimal(0);
    let feeUSDT = new Decimal(0);
    const feeOther: Record<string, Decimal> = {};

    for (const fill of fills) {
      const commission = new Decimal(fill.commission);

      if (fill.commissionAsset === "BTC") {
        feeBTC = feeBTC.add(commission);
      } else if (fill.commissionAsset === "USDT") {
        feeUSDT = feeUSDT.add(commission);
      } else {
        if (!feeOther[fill.commissionAsset]) {
          feeOther[fill.commissionAsset] = new Decimal(0);
        }
        feeOther[fill.commissionAsset] =
          feeOther[fill.commissionAsset].add(commission);
      }
    }

    // Check if fees were paid in BNB (Binance Coin)
    const bnbFee = feeOther["BNB"] || new Decimal(0);
    if (!bnbFee.isZero()) {
      // When fees are paid in BNB, we need to impute the BTC fee
      // BNB gives 25% discount, so actual fee would be 0.075% instead of 0.1%
      const bnbFeeRate = new Decimal(0.00075); // 0.075%
      const imputedBTCFee = executedQty.mul(bnbFeeRate);

      logger.info("📊 Fees paid in BNB, imputing BTC fee for reference price", {
        bnbFee: bnbFee.toString(),
        imputedBTCFee: imputedBTCFee.toString(),
        explanation: "BNB fee gives 25% discount, imputing 0.075% BTC fee",
      });

      // Use the imputed fee for reference price calculation
      feeBTC = imputedBTCFee;
    }

    // CRITICAL: Fallback fee calculation if no fees from Binance
    // This ensures we always account for fees in reference price
    if (
      fills.length === 0 ||
      (feeBTC.isZero() &&
        feeUSDT.isZero() &&
        Object.keys(feeOther).length === 0)
    ) {
      // Default Binance fee is 0.1% (0.001)
      const defaultFeeRate = new Decimal(0.001);

      // For BUY orders, fee is typically in BTC
      feeBTC = executedQty.mul(defaultFeeRate);

      logger.warn("⚠️ No fee data from Binance, using fallback calculation", {
        executedQty: executedQty.toString(),
        calculatedFeeBTC: feeBTC.toString(),
        feeRate: "0.1%",
        reason: "Fills array empty or no commission data",
      });
    }

    // Final fee validation
    if (feeBTC.isZero() && feeUSDT.isZero()) {
      logger.error("🚨 CRITICAL: No fees captured or calculated!", {
        executedQty: executedQty.toString(),
        fills: fills.length,
        feeOther: Object.keys(feeOther),
      });

      // Force a minimum fee to ensure reference price accounts for costs
      const emergencyFeeRate = new Decimal(0.001);
      feeBTC = executedQty.mul(emergencyFeeRate);

      logger.warn("Applied emergency fee calculation", {
        feeBTC: feeBTC.toString(),
      });
    }

    // Perform consistency checks if we have fill data
    if (fills.length > 0) {
      this.performConsistencyChecks(
        order,
        avgPrice,
        executedQty,
        cummulativeQuoteQty,
        fills,
      );
    }

    return {
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      status: order.status,
      executedQty,
      cummulativeQuoteQty,
      avgPrice,
      fills,
      feeBTC,
      feeUSDT,
      feeOther,
    };
  }

  private performConsistencyChecks(
    order: BinanceOrderWithFills,
    calculatedAvgPrice: Decimal,
    executedQty: Decimal,
    cummulativeQuoteQty: Decimal,
    fills: OrderFill[],
  ): void {
    try {
      // Check 1: Verify sum of fill quantities matches executedQty
      const totalFillQty = fills.reduce(
        (sum, fill) => sum.add(new Decimal(fill.qty)),
        new Decimal(0),
      );

      const qtyDiff = executedQty.sub(totalFillQty).abs();
      if (qtyDiff.gt(0.00000001)) {
        logger.warn("Fill quantity mismatch", {
          orderId: order.orderId,
          executedQty: executedQty.toString(),
          sumOfFills: totalFillQty.toString(),
          difference: qtyDiff.toString(),
        });
      }

      // Check 2: Verify weighted average price calculation
      let weightedSum = new Decimal(0);
      let totalQty = new Decimal(0);

      for (const fill of fills) {
        const fillQty = new Decimal(fill.qty);
        const fillPrice = new Decimal(fill.price);
        weightedSum = weightedSum.add(fillQty.mul(fillPrice));
        totalQty = totalQty.add(fillQty);
      }

      if (totalQty.gt(0)) {
        const fillBasedAvgPrice = weightedSum.div(totalQty);
        const priceDiff = calculatedAvgPrice.sub(fillBasedAvgPrice).abs();

        // Allow small difference due to rounding
        if (priceDiff.gt(0.01)) {
          logger.warn("Average price calculation mismatch", {
            orderId: order.orderId,
            calculatedAvgPrice: calculatedAvgPrice.toString(),
            fillBasedAvgPrice: fillBasedAvgPrice.toString(),
            difference: priceDiff.toString(),
          });
        }
      }

      // Check 3: Verify cumulative quote quantity
      const calculatedQuoteQty = weightedSum;
      const quoteDiff = cummulativeQuoteQty.sub(calculatedQuoteQty).abs();

      // Allow small difference due to rounding (0.01 USDT)
      if (quoteDiff.gt(0.01)) {
        logger.warn("Cumulative quote quantity mismatch", {
          orderId: order.orderId,
          binanceQuoteQty: cummulativeQuoteQty.toString(),
          calculatedQuoteQty: calculatedQuoteQty.toString(),
          difference: quoteDiff.toString(),
        });
      }

      logger.debug("Consistency checks passed", {
        orderId: order.orderId,
        fillCount: fills.length,
      });
    } catch (error) {
      logger.warn("Error during consistency checks", {
        orderId: order.orderId,
        error,
      });
    }
  }

  private async saveTradeRecord(result: OrderResult): Promise<void> {
    // Determine trade status
    let tradeStatus: "FILLED" | "PARTIAL" | "CANCELLED";
    if (result.status === "FILLED") {
      tradeStatus = "FILLED";
    } else if (
      result.status === "PARTIALLY_FILLED" ||
      result.status === "EXPIRED"
    ) {
      tradeStatus = "PARTIAL";
    } else if (result.status === "CANCELED" || result.status === "REJECTED") {
      tradeStatus = "CANCELLED";
    } else {
      tradeStatus = "PARTIAL"; // Default for other statuses
    }

    // Build complete fee details object
    const feeDetails: Record<string, number> = {};
    if (result.feeBTC.gt(0)) {
      feeDetails.BTC = result.feeBTC.toNumber();
    }
    if (result.feeUSDT.gt(0)) {
      feeDetails.USDT = result.feeUSDT.toNumber();
    }
    // Add any other fees
    for (const [asset, amount] of Object.entries(result.feeOther)) {
      feeDetails[asset] = amount.toNumber();
    }

    // Determine primary fee for backward compatibility
    let feeAsset: string | undefined;
    let feeAmount: number | undefined;
    if (result.feeBTC.gt(0)) {
      feeAsset = "BTC";
      feeAmount = result.feeBTC.toNumber();
    } else if (result.feeUSDT.gt(0)) {
      feeAsset = "USDT";
      feeAmount = result.feeUSDT.toNumber();
    } else if (Object.keys(result.feeOther).length > 0) {
      const firstFee = Object.entries(result.feeOther)[0];
      if (firstFee) {
        feeAsset = firstFee[0];
        feeAmount = firstFee[1].toNumber();
      }
    }

    // Prepare trade record with all required fields
    const baseTradeRecord = {
      type: "BUY" as const,
      order_id: result.orderId.toString(),
      status: tradeStatus,
      price: result.avgPrice.toNumber(),
      quantity: result.executedQty.toNumber(),
      quote_quantity: result.cummulativeQuoteQty.toNumber(),
      fee_asset: feeAsset,
      fee_amount: feeAmount,
      fee_details: Object.keys(feeDetails).length > 0 ? feeDetails : null,
      executed_at: new Date(),
    };

    try {
      // Save to database if we have a cycle_id
      if (this.cycleId) {
        // Create record with cycle_id for database
        const dbRecord = {
          ...baseTradeRecord,
          cycle_id: this.cycleId,
        };

        // Save trade to database and get the ID for fills
        const { data: tradeData, error } = await this.supabaseClient
          .from("trades")
          .insert(dbRecord)
          .select("id")
          .single();

        if (error) {
          // Log error but don't throw - we don't want to fail the entire order
          logger.error("Failed to save trade record to database", {
            error: error.message,
            tradeRecord: dbRecord,
          });
        } else {
          logger.info("Trade record saved to database", {
            orderId: result.orderId,
            type: "BUY",
            quantity: result.executedQty.toNumber(),
            price: result.avgPrice.toNumber(),
            feeDetails,
          });

          // Save individual fills if we have them and got a trade ID
          if (tradeData?.id && result.fills.length > 0) {
            await this.saveTradeFills(tradeData.id, result.fills);
          }
        }

        // Always emit event for external systems
        this.emit("tradeRecordReady", dbRecord);
      } else {
        // Emit event for external systems to handle if no cycle_id
        this.emit("tradeRecordReady", baseTradeRecord);
      }
    } catch (error) {
      // Log error
      this.emit("databaseError", { error, tradeRecord: baseTradeRecord });
      // Re-throw to handle in the calling function
      throw error;
    }
  }

  private async saveTradeFills(
    tradeId: string,
    fills: OrderFill[],
  ): Promise<void> {
    try {
      const fillRecords = fills.map((fill, index) => ({
        trade_id: tradeId,
        fill_index: index,
        price: parseFloat(fill.price),
        quantity: parseFloat(fill.qty),
        commission: parseFloat(fill.commission),
        commission_asset: fill.commissionAsset,
        binance_trade_id: fill.tradeId || null,
      }));

      const { error } = await this.supabaseClient
        .from("trade_fills")
        .insert(fillRecords);

      if (error) {
        logger.warn("Failed to save trade fills", {
          error: error.message,
          tradeId,
          fillCount: fills.length,
        });
      } else {
        logger.debug("Trade fills saved", {
          tradeId,
          fillCount: fills.length,
        });
      }
    } catch (error) {
      logger.warn("Error saving trade fills", {
        error,
        tradeId,
      });
    }
  }

  private generateClientOrderId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `BUY_${timestamp}_${random}`;
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as ErrorWithCode).code;

    // Network errors
    if (
      errorMessage.includes("network") ||
      errorMessage.includes("timeout") ||
      errorMessage.includes("econnrefused")
    ) {
      return true;
    }

    // Rate limiting
    if (
      errorCode === "RATE_LIMIT" ||
      errorMessage.includes("rate limit") ||
      errorCode === "-1003"
    ) {
      return true;
    }

    // Temporary Binance issues
    if (
      errorCode === "-1001" || // Internal error
      errorCode === "-1000"
    ) {
      // Unknown error
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Verify order is complete and get final state with fills
  private async verifyOrderComplete(
    orderId: number,
    clientOrderId: string,
  ): Promise<BinanceOrderWithFills> {
    // Brief wait for fills to settle (especially for IOC orders)
    await this.sleep(500);

    try {
      // First get the order status
      const finalOrder = await this.binanceClient.getOrder(
        this.symbol,
        orderId,
      );

      // Now get the trades (fills) for this order to get fee information
      // The trades endpoint provides commission details
      const trades = await this.binanceClient.getMyTrades(this.symbol, orderId);

      // Convert trades to fills format
      const fills: BinanceOrderFill[] = trades.map((trade: BinanceTrade) => ({
        price: trade.price,
        qty: trade.qty,
        commission: trade.commission,
        commissionAsset: trade.commissionAsset,
        tradeId: trade.id,
      }));

      logger.info("Order verification complete with fills", {
        orderId,
        status: finalOrder.status,
        executedQty: finalOrder.executedQty,
        fillCount: fills.length,
        totalCommission: fills.reduce((sum, fill) => {
          if (fill.commissionAsset === "BTC") {
            return sum + parseFloat(fill.commission);
          }
          return sum;
        }, 0),
      });

      // Combine order data with fills
      return {
        ...finalOrder,
        fills,
      } as BinanceOrderWithFills;
    } catch (error) {
      logger.error("Failed to verify order with fills", {
        orderId,
        clientOrderId,
        error,
      });

      // If we can't get trades, at least return the order
      // and we'll use fallback fee calculation
      const order = await this.binanceClient.getOrder(this.symbol, orderId);

      return {
        ...order,
        fills: [], // Empty fills will trigger fallback fee calculation
      } as BinanceOrderWithFills;
    }
  }

  // Validate Binance response has all required fields
  private validateBinanceResponse(order: BinanceOrderWithFills): void {
    // Check critical fields exist
    if (order.executedQty === undefined || order.executedQty === null) {
      throw new Error("Missing executedQty in Binance response");
    }

    if (
      order.cummulativeQuoteQty === undefined ||
      order.cummulativeQuoteQty === null
    ) {
      throw new Error("Missing cummulativeQuoteQty in Binance response");
    }

    if (!order.status) {
      throw new Error("Missing order status in Binance response");
    }

    if (!order.orderId) {
      throw new Error("Missing orderId in Binance response");
    }

    // Validate numeric values are valid
    const executedQty = new Decimal(order.executedQty);
    const cummulativeQuoteQty = new Decimal(order.cummulativeQuoteQty);

    if (executedQty.isNaN() || executedQty.lt(0)) {
      throw new Error(`Invalid executedQty: ${order.executedQty}`);
    }

    if (cummulativeQuoteQty.isNaN() || cummulativeQuoteQty.lt(0)) {
      throw new Error(
        `Invalid cummulativeQuoteQty: ${order.cummulativeQuoteQty}`,
      );
    }

    // Log warning if fills are missing (not critical but good to know)
    if (!order.fills || order.fills.length === 0) {
      logger.warn("No fills data in Binance response", {
        orderId: order.orderId,
        status: order.status,
      });
    }
  }

  // Method to get the last order status
  async getOrderStatus(clientOrderId: string): Promise<BinanceOrder> {
    return this.binanceClient.getOrder(this.symbol, undefined, clientOrderId);
  }

  // Get state update data for the cycle state manager
  getStateUpdateData(result: OrderResult): {
    btcReceived: Decimal;
    totalCostUSDT: Decimal;
    netBTCReceived: Decimal;
    avgPrice: Decimal;
  } {
    // Net BTC received after fees
    const netBTCReceived = result.executedQty.sub(result.feeBTC);

    // Total cost including USDT fees
    const totalCostUSDT = result.cummulativeQuoteQty.add(result.feeUSDT);

    return {
      btcReceived: result.executedQty,
      totalCostUSDT,
      netBTCReceived,
      avgPrice: result.avgPrice,
    };
  }
}
