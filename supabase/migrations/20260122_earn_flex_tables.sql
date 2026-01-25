-- Earn Flex Integration Tables
-- Tracks per-config principal and interest in Binance Simple Earn Flexible

-- earn_flex_positions: Per-config tracking of principal + interest (separate)
CREATE TABLE IF NOT EXISTS earn_flex_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_config_id UUID NOT NULL REFERENCES strategy_config(id) ON DELETE CASCADE,
  asset TEXT NOT NULL CHECK (asset IN ('USDT', 'BTC')),
  principal_amount DECIMAL(20,8) NOT NULL DEFAULT 0,  -- Available for trading
  pending_amount DECIMAL(20,8) NOT NULL DEFAULT 0,    -- Below min, waiting to accumulate
  interest_earned DECIMAL(20,8) NOT NULL DEFAULT 0,   -- Tracked, NOT available for trading
  binance_product_id TEXT,                            -- Cached product ID for this asset
  last_interest_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(strategy_config_id, asset)
);

-- earn_flex_transactions: Audit trail for all earn operations
CREATE TABLE IF NOT EXISTS earn_flex_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_config_id UUID NOT NULL REFERENCES strategy_config(id) ON DELETE CASCADE,
  cycle_id UUID REFERENCES cycle_state(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'SUBSCRIBE_USDT', 'SUBSCRIBE_BTC',
    'REDEEM_USDT', 'REDEEM_BTC',
    'PENDING_USDT', 'PENDING_BTC',      -- Amount below min, waiting
    'PENDING_TO_SUBSCRIBE',              -- Pending accumulated, now subscribing
    'INTEREST_SYNC'                      -- Interest tracking update
  )),
  asset TEXT NOT NULL CHECK (asset IN ('USDT', 'BTC')),
  amount DECIMAL(20,8) NOT NULL,
  binance_tran_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_earn_flex_positions_config_id
  ON earn_flex_positions(strategy_config_id);

CREATE INDEX IF NOT EXISTS idx_earn_flex_positions_asset
  ON earn_flex_positions(asset);

CREATE INDEX IF NOT EXISTS idx_earn_flex_transactions_config_id
  ON earn_flex_transactions(strategy_config_id);

CREATE INDEX IF NOT EXISTS idx_earn_flex_transactions_cycle_id
  ON earn_flex_transactions(cycle_id);

CREATE INDEX IF NOT EXISTS idx_earn_flex_transactions_type
  ON earn_flex_transactions(transaction_type);

CREATE INDEX IF NOT EXISTS idx_earn_flex_transactions_created_at
  ON earn_flex_transactions(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_earn_flex_positions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_earn_flex_positions_updated_at ON earn_flex_positions;
CREATE TRIGGER trigger_update_earn_flex_positions_updated_at
  BEFORE UPDATE ON earn_flex_positions
  FOR EACH ROW
  EXECUTE FUNCTION update_earn_flex_positions_updated_at();

-- Grant permissions
GRANT ALL ON earn_flex_positions TO authenticated;
GRANT ALL ON earn_flex_positions TO service_role;
GRANT ALL ON earn_flex_transactions TO authenticated;
GRANT ALL ON earn_flex_transactions TO service_role;

COMMENT ON TABLE earn_flex_positions IS 'Per-config tracking of principal and interest in Binance Simple Earn Flexible';
COMMENT ON TABLE earn_flex_transactions IS 'Audit trail for all Earn Flex subscribe/redeem operations';
COMMENT ON COLUMN earn_flex_positions.principal_amount IS 'Amount available for trading (can be redeemed)';
COMMENT ON COLUMN earn_flex_positions.pending_amount IS 'Amount below Binance minimum, waiting to accumulate';
COMMENT ON COLUMN earn_flex_positions.interest_earned IS 'Accumulated interest - tracked only, NOT available for trading';
