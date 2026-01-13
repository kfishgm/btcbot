-- Add Pool Configuration Columns to profit_pool
-- Created: 2026-01-13
-- Description: Adds configuration columns to store pool settings in the database
--              for consistency with other config that flows through setup script

-- Add configuration columns to profit_pool singleton
ALTER TABLE profit_pool
ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS reinvestment_percentage DECIMAL(5, 2) NOT NULL DEFAULT 70,
ADD COLUMN IF NOT EXISTS funding_wallet_percentage DECIMAL(5, 2) NOT NULL DEFAULT 30,
ADD COLUMN IF NOT EXISTS min_funding_transfer_amount DECIMAL(20, 8) NOT NULL DEFAULT 10;

-- Add constraint to ensure percentages sum to 100
ALTER TABLE profit_pool
ADD CONSTRAINT chk_pool_percentages_sum_100
CHECK (reinvestment_percentage + funding_wallet_percentage = 100);

-- Add constraint for valid percentage ranges
ALTER TABLE profit_pool
ADD CONSTRAINT chk_reinvestment_pct_range
CHECK (reinvestment_percentage >= 0 AND reinvestment_percentage <= 100);

ALTER TABLE profit_pool
ADD CONSTRAINT chk_funding_pct_range
CHECK (funding_wallet_percentage >= 0 AND funding_wallet_percentage <= 100);

-- Add constraint for positive min transfer amount
ALTER TABLE profit_pool
ADD CONSTRAINT chk_min_funding_positive
CHECK (min_funding_transfer_amount > 0);

-- Comment on columns for documentation
COMMENT ON COLUMN profit_pool.is_enabled IS 'Whether profit pool feature is enabled';
COMMENT ON COLUMN profit_pool.reinvestment_percentage IS 'Percentage of profits allocated to reinvestment (0-100)';
COMMENT ON COLUMN profit_pool.funding_wallet_percentage IS 'Percentage of profits allocated to funding wallet (0-100)';
COMMENT ON COLUMN profit_pool.min_funding_transfer_amount IS 'Minimum USDT amount required to trigger funding wallet transfer';
