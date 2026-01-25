/**
 * Earn Flex Service
 *
 * Manages Binance Simple Earn Flexible integration:
 * - Subscribe USDT/BTC to Earn Flex after trades
 * - Redeem before trades
 * - Track principal/pending/interest per config
 * - Handle dust accumulation for amounts below minimum
 *
 * CRITICAL: Auto-subscribe is disabled on initialize() to maintain control
 */

import { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { logger } from "../utils/logger";
import { BinanceClient } from "../exchange/binance-client";
import { EarnFlexRepository } from "./repositories/earn-flex-repository";
import type {
  EarnFlexAsset,
  PositionInfo,
  ProductInfo,
  SubscribeResult,
  RedeemResult,
  ConfigCapitalAccounting,
  ReconciliationResult,
  SpotBalanceCheck,
} from "./earn-flex-service.types";

export class EarnFlexService {
  private repository: EarnFlexRepository;
  private binanceClient: BinanceClient;
  private productIds: Map<EarnFlexAsset, ProductInfo> = new Map();
  private initialized: boolean = false;

  constructor(supabase: SupabaseClient, binanceClient: BinanceClient) {
    this.repository = new EarnFlexRepository(supabase);
    this.binanceClient = binanceClient;
  }

  /**
   * Initialize the service - fetch and cache product IDs for USDT and BTC
   * CRITICAL: Disables auto-subscribe to maintain controlled flow
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn("EarnFlexService already initialized");
      return;
    }

    try {
      // Fetch USDT and BTC products
      const assets: EarnFlexAsset[] = ["USDT", "BTC"];

      for (const asset of assets) {
        const products =
          await this.binanceClient.getSimpleEarnFlexibleProducts(asset);

        if (products.length === 0) {
          logger.warn(`No Earn Flex product for ${asset}`);
          continue;
        }

        const product = products.find(
          (p) =>
            p.asset === asset && p.status === "PURCHASING" && p.canPurchase,
        );

        if (!product) {
          logger.warn(`No purchasable Earn product for ${asset}`);
          continue;
        }

        this.productIds.set(asset, {
          productId: product.productId,
          minAmount: new Decimal(product.minPurchaseAmount),
        });
      }

      // Check and disable auto-subscribe for our positions
      await this.disableAutoSubscribeIfNeeded();

      this.initialized = true;
      logger.info("Earn Flex initialized", {
        products: this.productIds.size,
      });
    } catch (error) {
      logger.error("Failed to initialize EarnFlexService", { error });
      throw error;
    }
  }

  /**
   * Disable auto-subscribe for USDT and BTC positions
   * CRITICAL: Our flow requires manual control over subscriptions
   */
  private async disableAutoSubscribeIfNeeded(): Promise<void> {
    try {
      const positions =
        await this.binanceClient.getSimpleEarnFlexiblePositions();

      for (const pos of positions) {
        if (pos.asset !== "USDT" && pos.asset !== "BTC") continue;

        // Check for both boolean true and string "true" (API inconsistency)
        const isAutoSubscribeOn =
          pos.autoSubscribe === true ||
          pos.autoSubscribe === ("true" as unknown);

        if (isAutoSubscribeOn) {
          try {
            await this.binanceClient.setSimpleEarnAutoSubscribe(
              pos.productId,
              false,
            );
            logger.info(`Auto-subscribe disabled for ${pos.asset}`);
          } catch (disableError) {
            logger.error(`Failed to disable auto-subscribe for ${pos.asset}`, {
              error: disableError,
            });
          }
        }
      }
    } catch (error) {
      logger.warn("Could not check auto-subscribe status", { error });
    }
  }

  /**
   * Public method to check and disable auto-subscribe
   * Call this periodically (e.g., once a day) to ensure auto-subscribe stays OFF
   */
  async ensureAutoSubscribeDisabled(): Promise<{
    checked: number;
    disabled: number;
    alreadyOff: number;
    errors: string[];
  }> {
    const result = {
      checked: 0,
      disabled: 0,
      alreadyOff: 0,
      errors: [] as string[],
    };

    try {
      const positions =
        await this.binanceClient.getSimpleEarnFlexiblePositions();

      for (const pos of positions) {
        if (pos.asset !== "USDT" && pos.asset !== "BTC") continue;

        result.checked++;

        // Check for both boolean true and string "true"
        const isAutoSubscribeOn =
          pos.autoSubscribe === true ||
          pos.autoSubscribe === ("true" as unknown);

        if (isAutoSubscribeOn) {
          try {
            await this.binanceClient.setSimpleEarnAutoSubscribe(
              pos.productId,
              false,
            );
            result.disabled++;
            logger.info(`Auto-subscribe disabled for ${pos.asset}`);
          } catch (disableError) {
            const errorMsg =
              disableError instanceof Error
                ? disableError.message
                : String(disableError);
            result.errors.push(`${pos.asset}: ${errorMsg}`);
            logger.error(`Failed to disable auto-subscribe for ${pos.asset}`, {
              error: disableError,
            });
          }
        } else {
          result.alreadyOff++;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to get positions: ${errorMsg}`);
      logger.error("Failed to check auto-subscribe status", { error });
    }

    return result;
  }

  /**
   * Subscribe asset to Earn Flex
   * Handles pending accumulation if amount is below minimum
   *
   * @param configId Strategy config ID
   * @param asset USDT or BTC
   * @param amount Amount to subscribe
   * @param cycleId Optional cycle ID for transaction tracking
   */
  async subscribe(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
    cycleId?: string,
  ): Promise<SubscribeResult> {
    if (!this.initialized) {
      throw new Error(
        "EarnFlexService not initialized - call initialize() first",
      );
    }

    if (amount.lte(0)) {
      logger.debug("Skipping subscribe - amount is zero or negative", {
        configId,
        asset,
        amount: amount.toString(),
      });
      return {
        success: true,
        amountSubscribed: new Decimal(0),
        amountPending: new Decimal(0),
      };
    }

    const productInfo = this.productIds.get(asset);
    if (!productInfo) {
      logger.warn(`No product info for ${asset}, tracking as pending`, {
        configId,
        amount: amount.toString(),
      });
      // Track as pending even without product info
      await this.repository.addToPending(configId, asset, amount);
      await this.repository.createTransaction(
        configId,
        asset === "USDT" ? "PENDING_USDT" : "PENDING_BTC",
        asset,
        amount,
        cycleId,
        "SUCCESS",
      );
      return {
        success: true,
        amountSubscribed: new Decimal(0),
        amountPending: amount,
      };
    }

    // Get current pending amount
    const position = await this.repository.getOrCreatePosition(configId, asset);
    const currentPending = new Decimal(position.pending_amount);
    const totalPending = currentPending.add(amount);

    logger.debug("Subscribe calculation", {
      configId,
      asset,
      incomingAmount: amount.toString(),
      currentPending: currentPending.toString(),
      totalPending: totalPending.toString(),
      minAmount: productInfo.minAmount.toString(),
    });

    // Check if accumulated amount meets minimum
    if (totalPending.gte(productInfo.minAmount)) {
      // Enough accumulated - subscribe to Binance
      return this.executeSubscribe(
        configId,
        asset,
        totalPending,
        productInfo,
        cycleId,
        amount,
      );
    } else {
      // Below minimum - add to pending
      await this.repository.addToPending(configId, asset, amount);
      await this.repository.createTransaction(
        configId,
        asset === "USDT" ? "PENDING_USDT" : "PENDING_BTC",
        asset,
        amount,
        cycleId,
        "SUCCESS",
      );

      logger.info("Amount below minimum, added to pending", {
        configId,
        asset,
        added: amount.toString(),
        totalPending: totalPending.toString(),
        minRequired: productInfo.minAmount.toString(),
      });

      return {
        success: true,
        amountSubscribed: new Decimal(0),
        amountPending: totalPending,
      };
    }
  }

  /**
   * Execute the actual Binance subscribe call
   */
  private async executeSubscribe(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
    productInfo: ProductInfo,
    cycleId?: string,
    incomingAmount?: Decimal,
  ): Promise<SubscribeResult> {
    // Create transaction record
    const transactionType = amount.gt(incomingAmount || 0)
      ? "PENDING_TO_SUBSCRIBE"
      : asset === "USDT"
        ? "SUBSCRIBE_USDT"
        : "SUBSCRIBE_BTC";

    const transaction = await this.repository.createTransaction(
      configId,
      transactionType,
      asset,
      amount,
      cycleId,
    );

    try {
      // Call Binance API
      const result = await this.binanceClient.subscribeSimpleEarnFlexible(
        productInfo.productId,
        amount.toNumber(),
        false, // Never auto-subscribe
      );

      if (result.success) {
        // Move from pending to principal in DB
        await this.repository.movePendingToPrincipal(configId, asset, amount);

        // Update product ID cache in position
        await this.repository.updateProductId(
          configId,
          asset,
          productInfo.productId,
        );

        // Mark transaction as success
        await this.repository.updateTransactionStatus(
          transaction.id,
          "SUCCESS",
          result.purchaseId.toString(),
        );

        logger.info("Successfully subscribed to Earn Flex", {
          configId,
          asset,
          amount: amount.toString(),
          purchaseId: result.purchaseId,
        });

        return {
          success: true,
          purchaseId: result.purchaseId,
          amountSubscribed: amount,
          amountPending: new Decimal(0),
        };
      } else {
        throw new Error("Subscribe returned success: false");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Mark transaction as failed
      await this.repository.updateTransactionStatus(
        transaction.id,
        "FAILED",
        undefined,
        errorMsg,
      );

      // Don't lose the money - if incoming amount was added, it stays in pending
      if (incomingAmount && incomingAmount.gt(0)) {
        await this.repository.addToPending(configId, asset, incomingAmount);
      }

      logger.error("Failed to subscribe to Earn Flex", {
        configId,
        asset,
        amount: amount.toString(),
        error: errorMsg,
      });

      return {
        success: false,
        amountSubscribed: new Decimal(0),
        amountPending: amount,
        error: errorMsg,
      };
    }
  }

  /**
   * Redeem exact amount from Earn Flex
   *
   * @param configId Strategy config ID
   * @param asset USDT or BTC
   * @param amount Amount to redeem (or all if greater than principal)
   * @returns Actual amount redeemed
   */
  async redeem(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
  ): Promise<RedeemResult> {
    if (!this.initialized) {
      throw new Error(
        "EarnFlexService not initialized - call initialize() first",
      );
    }

    const position = await this.repository.getPosition(configId, asset);

    if (!position) {
      logger.debug("No position found for redeem", { configId, asset });
      return {
        success: true,
        amountRedeemed: new Decimal(0),
      };
    }

    const principal = new Decimal(position.principal_amount);

    if (principal.lte(0)) {
      logger.debug("No principal to redeem", {
        configId,
        asset,
        principal: principal.toString(),
      });
      return {
        success: true,
        amountRedeemed: new Decimal(0),
      };
    }

    // Determine how much to actually redeem
    const toRedeem = Decimal.min(amount, principal);

    if (toRedeem.lte(0)) {
      return {
        success: true,
        amountRedeemed: new Decimal(0),
      };
    }

    const productInfo = this.productIds.get(asset);
    if (!productInfo) {
      logger.error("Cannot redeem - no product info for asset", {
        configId,
        asset,
      });
      return {
        success: false,
        amountRedeemed: new Decimal(0),
        error: `No product info for ${asset}`,
      };
    }

    // Create transaction record
    const transaction = await this.repository.createTransaction(
      configId,
      asset === "USDT" ? "REDEEM_USDT" : "REDEEM_BTC",
      asset,
      toRedeem,
    );

    try {
      // Determine if we're redeeming all or partial
      const redeemAll = toRedeem.gte(principal);

      // Call Binance API
      const result = await this.binanceClient.redeemSimpleEarnFlexible(
        productInfo.productId,
        redeemAll ? undefined : toRedeem.toNumber(),
        redeemAll,
      );

      if (result.success) {
        // Update DB
        await this.repository.subtractFromPrincipal(configId, asset, toRedeem);

        // Mark transaction as success
        await this.repository.updateTransactionStatus(
          transaction.id,
          "SUCCESS",
          result.redeemId.toString(),
        );

        logger.info("Successfully redeemed from Earn Flex", {
          configId,
          asset,
          amount: toRedeem.toString(),
          redeemId: result.redeemId,
          redeemAll,
        });

        return {
          success: true,
          redeemId: result.redeemId,
          amountRedeemed: toRedeem,
        };
      } else {
        throw new Error("Redeem returned success: false");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Mark transaction as failed
      await this.repository.updateTransactionStatus(
        transaction.id,
        "FAILED",
        undefined,
        errorMsg,
      );

      logger.error("Failed to redeem from Earn Flex", {
        configId,
        asset,
        amount: toRedeem.toString(),
        error: errorMsg,
      });

      return {
        success: false,
        amountRedeemed: new Decimal(0),
        error: errorMsg,
      };
    }
  }

  /**
   * Get available principal for a config (excludes pending and interest)
   */
  async getAvailablePrincipal(
    configId: string,
    asset: EarnFlexAsset,
  ): Promise<Decimal> {
    const position = await this.repository.getPosition(configId, asset);

    if (!position) {
      return new Decimal(0);
    }

    return new Decimal(position.principal_amount);
  }

  /**
   * Get total position info for reporting
   */
  async getPositionInfo(
    configId: string,
    asset: EarnFlexAsset,
  ): Promise<PositionInfo> {
    const position = await this.repository.getPosition(configId, asset);

    if (!position) {
      return {
        principal: new Decimal(0),
        pending: new Decimal(0),
        interest: new Decimal(0),
      };
    }

    return {
      principal: new Decimal(position.principal_amount),
      pending: new Decimal(position.pending_amount),
      interest: new Decimal(position.interest_earned),
    };
  }

  /**
   * Sync interest from Binance
   * Call periodically via cron to update interest tracking
   */
  async syncInterest(configId: string): Promise<void> {
    if (!this.initialized) {
      throw new Error("EarnFlexService not initialized");
    }

    try {
      const positions =
        await this.binanceClient.getSimpleEarnFlexiblePositions();

      for (const binancePos of positions) {
        const asset = binancePos.asset as EarnFlexAsset;
        if (asset !== "USDT" && asset !== "BTC") continue;

        // Get our DB position for this config/asset
        const dbPosition = await this.repository.getPosition(configId, asset);
        if (!dbPosition) continue;

        // If product IDs match, update interest
        if (dbPosition.binance_product_id === binancePos.productId) {
          const totalInterest = new Decimal(
            binancePos.cumulativeTotalRewards || "0",
          );

          await this.repository.updateInterestEarned(
            configId,
            asset,
            totalInterest,
          );

          // Log interest sync transaction
          const currentInterest = new Decimal(dbPosition.interest_earned);
          const interestDelta = totalInterest.sub(currentInterest);

          if (interestDelta.gt(0)) {
            await this.repository.createTransaction(
              configId,
              "INTEREST_SYNC",
              asset,
              interestDelta,
              undefined,
              "SUCCESS",
            );

            logger.info("Synced interest from Binance", {
              configId,
              asset,
              previousInterest: currentInterest.toString(),
              newInterest: totalInterest.toString(),
              delta: interestDelta.toString(),
            });
          }
        }
      }
    } catch (error) {
      logger.error("Failed to sync interest", { error, configId });
      // Don't throw - interest sync is not critical
    }
  }

  /**
   * Try to subscribe any pending amounts that have accumulated above minimum
   * Call this periodically to batch up dust
   */
  async trySubscribePending(configId: string): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const assets: EarnFlexAsset[] = ["USDT", "BTC"];

    for (const asset of assets) {
      const productInfo = this.productIds.get(asset);
      if (!productInfo) continue;

      const position = await this.repository.getPosition(configId, asset);
      if (!position) continue;

      const pending = new Decimal(position.pending_amount);

      if (pending.gte(productInfo.minAmount)) {
        logger.info("Pending amount reached minimum, subscribing", {
          configId,
          asset,
          pending: pending.toString(),
          minAmount: productInfo.minAmount.toString(),
        });

        await this.executeSubscribe(configId, asset, pending, productInfo);
      }
    }
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get product info for an asset
   */
  getProductInfo(asset: EarnFlexAsset): ProductInfo | undefined {
    return this.productIds.get(asset);
  }

  /**
   * Get capital accounting for a config
   * Shows exactly where all capital is (Earn vs SPOT)
   */
  async getCapitalAccounting(
    configId: string,
  ): Promise<ConfigCapitalAccounting> {
    const usdtPosition = await this.getPositionInfo(configId, "USDT");
    const btcPosition = await this.getPositionInfo(configId, "BTC");

    return {
      configId,
      usdt: {
        inEarn: usdtPosition.principal,
        inSpot: usdtPosition.pending,
        interest: usdtPosition.interest,
        total: usdtPosition.principal.add(usdtPosition.pending),
      },
      btc: {
        inEarn: btcPosition.principal,
        inSpot: btcPosition.pending,
        interest: btcPosition.interest,
        total: btcPosition.principal.add(btcPosition.pending),
      },
    };
  }

  /**
   * Reconcile and subscribe on startup
   *
   * Called when bot starts to:
   * 1. Get current capital accounting
   * 2. Subscribe any pending amounts that have accumulated above minimum
   * 3. Return clear picture of where capital is
   */
  async reconcileOnStartup(configId: string): Promise<ReconciliationResult> {
    if (!this.initialized) {
      throw new Error("EarnFlexService not initialized");
    }

    const warnings: string[] = [];
    let usdtSubscribed = new Decimal(0);
    let btcSubscribed = new Decimal(0);

    // Try to subscribe pending amounts if they've reached minimum
    const assets: EarnFlexAsset[] = ["USDT", "BTC"];

    for (const asset of assets) {
      const productInfo = this.productIds.get(asset);
      if (!productInfo) {
        warnings.push(`No product info for ${asset}`);
        continue;
      }

      const position = await this.repository.getPosition(configId, asset);
      if (!position) continue;

      const pending = new Decimal(position.pending_amount);

      if (pending.gte(productInfo.minAmount)) {
        const result = await this.executeSubscribe(
          configId,
          asset,
          pending,
          productInfo,
        );

        if (result.success) {
          if (asset === "USDT") {
            usdtSubscribed = result.amountSubscribed;
          } else {
            btcSubscribed = result.amountSubscribed;
          }
          logger.info(`Subscribed pending ${asset}`, {
            amount: result.amountSubscribed.toString(),
          });
        } else {
          warnings.push(`Failed to subscribe ${asset}: ${result.error}`);
        }
      }
    }

    // Get accounting after reconciliation
    const afterAccounting = await this.getCapitalAccounting(configId);

    return {
      configId,
      accounting: afterAccounting,
      actions: {
        usdtSubscribed,
        btcSubscribed,
      },
      warnings,
    };
  }

  /**
   * Seed initial capital from cycle state
   *
   * Call this on first startup to migrate existing capital from cycle_state
   * into the Earn Flex tracking system. This creates positions and subscribes
   * the amounts to Earn Flex.
   *
   * @param configId Strategy config ID
   * @param capitalAvailable USDT capital from cycle_state.capital_available
   * @param btcAccumulated BTC from cycle_state.btc_accumulated
   * @returns Result of seeding operation
   */
  async seedFromCycleState(
    configId: string,
    capitalAvailable: Decimal,
    btcAccumulated: Decimal,
  ): Promise<{
    usdtSeeded: Decimal;
    btcSeeded: Decimal;
    usdtSubscribed: Decimal;
    btcSubscribed: Decimal;
    errors: string[];
  }> {
    if (!this.initialized) {
      throw new Error("EarnFlexService not initialized");
    }

    const errors: string[] = [];
    let usdtSeeded = new Decimal(0);
    let btcSeeded = new Decimal(0);
    let usdtSubscribed = new Decimal(0);
    let btcSubscribed = new Decimal(0);

    // Seed USDT if there's capital available
    if (capitalAvailable.gt(0)) {
      const existingUsdt = await this.repository.getPosition(configId, "USDT");

      if (!existingUsdt || new Decimal(existingUsdt.principal_amount).eq(0)) {
        const productInfo = this.productIds.get("USDT");
        if (!productInfo) {
          errors.push("No USDT product info available");
        } else {
          const position = await this.repository.getOrCreatePosition(
            configId,
            "USDT",
          );
          await this.repository.updatePosition(position.id, {
            pending_amount: capitalAvailable.toString(),
            binance_product_id: productInfo.productId,
          });
          usdtSeeded = capitalAvailable;

          // Try to subscribe if above minimum
          if (capitalAvailable.gte(productInfo.minAmount)) {
            const result = await this.executeSubscribe(
              configId,
              "USDT",
              capitalAvailable,
              productInfo,
            );
            if (result.success) {
              usdtSubscribed = result.amountSubscribed;
              logger.info("Seeded USDT to Earn", {
                amount: usdtSubscribed.toString(),
              });
            } else {
              errors.push(`Failed to subscribe USDT: ${result.error}`);
            }
          }
        }
      }
    }

    // Seed BTC if there's accumulated BTC
    if (btcAccumulated.gt(0)) {
      const existingBtc = await this.repository.getPosition(configId, "BTC");

      if (!existingBtc || new Decimal(existingBtc.principal_amount).eq(0)) {
        const productInfo = this.productIds.get("BTC");
        if (!productInfo) {
          errors.push("No BTC product info available");
        } else {
          const position = await this.repository.getOrCreatePosition(
            configId,
            "BTC",
          );
          await this.repository.updatePosition(position.id, {
            pending_amount: btcAccumulated.toString(),
            binance_product_id: productInfo.productId,
          });
          btcSeeded = btcAccumulated;

          // Try to subscribe if above minimum
          if (btcAccumulated.gte(productInfo.minAmount)) {
            const result = await this.executeSubscribe(
              configId,
              "BTC",
              btcAccumulated,
              productInfo,
            );
            if (result.success) {
              btcSubscribed = result.amountSubscribed;
              logger.info("Seeded BTC to Earn", {
                amount: btcSubscribed.toString(),
              });
            } else {
              errors.push(`Failed to subscribe BTC: ${result.error}`);
            }
          }
        }
      }
    }

    return {
      usdtSeeded,
      btcSeeded,
      usdtSubscribed,
      btcSubscribed,
      errors,
    };
  }

  /**
   * Check SPOT balance against expected per-config pending amounts
   *
   * This is a cross-config check to detect untracked funds.
   * Call this after all configs have been reconciled.
   *
   * @param actualUsdtSpot Actual USDT balance in SPOT
   * @param actualBtcSpot Actual BTC balance in SPOT
   */
  async checkSpotBalanceReconciliation(
    actualUsdtSpot: Decimal,
    actualBtcSpot: Decimal,
  ): Promise<{ usdt: SpotBalanceCheck; btc: SpotBalanceCheck }> {
    // Get total pending across ALL configs
    const totalUsdtPending =
      await this.repository.getTotalPendingForAsset("USDT");
    const totalBtcPending =
      await this.repository.getTotalPendingForAsset("BTC");

    const usdtDiff = actualUsdtSpot.sub(totalUsdtPending);
    const btcDiff = actualBtcSpot.sub(totalBtcPending);

    // Allow small tolerance for rounding (0.01 USDT, 0.00000001 BTC)
    const usdtTolerance = new Decimal("0.01");
    const btcTolerance = new Decimal("0.00000001");

    const usdtReconciled = usdtDiff.abs().lte(usdtTolerance);
    const btcReconciled = btcDiff.abs().lte(btcTolerance);

    const result = {
      usdt: {
        asset: "USDT" as EarnFlexAsset,
        actualSpotBalance: actualUsdtSpot,
        expectedInSpot: totalUsdtPending,
        difference: usdtDiff,
        isReconciled: usdtReconciled,
      },
      btc: {
        asset: "BTC" as EarnFlexAsset,
        actualSpotBalance: actualBtcSpot,
        expectedInSpot: totalBtcPending,
        difference: btcDiff,
        isReconciled: btcReconciled,
      },
    };

    // Log warnings for unreconciled balances
    if (!usdtReconciled) {
      if (usdtDiff.gt(0)) {
        logger.warn("UNTRACKED USDT detected in SPOT", {
          actual: actualUsdtSpot.toString(),
          expected: totalUsdtPending.toString(),
          untracked: usdtDiff.toString(),
        });
      } else {
        logger.warn("MISSING USDT - SPOT balance lower than expected", {
          actual: actualUsdtSpot.toString(),
          expected: totalUsdtPending.toString(),
          missing: usdtDiff.abs().toString(),
        });
      }
    }

    if (!btcReconciled) {
      if (btcDiff.gt(0)) {
        logger.warn("UNTRACKED BTC detected in SPOT", {
          actual: actualBtcSpot.toString(),
          expected: totalBtcPending.toString(),
          untracked: btcDiff.toString(),
        });
      } else {
        logger.warn("MISSING BTC - SPOT balance lower than expected", {
          actual: actualBtcSpot.toString(),
          expected: totalBtcPending.toString(),
          missing: btcDiff.abs().toString(),
        });
      }
    }

    if (usdtReconciled && btcReconciled) {
      logger.info("SPOT balance reconciliation passed", {
        usdt: {
          actual: actualUsdtSpot.toString(),
          expected: totalUsdtPending.toString(),
        },
        btc: {
          actual: actualBtcSpot.toString(),
          expected: totalBtcPending.toString(),
        },
      });
    }

    return result;
  }

  /**
   * Add untracked SPOT balance to a config's pending
   *
   * Use this to recover untracked funds after a crash.
   * The funds will be subscribed to Earn on next reconciliation (if >= min).
   */
  async addUntrackedToConfig(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
  ): Promise<void> {
    if (amount.lte(0)) {
      return;
    }

    logger.info("Adding untracked funds to config pending", {
      configId,
      asset,
      amount: amount.toString(),
    });

    await this.repository.addToPending(configId, asset, amount);

    // Create transaction record for audit
    await this.repository.createTransaction(
      configId,
      asset === "USDT" ? "PENDING_USDT" : "PENDING_BTC",
      asset,
      amount,
      undefined,
      "SUCCESS",
    );

    // Try to subscribe if now above minimum
    const productInfo = this.productIds.get(asset);
    if (productInfo) {
      const position = await this.repository.getPosition(configId, asset);
      if (position) {
        const newPending = new Decimal(position.pending_amount);
        if (newPending.gte(productInfo.minAmount)) {
          await this.executeSubscribe(configId, asset, newPending, productInfo);
        }
      }
    }
  }

  /**
   * Get total capital for a config (principal + pending)
   * This is what should be used for new cycle capital calculation
   */
  async getTotalCapital(
    configId: string,
    asset: EarnFlexAsset,
  ): Promise<Decimal> {
    const position = await this.repository.getPosition(configId, asset);

    if (!position) {
      return new Decimal(0);
    }

    const principal = new Decimal(position.principal_amount);
    const pending = new Decimal(position.pending_amount);

    return principal.add(pending);
  }
}
