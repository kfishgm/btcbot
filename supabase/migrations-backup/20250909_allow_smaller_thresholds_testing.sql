-- Temporary migration for testing with 0.5% thresholds
-- This can be reverted after testing

-- Drop existing constraints
ALTER TABLE strategy_config 
  DROP CONSTRAINT IF EXISTS strategy_config_drop_percentage_check,
  DROP CONSTRAINT IF EXISTS strategy_config_rise_percentage_check;

-- Add new constraints allowing 0.5% minimum (0.005)
ALTER TABLE strategy_config 
  ADD CONSTRAINT strategy_config_drop_percentage_check 
    CHECK (drop_percentage >= 0.0050 AND drop_percentage <= 0.0800),
  ADD CONSTRAINT strategy_config_rise_percentage_check 
    CHECK (rise_percentage >= 0.0050 AND rise_percentage <= 0.0800);

-- Update comment to reflect temporary change
COMMENT ON COLUMN strategy_config.drop_percentage IS 'Percentage drop to trigger buy (0.005 = 0.5%) - TEMPORARILY lowered for testing';
COMMENT ON COLUMN strategy_config.rise_percentage IS 'Percentage rise to trigger sell (0.005 = 0.5%) - TEMPORARILY lowered for testing';