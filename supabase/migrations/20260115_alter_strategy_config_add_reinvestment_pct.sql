-- Add reinvestment allocation percentage to strategy_config
-- Created: 2026-01-13
-- Description: Adds reinvestment_allocation_pct column to track how much of POOL's
--              reinvestment each config should receive when creating new cycles

ALTER TABLE strategy_config
ADD COLUMN IF NOT EXISTS reinvestment_allocation_pct DECIMAL(5, 2) NULL;

-- Add constraint: percentage must be between 0 and 100
ALTER TABLE strategy_config
ADD CONSTRAINT chk_reinvestment_allocation_pct
CHECK (reinvestment_allocation_pct IS NULL OR (reinvestment_allocation_pct >= 0 AND reinvestment_allocation_pct <= 100));

-- Add index for filtering by reinvestment percentage
CREATE INDEX IF NOT EXISTS idx_strategy_config_reinvestment_pct
  ON strategy_config(reinvestment_allocation_pct)
  WHERE is_active = true AND reinvestment_allocation_pct IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN strategy_config.reinvestment_allocation_pct IS
'Percentage of POOL reinvestment this config receives when creating a new cycle. Sum of all active configs must equal 100 if pool is enabled.';
