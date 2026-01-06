-- Fix batch_activate_strategy_configs to disable ALL triggers during activation

CREATE OR REPLACE FUNCTION batch_activate_strategy_configs(config_ids UUID[])
RETURNS VOID AS $$
DECLARE
  total_pct DECIMAL(5,2);
  active_count INTEGER;
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

  -- Disable ALL user triggers on the table
  ALTER TABLE strategy_config DISABLE TRIGGER USER;

  -- Activate all configs at once
  UPDATE strategy_config
  SET is_active = true, updated_at = NOW()
  WHERE id = ANY(config_ids);

  -- Re-enable ALL user triggers
  ALTER TABLE strategy_config ENABLE TRIGGER USER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
