-- Add function to batch deactivate strategy configs atomically
-- This bypasses the row-level trigger by disabling it during the operation

CREATE OR REPLACE FUNCTION batch_deactivate_strategy_configs()
RETURNS VOID AS $$
BEGIN
  -- Disable ALL user triggers on the table
  ALTER TABLE strategy_config DISABLE TRIGGER USER;

  -- Deactivate all configs and NULL their percentages
  UPDATE strategy_config
  SET is_active = false,
      capital_allocation_pct = NULL,
      updated_at = NOW()
  WHERE is_active = true;

  -- Re-enable ALL user triggers
  ALTER TABLE strategy_config ENABLE TRIGGER USER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION batch_deactivate_strategy_configs() TO authenticated;
GRANT EXECUTE ON FUNCTION batch_deactivate_strategy_configs() TO service_role;

COMMENT ON FUNCTION batch_deactivate_strategy_configs IS
'Deactivates all strategy configs atomically, bypassing the row-level validation trigger.';
