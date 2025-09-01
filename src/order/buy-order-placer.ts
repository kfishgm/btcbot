import { BinanceClient } from "../exchange/binance-client";
import { TradingRules } from "../exchange/trading-rules";
import { SupabaseClient, getSupabaseClient } from "../database/supabase";
import {
  OrderSide,
  OrderType,
  TimeInForce,
  BinanceOrder,
  OrderStatus,
  SymbolTradingRules,
} from "../exchange/types";
import { Decimal } from "decimal.js";
import { v4 as uuidv4 } from "uuid";
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
  symbol: string;
  side: OrderSide;
  order_id: number;
  client_order_id: string;
  quantity: string;
  price: string;
  executed_qty: string;
  cumulative_quote_qty: string;
  status: OrderStatus;
  fee_btc: string;
  fee_usdt: string;
  fee_other: Record<string, string>;
  fills: OrderFill[];
  timestamp: Date;
}

interface BinanceOrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId?: number;
}

interface BinanceOrderWithFills extends BinanceOrder {
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

  constructor(
    binanceClient: BinanceClient,
    tradingRules: TradingRules,
    supabaseClient: SupabaseClient | null,
    symbol: string,
  ) {
    super();
    this.binanceClient = binanceClient;
    this.tradingRules = tradingRules;
    this.supabaseClient = supabaseClient || getSupabaseClient();
    this.symbol = symbol;
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

        // Process order result
        const result = await this.processOrderResult(
          order as BinanceOrderWithFills,
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
    const tradeRecord: TradeRecord = {
      symbol: this.symbol,
      side: "BUY" as OrderSide,
      order_id: result.orderId,
      client_order_id: result.clientOrderId,
      quantity: result.executedQty.toString(),
      price: result.avgPrice.toString(),
      executed_qty: result.executedQty.toString(),
      cumulative_quote_qty: result.cummulativeQuoteQty.toString(),
      status: result.status,
      fee_btc: result.feeBTC.toString(),
      fee_usdt: result.feeUSDT.toString(),
      fee_other: Object.fromEntries(
        Object.entries(result.feeOther).map(([k, v]) => [k, v.toString()]),
      ),
      fills: result.fills,
      timestamp: new Date(),
    };

    try {
      // Use transaction for database operation
      const { error } = await this.supabaseClient
        .from("trades")
        .insert(tradeRecord);

      if (error) {
        throw new Error(`Failed to save trade record: ${error.message}`);
      }
    } catch (error) {
      // Log error but don't fail the order
      this.emit("databaseError", { error, tradeRecord });
      // Rethrow to handle in the calling function
      throw error;
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
