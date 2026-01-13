-- Profit Pool System - Main Infrastructure Tables
-- Created: 2026-01-13
-- Description: Creates tables for managing profit accumulation, reinvestment distribution,
--              and funding wallet transfers

-- 1. profit_pool - Singleton table tracking pool state
CREATE TABLE IF NOT EXISTS profit_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_net_profits DECIMAL(20, 8) NOT NULL DEFAULT 0,
  allocated_to_reinvestment DECIMAL(20, 8) NOT NULL DEFAULT 0,
  allocated_to_funding_wallet DECIMAL(20, 8) NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ensure singleton constraint (only one row)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profit_pool_singleton
  ON profit_pool ((true));

-- 2. reinvestment_distributions - Records each reinvestment event
CREATE TABLE IF NOT EXISTS reinvestment_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES profit_pool(id) ON DELETE CASCADE,
  total_amount DECIMAL(20, 8) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  source_event VARCHAR(20) NOT NULL CHECK (source_event IN ('SELL', 'CYCLE_CLOSED', 'NEW_CYCLE')),
  source_cycle_id UUID NULL REFERENCES cycle_state(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reinvestment_dist_timestamp
  ON reinvestment_distributions(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_reinvestment_dist_pool
  ON reinvestment_distributions(pool_id);

CREATE INDEX IF NOT EXISTS idx_reinvestment_dist_cycle
  ON reinvestment_distributions(source_cycle_id);

-- Unique constraint to prevent double-counting (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reinvestment_dist_idempotent
  ON reinvestment_distributions(source_event, source_cycle_id)
  WHERE source_event IN ('SELL', 'CYCLE_CLOSED');

-- 3. reinvestment_distribution_items - Per-config distribution amounts
CREATE TABLE IF NOT EXISTS reinvestment_distribution_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id UUID NOT NULL REFERENCES reinvestment_distributions(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES strategy_config(id) ON DELETE CASCADE,
  amount DECIMAL(20, 8) NOT NULL,
  normalized_pct DECIMAL(5, 2) NOT NULL,
  original_capital_pct DECIMAL(5, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reinvestment_items_distribution
  ON reinvestment_distribution_items(distribution_id);

CREATE INDEX IF NOT EXISTS idx_reinvestment_items_config
  ON reinvestment_distribution_items(config_id);

-- 4. funding_wallet_transfers - External wallet transfer tracking
CREATE TABLE IF NOT EXISTS funding_wallet_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES profit_pool(id) ON DELETE CASCADE,
  amount DECIMAL(20, 8) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  transaction_id VARCHAR(100) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  completed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_funding_transfers_status
  ON funding_wallet_transfers(status);

CREATE INDEX IF NOT EXISTS idx_funding_transfers_timestamp
  ON funding_wallet_transfers(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_funding_transfers_pool
  ON funding_wallet_transfers(pool_id);

-- Audit/History: Track all transfers for reconciliation
CREATE INDEX IF NOT EXISTS idx_funding_transfers_completed_status
  ON funding_wallet_transfers(completed_at DESC)
  WHERE status = 'COMPLETED';

-- Auto-update last_updated_at for profit_pool
CREATE OR REPLACE FUNCTION update_profit_pool_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profit_pool
  SET last_updated_at = NOW()
  WHERE id = NEW.pool_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_update_profit_pool_timestamp_distributions ON reinvestment_distributions;
CREATE TRIGGER trig_update_profit_pool_timestamp_distributions
  AFTER INSERT OR UPDATE ON reinvestment_distributions
  FOR EACH ROW
  EXECUTE FUNCTION update_profit_pool_timestamp();

DROP TRIGGER IF EXISTS trig_update_profit_pool_timestamp_transfers ON funding_wallet_transfers;
CREATE TRIGGER trig_update_profit_pool_timestamp_transfers
  AFTER INSERT OR UPDATE ON funding_wallet_transfers
  FOR EACH ROW
  EXECUTE FUNCTION update_profit_pool_timestamp();

-- Initialize singleton pool row
INSERT INTO profit_pool (id)
VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;
