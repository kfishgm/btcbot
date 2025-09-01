import { createHmac } from "crypto";
import type {
  BinanceConfig,
  BinanceOrder,
  BinanceAccountInfo,
  BinanceBalance,
  BinanceTickerPrice,
  BinanceOrderBook,
  BinanceKline,
  RateLimitInfo,
  BinanceError,
  BinanceServerTime,
  BinanceTrade,
  BinanceListenKey,
  CreateOrderParams,
} from "./types";

export class BinanceClient {
  private config: BinanceConfig;
  private baseUrl: string;
  private wsUrl: string;
  private timeDiff: number = 0;
  private weightUsed: number = 0;
  private weightLimit: number = 1200;
  private lastResetTime: number = Date.now();
  private orderTimestamps: number[] = [];

  constructor(config: BinanceConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }
    if (!config.apiSecret) {
      throw new Error("API secret is required");
    }

    this.config = {
      ...config,
      recvWindow: config.recvWindow || 5000,
      timeout: config.timeout || 30000,
    };

    if (config.testnet) {
      this.baseUrl = "https://testnet.binance.vision";
      this.wsUrl = "wss://testnet.binance.vision";
    } else {
      this.baseUrl = "https://api.binance.com";
      this.wsUrl = "wss://stream.binance.com:9443";
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getWsUrl(): string {
    return this.wsUrl;
  }

  getTimeDiff(): number {
    return this.timeDiff;
  }

  getTimestamp(): number {
    return Date.now() + this.timeDiff;
  }

  getRateLimitInfo(): RateLimitInfo {
    this.cleanupOldOrderTimestamps();
    return {
      weightUsed: this.weightUsed,
      weightLimit: this.weightLimit,
      ordersPerSecond: this.orderTimestamps.length,
      lastResetTime: this.lastResetTime,
    };
  }

  setWeightUsed(weight: number): void {
    this.weightUsed = weight;
  }

  private cleanupOldOrderTimestamps(): void {
    const oneSecondAgo = Date.now() - 1000;
    this.orderTimestamps = this.orderTimestamps.filter(
      (timestamp) => timestamp > oneSecondAgo,
    );
  }

  private updateRateLimits(headers: Headers): void {
    const weightUsed = headers.get("x-mbx-used-weight-1m");
    if (weightUsed) {
      this.weightUsed = parseInt(weightUsed, 10);
    }

    const now = Date.now();
    if (now - this.lastResetTime > 60000) {
      this.weightUsed = 0;
      this.lastResetTime = now;
    }
  }

  generateSignature(queryString: string): string {
    return createHmac("sha256", this.config.apiSecret)
      .update(queryString)
      .digest("hex");
  }

  buildQueryString(params: Record<string, unknown>): string {
    const sortedKeys = Object.keys(params).sort();
    const queryParts = sortedKeys.map((key) => {
      const value = params[key];
      if (value === undefined || value === null) {
        return "";
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    });
    return queryParts.filter((part) => part !== "").join("&");
  }

  async syncTime(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v3/time`);
      if (!response.ok) {
        throw new Error("Failed to fetch server time");
      }
      const data = (await response.json()) as BinanceServerTime;
      this.timeDiff = data.serverTime - Date.now();
    } catch {
      throw new Error("Failed to sync time with server");
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    method: string = "GET",
    params: Record<string, unknown> = {},
    signed: boolean = false,
    retries: number = 3,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        let url = `${this.baseUrl}${endpoint}`;
        let body: string | undefined;
        const headers = new Headers({
          "X-MBX-APIKEY": this.config.apiKey,
        });

        if (signed) {
          params.timestamp = this.getTimestamp();
          params.recvWindow = this.config.recvWindow;
        }

        const queryString = this.buildQueryString(params);

        if (signed) {
          const signature = this.generateSignature(queryString);
          const signedQuery = `${queryString}&signature=${signature}`;
          if (method === "GET" || method === "DELETE") {
            url += `?${signedQuery}`;
          } else {
            headers.set("Content-Type", "application/x-www-form-urlencoded");
            body = signedQuery;
          }
        } else if (queryString && method === "GET") {
          url += `?${queryString}`;
        }

        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(this.config.timeout || 30000),
        });

        this.updateRateLimits(response.headers);

        if (!response.ok) {
          const error = (await response.json()) as BinanceError;

          if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after");
            const waitTime = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : 2000;
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }

          if (error.code === -1021 && attempt === 0) {
            await this.syncTime();
            continue;
          }

          throw new Error(error.msg || "Request failed");
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  async getPrice(symbol: string): Promise<BinanceTickerPrice> {
    return this.makeRequest<BinanceTickerPrice>("/api/v3/ticker/price", "GET", {
      symbol,
    });
  }

  async getOrderBook(
    symbol: string,
    limit: number = 100,
  ): Promise<BinanceOrderBook> {
    return this.makeRequest<BinanceOrderBook>("/api/v3/depth", "GET", {
      symbol,
      limit,
    });
  }

  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 500,
  ): Promise<BinanceKline[]> {
    const rawKlines = await this.makeRequest<unknown[][]>(
      "/api/v3/klines",
      "GET",
      {
        symbol,
        interval,
        limit,
      },
    );

    return rawKlines.map((kline) => ({
      openTime: kline[0] as number,
      open: kline[1] as string,
      high: kline[2] as string,
      low: kline[3] as string,
      close: kline[4] as string,
      volume: kline[5] as string,
      closeTime: kline[6] as number,
      quoteAssetVolume: kline[7] as string,
      numberOfTrades: kline[8] as number,
      takerBuyBaseAssetVolume: kline[9] as string,
      takerBuyQuoteAssetVolume: kline[10] as string,
    }));
  }

  async getAccountInfo(): Promise<BinanceAccountInfo> {
    return this.makeRequest<BinanceAccountInfo>(
      "/api/v3/account",
      "GET",
      {},
      true,
    );
  }

  async getBalance(asset: string): Promise<BinanceBalance> {
    const accountInfo = await this.getAccountInfo();
    const balance = accountInfo.balances.find((b) => b.asset === asset);
    if (!balance) {
      return {
        asset,
        free: "0",
        locked: "0",
      };
    }
    return balance;
  }

  async getMyTrades(
    symbol: string,
    limit: number = 500,
  ): Promise<BinanceTrade[]> {
    return this.makeRequest<BinanceTrade[]>(
      "/api/v3/myTrades",
      "GET",
      { symbol, limit },
      true,
    );
  }

  async getPortfolioValue(): Promise<number> {
    const accountInfo = await this.getAccountInfo();
    let totalValue = 0;

    for (const balance of accountInfo.balances) {
      const total = parseFloat(balance.free) + parseFloat(balance.locked);
      if (total > 0) {
        if (balance.asset === "USDT") {
          totalValue += total;
        } else if (balance.asset !== "USD") {
          try {
            const ticker = await this.getPrice(`${balance.asset}USDT`);
            totalValue += total * parseFloat(ticker.price);
          } catch {
            // If we can't get price, skip this asset
          }
        }
      }
    }

    return totalValue;
  }

  async createOrder(params: CreateOrderParams): Promise<BinanceOrder> {
    if (!params.symbol) {
      throw new Error("Symbol is required");
    }
    if (params.quantity <= 0) {
      throw new Error("Quantity must be greater than 0");
    }
    if (params.type === "LIMIT" && !params.price) {
      throw new Error("Price is required for LIMIT orders");
    }

    this.cleanupOldOrderTimestamps();
    if (this.orderTimestamps.length >= 10) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.orderTimestamps.push(Date.now());

    const orderParams: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
    };

    if (params.price) {
      orderParams.price = params.price;
    }
    if (params.stopPrice) {
      orderParams.stopPrice = params.stopPrice;
    }
    if (params.timeInForce) {
      orderParams.timeInForce = params.timeInForce;
    } else if (params.type === "LIMIT") {
      orderParams.timeInForce = "GTC";
    }
    if (params.newClientOrderId) {
      orderParams.newClientOrderId = params.newClientOrderId;
    }

    return this.makeRequest<BinanceOrder>(
      "/api/v3/order",
      "POST",
      orderParams,
      true,
    );
  }

  async cancelOrder(
    symbol: string,
    orderId?: number,
    origClientOrderId?: string,
  ): Promise<BinanceOrder> {
    const params: Record<string, unknown> = { symbol };
    if (orderId) {
      params.orderId = orderId;
    } else if (origClientOrderId) {
      params.origClientOrderId = origClientOrderId;
    } else {
      throw new Error("Either orderId or origClientOrderId is required");
    }

    return this.makeRequest<BinanceOrder>(
      "/api/v3/order",
      "DELETE",
      params,
      true,
    );
  }

  async getOrder(
    symbol: string,
    orderId?: number,
    origClientOrderId?: string,
  ): Promise<BinanceOrder> {
    const params: Record<string, unknown> = { symbol };
    if (orderId) {
      params.orderId = orderId;
    } else if (origClientOrderId) {
      params.origClientOrderId = origClientOrderId;
    } else {
      throw new Error("Either orderId or origClientOrderId is required");
    }

    return this.makeRequest<BinanceOrder>("/api/v3/order", "GET", params, true);
  }

  async getOpenOrders(symbol?: string): Promise<BinanceOrder[]> {
    const params: Record<string, unknown> = {};
    if (symbol) {
      params.symbol = symbol;
    }

    return this.makeRequest<BinanceOrder[]>(
      "/api/v3/openOrders",
      "GET",
      params,
      true,
    );
  }

  async createListenKey(): Promise<string> {
    const response = await this.makeRequest<BinanceListenKey>(
      "/api/v3/userDataStream",
      "POST",
      {},
      false,
    );
    return response.listenKey;
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    await this.makeRequest<Record<string, never>>(
      "/api/v3/userDataStream",
      "PUT",
      { listenKey },
      false,
    );
  }

  async closeListenKey(listenKey: string): Promise<void> {
    await this.makeRequest<Record<string, never>>(
      "/api/v3/userDataStream",
      "DELETE",
      { listenKey },
      false,
    );
  }

  getStreamUrl(streams: string | string[]): string {
    if (Array.isArray(streams)) {
      return `${this.wsUrl}/stream?streams=${streams.join("/")}`;
    }
    return `${this.wsUrl}/ws/${streams}`;
  }
}
