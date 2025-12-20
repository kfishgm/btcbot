-- Add capital_allocation_pct column to strategy_config
-- Allows flexible capital distribution across timeframes

-- Add the column (nullable for backwards compatibility)
ALTER TABLE strategy_config 
ADD COLUMN IF NOT EXISTS capital_allocation_pct DECIMAL(5,2) DEFAULT NULL;

-- Add check constraint: percentage must be between 0 and 100
ALTER TABLE strategy_config
DROP CONSTRAINT IF EXISTS check_capital_allocation_pct_range;

ALTER TABLE strategy_config
ADD CONSTRAINT check_capital_allocation_pct_range
CHECK (capital_allocation_pct IS NULL OR (capital_allocation_pct >= 0 AND capital_allocation_pct <= 100));

-- Create validation function for percentage sum
CREATE OR REPLACE FUNCTION validate_capital_allocation_percentages()
RETURNS TRIGGER AS $$
DECLARE
  total_pct DECIMAL(5,2);
  active_count INTEGER;
BEGIN
  -- Count active configs with non-null percentages
  SELECT COUNT(*), COALESCE(SUM(capital_allocation_pct), 0)
  INTO active_count, total_pct
  FROM strategy_config
  WHERE is_active = true 
    AND capital_allocation_pct IS NOT NULL
    AND (NEW.id IS NULL OR id != NEW.id); -- Exclude the row being inserted/updated
  
  -- Add the new/updated row's percentage if it's active and has a percentage
  IF NEW.is_active = true AND NEW.capital_allocation_pct IS NOT NULL THEN
    total_pct := total_pct + NEW.capital_allocation_pct;
    active_count := active_count + 1;
  END IF;
  
  -- If any active config has a percentage set, all must have percentages and sum to 100%
  IF active_count > 0 THEN
    -- Check if any active config is missing a percentage
    IF EXISTS (
      SELECT 1 FROM strategy_config 
      WHERE is_active = true 
        AND capital_allocation_pct IS NULL 
        AND (NEW.id IS NULL OR id != NEW.id)
    ) OR (NEW.is_active = true AND NEW.capital_allocation_pct IS NULL AND active_count > 0) THEN
      RAISE EXCEPTION 'All active configs must have capital_allocation_pct set if any config uses it';
    END IF;
    
    -- Check if sum is exactly 100%
    IF total_pct != 100.00 THEN
      RAISE EXCEPTION 'Sum of capital_allocation_pct for active configs must equal 100%% (current: %)', total_pct;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to validate percentages
DROP TRIGGER IF EXISTS trigger_validate_capital_allocation_percentages ON strategy_config;
CREATE TRIGGER trigger_validate_capital_allocation_percentages
BEFORE INSERT OR UPDATE ON strategy_config
FOR EACH ROW
EXECUTE FUNCTION validate_capital_allocation_percentages();

-- Add comment
COMMENT ON COLUMN strategy_config.capital_allocation_pct IS 
'Percentage of total capital pool to allocate to this config (0-100). If set, all active configs must have percentages that sum to 100%.';
