-- Migration: Multi-Config Support
-- Date: 2025-11-21
-- Description: Add indexes and constraints to support multiple active trading configs

-- =========================================================================
-- 1. Ensure one active cycle per strategy config
-- =========================================================================
-- This prevents having multiple READY or HOLDING cycles for the same config
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_cycle_per_config
ON cycle_state(strategy_config_id)
WHERE status IN ('READY', 'HOLDING');

COMMENT ON INDEX idx_one_active_cycle_per_config IS
'Ensures each strategy config has at most one active (READY or HOLDING) cycle';

-- =========================================================================
-- 2. Add index on strategy_config_id for query performance
-- =========================================================================
-- This speeds up queries that filter by strategy_config_id
CREATE INDEX IF NOT EXISTS idx_cycle_state_strategy_config_id
ON cycle_state(strategy_config_id);

COMMENT ON INDEX idx_cycle_state_strategy_config_id IS
'Performance index for filtering cycle_state by strategy_config_id';

-- =========================================================================
-- 3. Ensure unique timeframes across active configs
-- =========================================================================
-- This enforces the business rule: one active config per timeframe
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_timeframe
ON strategy_config(timeframe)
WHERE is_active = true;

COMMENT ON INDEX idx_unique_active_timeframe IS
'Ensures each timeframe can only have one active strategy config';

-- =========================================================================
-- 4. Add index on trades.cycle_id for performance
-- =========================================================================
-- This speeds up queries that aggregate trades by cycle
CREATE INDEX IF NOT EXISTS idx_trades_cycle_id
ON trades(cycle_id);

COMMENT ON INDEX idx_trades_cycle_id IS
'Performance index for filtering trades by cycle_id';

-- =========================================================================
-- 5. Add validation function for total capital allocation
-- =========================================================================
-- This function checks if total allocated capital across all active configs
-- exceeds a percentage of available account balance
CREATE OR REPLACE FUNCTION validate_total_capital_allocation()
RETURNS TRIGGER AS $$
DECLARE
  total_allocated DECIMAL(20,8);
  max_configs INTEGER := 10;
  active_config_count INTEGER;
BEGIN
  -- Count active configs
  SELECT COUNT(*) INTO active_config_count
  FROM strategy_config
  WHERE is_active = true;

  -- Enforce max 10 active configs
  IF active_config_count > max_configs THEN
    RAISE EXCEPTION 'Maximum % active configs allowed. Currently have %',
      max_configs, active_config_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to validate on INSERT/UPDATE
DROP TRIGGER IF EXISTS trigger_validate_capital_allocation ON strategy_config;
CREATE TRIGGER trigger_validate_capital_allocation
  BEFORE INSERT OR UPDATE ON strategy_config
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION validate_total_capital_allocation();

COMMENT ON FUNCTION validate_total_capital_allocation() IS
'Validates that total allocated capital and config count stay within limits';

-- =========================================================================
-- 6. Add helper view for multi-config monitoring
-- =========================================================================
-- This view makes it easy to see all active configs and their states
CREATE OR REPLACE VIEW v_active_configs AS
SELECT
  sc.id as config_id,
  sc.timeframe,
  sc.drop_percentage,
  sc.rise_percentage,
  sc.initial_capital_usdt,
  sc.max_purchases,
  sc.is_active,
  cs.id as cycle_id,
  cs.status as cycle_status,
  cs.capital_available,
  cs.btc_accumulated,
  cs.purchases_remaining,
  cs.ath_price,
  cs.updated_at as cycle_updated_at
FROM strategy_config sc
LEFT JOIN cycle_state cs ON cs.strategy_config_id = sc.id
  AND cs.status IN ('READY', 'HOLDING', 'PAUSED')
WHERE sc.is_active = true
ORDER BY sc.timeframe;

COMMENT ON VIEW v_active_configs IS
'Shows all active strategy configs with their current cycle states';

-- Drop old single-active constraint that prevented multi-config
-- (This was from an older migration and conflicts with multi-config support)
DROP INDEX IF EXISTS idx_cycle_state_single_active;

-- Note: idx_one_active_cycle_per_config allows one active cycle per strategy_config_id
-- This enables multiple configs to run simultaneously
