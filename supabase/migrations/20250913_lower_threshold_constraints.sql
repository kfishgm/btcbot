-- Lower minimum threshold constraints to allow 0.15% for testing
-- This migration allows more sensitive trading thresholds

-- Drop the existing constraints
ALTER TABLE strategy_config DROP CONSTRAINT IF EXISTS strategy_config_drop_percentage_check;
ALTER TABLE strategy_config DROP CONSTRAINT IF EXISTS strategy_config_rise_percentage_check;

-- Add new constraints with lower minimum (0.15% = 0.0015)
-- Previous minimum was 0.0050 (0.5%)
ALTER TABLE strategy_config ADD CONSTRAINT strategy_config_drop_percentage_check 
  CHECK (drop_percentage >= 0.0015 AND drop_percentage <= 0.0800);
  
ALTER TABLE strategy_config ADD CONSTRAINT strategy_config_rise_percentage_check 
  CHECK (rise_percentage >= 0.0015 AND rise_percentage <= 0.0800);

-- Add comments for documentation
COMMENT ON CONSTRAINT strategy_config_drop_percentage_check ON strategy_config IS 
  'Drop percentage must be between 0.15% and 8%';
COMMENT ON CONSTRAINT strategy_config_rise_percentage_check ON strategy_config IS 
  'Rise percentage must be between 0.15% and 8%';