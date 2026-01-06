-- Remove the upper limit on max_purchases (was 30, now unlimited)
ALTER TABLE strategy_config DROP CONSTRAINT IF EXISTS strategy_config_max_purchases_check;
ALTER TABLE strategy_config ADD CONSTRAINT strategy_config_max_purchases_check CHECK (max_purchases >= 1);
