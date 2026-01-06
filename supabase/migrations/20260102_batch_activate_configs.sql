-- Add function to batch activate strategy configs atomically
-- This bypasses the row-level trigger by disabling it during the operation

CREATE OR REPLACE FUNCTION batch_activate_strategy_configs(config_ids UUID[])
RETURNS VOID AS $$
DECLARE
  total_pct DECIMAL(5,2);
  active_count INTEGER;
  trigger_exists BOOLEAN;
BEGIN
  -- First, validate that the configs to be activated sum to 100%
  SELECT COUNT(*), COALESCE(SUM(capital_allocation_pct), 0)
  INTO active_count, total_pct
  FROM strategy_config
  WHERE id = ANY(config_ids)
    AND capital_allocation_pct IS NOT NULL;

  -- If using percentages, validate sum = 100%
  IF active_count > 0 THEN
    -- Check all configs have percentages
    IF EXISTS (
      SELECT 1 FROM strategy_config
      WHERE id = ANY(config_ids)
        AND capital_allocation_pct IS NULL
    ) THEN
      RAISE EXCEPTION 'All configs to activate must have capital_allocation_pct set if any config uses it';
    END IF;

    -- Check sum = 100%
    IF total_pct != 100.00 THEN
      RAISE EXCEPTION 'Sum of capital_allocation_pct for configs must equal 100%% (current: %)', total_pct;
    END IF;
  END IF;

  -- Check if the trigger exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'validate_capital_allocation_percentages_trigger'
  ) INTO trigger_exists;

  -- Disable the trigger temporarily (only if it exists)
  IF trigger_exists THEN
    ALTER TABLE strategy_config DISABLE TRIGGER validate_capital_allocation_percentages_trigger;
  END IF;

  -- Activate all configs at once
  UPDATE strategy_config
  SET is_active = true, updated_at = NOW()
  WHERE id = ANY(config_ids);

  -- Re-enable the trigger (only if it exists)
  IF trigger_exists THEN
    ALTER TABLE strategy_config ENABLE TRIGGER validate_capital_allocation_percentages_trigger;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION batch_activate_strategy_configs(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION batch_activate_strategy_configs(UUID[]) TO service_role;

COMMENT ON FUNCTION batch_activate_strategy_configs IS
'Activates multiple strategy configs atomically, bypassing the row-level validation trigger. Validates sum=100% before activating.';
