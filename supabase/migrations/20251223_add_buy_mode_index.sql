-- Create index for buy_mode queries on active configs
-- Part 4 of buy mode support migration
CREATE INDEX IF NOT EXISTS idx_strategy_config_buy_mode
ON strategy_config(buy_mode)
WHERE is_active = true;
