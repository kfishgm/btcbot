/**
 * Mock Balance Manager for E2E Tests
 *
 * Tracks balance changes from mock trades
 */

import { EventEmitter } from "events";
import type { MockBinanceClient } from "./mock-binance-client.js";

export interface Balance {
  asset: string;
  free: string;
  locked: string;
}

export class MockBalanceManager extends EventEmitter {
  private mockBinanceClient: MockBinanceClient;
  private lastBalances: Map<string, Balance> = new Map();

  constructor(mockBinanceClient: MockBinanceClient) {
    super();
    this.mockBinanceClient = mockBinanceClient;
  }

  async initialize(): Promise<void> {
    // Get initial balances
    await this.updateBalances();
    this.emit("initialized");
  }

  async updateBalances(): Promise<void> {
    const accountInfo = await this.mockBinanceClient.getAccountInfo();

    for (const balance of accountInfo.balances) {
      this.lastBalances.set(balance.asset, {
        asset: balance.asset,
        free: balance.free,
        locked: balance.locked,
      });
    }

    this.emit("balances_updated", this.lastBalances);
  }

  async getBalance(asset: string): Promise<Balance | null> {
    const balance = await this.mockBinanceClient.getBalance(asset);
    if (!balance) return null;

    return {
      asset: balance.asset,
      free: balance.free,
      locked: balance.locked,
    };
  }

  async getBalances(): Promise<Map<string, Balance>> {
    await this.updateBalances();
    return new Map(this.lastBalances);
  }

  getLastBalance(asset: string): Balance | undefined {
    return this.lastBalances.get(asset);
  }

  // Check if we have sufficient balance for a trade
  async hasSufficientBalance(asset: string, amount: number): Promise<boolean> {
    const balance = await this.getBalance(asset);
    if (!balance) return false;

    const freeBalance = parseFloat(balance.free);
    return freeBalance >= amount;
  }

  // Get available USDT for trading
  async getAvailableUSDT(): Promise<number> {
    const balance = await this.getBalance("USDT");
    return balance ? parseFloat(balance.free) : 0;
  }

  // Get available BTC for trading
  async getAvailableBTC(): Promise<number> {
    const balance = await this.getBalance("BTC");
    return balance ? parseFloat(balance.free) : 0;
  }

  // Monitor balance changes after trades
  async monitorTrade(side: "BUY" | "SELL"): Promise<void> {
    const beforeBalances = new Map(this.lastBalances);
    await this.updateBalances();

    // Calculate changes
    const changes: Record<string, number> = {};
    for (const [asset, newBalance] of this.lastBalances) {
      const oldBalance = beforeBalances.get(asset);
      if (oldBalance) {
        const diff = parseFloat(newBalance.free) - parseFloat(oldBalance.free);
        if (Math.abs(diff) > 0.00000001) {
          // Ignore tiny differences
          changes[asset] = diff;
        }
      }
    }

    if (Object.keys(changes).length > 0) {
      this.emit("balance_change", { side, changes });
    }
  }

  // Reset for testing
  reset(): void {
    this.lastBalances.clear();
  }
}
