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
  cycle_id?: string;
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

export interface ProfitData {
  btcSold: Decimal;
  usdtReceived: Decimal;
  principal: Decimal;
  profit: Decimal;
  netUsdtReceived: Decimal;
}

interface BinanceOrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId?: number;
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

export class SellOrderPlacer extends EventEmitter {
  private binanceClient: BinanceClient;
  private tradingRules: TradingRules;
  private symbol: string;
  private retryCount = 3;
  private retryDelay = 1000;
  private tradingRulesCache: SymbolTradingRules | null = null;
  private cycleId: string | null = null;

  constructor(
    binanceClient: BinanceClient,
    tradingRules: TradingRules,
    _supabaseClient: unknown,
    symbol: string,
  ) {
    super();
    this.binanceClient = binanceClient;
    this.tradingRules = tradingRules;
    this.symbol = symbol;
  }

  setCycleId(cycleId: string): void {
    this.cycleId = cycleId;
  }

  async prepareOrder(
    btcToSell: Decimal,
    currentPrice: Decimal,
    slippageGuardPct: number,
  ): Promise<OrderPrepareParams> {
    // Validate inputs
    if (btcToSell.lte(0)) {
      throw new Error("BTC amount to sell must be greater than 0");
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

    // Calculate limit price with slippage guard (price can go DOWN for sells)
    const rawLimitPrice = currentPrice.mul(1 - slippageGuardPct).toNumber();

    // Check if price is too low to apply slippage
    if (rawLimitPrice <= 0) {
      throw new Error("Price too low to apply slippage guard");
    }

    const limitPriceNumber = this.tradingRules.roundPriceToTick(
      rawLimitPrice,
      this.symbol,
    );
    const limitPrice = new Decimal(limitPriceNumber);

    // Round quantity to step size
    const quantityNumber = this.tradingRules.roundQuantityToStep(
      btcToSell.toNumber(),
      this.symbol,
    );

    // Check if quantity rounds to 0
    if (quantityNumber === 0) {
      throw new Error("BTC amount too small after rounding to step size");
    }

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
    btcToSell: Decimal,
    currentPrice: Decimal,
    referencePrice: Decimal,
    slippageGuardPct: number = 0.003,
  ): Promise<OrderResult> {
    // Prepare order
    const orderParams = await this.prepareOrder(
      btcToSell,
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
          side: "SELL" as OrderSide,
          type: "LIMIT" as OrderType,
          timeInForce: "IOC" as TimeInForce,
          quantity: Number(orderParams.quantity.toString()),
          price: Number(orderParams.limitPrice.toString()),
          newClientOrderId: orderParams.clientOrderId,
        });

        const executionTime = Date.now() - startTime;
        this.emit("orderExecuted", { order, executionTime });

        // Process order result
        const result = await this.processOrderResult(
          order as BinanceOrderWithFills,
        );

        // Save to database
        await this.saveTradeRecord(result);

        // Calculate and emit profit if fully sold
        if (result.executedQty.gt(0)) {
          const profitData = this.calculateProfit(
            result.executedQty,
            result.cummulativeQuoteQty,
            result.feeUSDT,
            result.feeBTC,
            referencePrice,
            result.avgPrice,
          );
          this.emit("profitCalculated", profitData);
        }

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

  calculateProfit(
    btcSold: Decimal,
    usdtReceived: Decimal,
    feeUSDT: Decimal,
    feeBTC: Decimal,
    referencePrice: Decimal,
    avgPrice: Decimal,
  ): ProfitData {
    // Calculate principal (what we paid for the BTC)
    const principal = referencePrice.mul(btcSold);

    // Net USDT received after fees
    const netUsdtReceived = usdtReceived.sub(feeUSDT);

    // Account for BTC fees by converting to USDT at the sale price
    const btcFeeInUSDT = feeBTC.mul(avgPrice);
    const totalNetReceived = netUsdtReceived.sub(btcFeeInUSDT);

    // Profit can never be negative (per STRATEGY.md)
    const profit = Decimal.max(0, totalNetReceived.sub(principal));

    return {
      btcSold,
      usdtReceived,
      principal,
      profit,
      netUsdtReceived: totalNetReceived,
    };
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
      tradeStatus = "PARTIAL";
    }

    // Determine primary fee
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

    // Prepare trade record
    const baseTradeRecord = {
      type: "SELL" as const,
      order_id: result.orderId.toString(),
      status: tradeStatus,
      price: result.avgPrice.toNumber(),
      quantity: result.executedQty.toNumber(),
      quote_quantity: result.cummulativeQuoteQty.toNumber(),
      fee_asset: feeAsset,
      fee_amount: feeAmount,
      executed_at: new Date(),
    };

    try {
      // Save to database if we have a cycle_id
      if (this.cycleId) {
        const dbRecord = {
          ...baseTradeRecord,
          cycle_id: this.cycleId,
        };

        // Emit event since DB types aren't generated
        this.emit("tradeRecordReady", dbRecord);
      } else {
        // Emit event for external systems
        this.emit("tradeRecordReady", baseTradeRecord);
      }
    } catch (error) {
      // Log error
      this.emit("databaseError", { error, tradeRecord: baseTradeRecord });
      throw error;
    }
  }

  private generateClientOrderId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `SELL_${timestamp}_${random}`;
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
    if (errorCode === "-1001" || errorCode === "-1000") {
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getOrderStatus(clientOrderId: string): Promise<BinanceOrder> {
    return this.binanceClient.getOrder(this.symbol, undefined, clientOrderId);
  }

  getStateUpdateData(result: OrderResult): {
    btcSold: Decimal;
    usdtReceived: Decimal;
    netUsdtReceived: Decimal;
    avgPrice: Decimal;
  } {
    // USDT received after USDT fees
    const netUsdtReceived = result.cummulativeQuoteQty.sub(result.feeUSDT);

    return {
      btcSold: result.executedQty,
      usdtReceived: result.cummulativeQuoteQty,
      netUsdtReceived,
      avgPrice: result.avgPrice,
    };
  }
}
