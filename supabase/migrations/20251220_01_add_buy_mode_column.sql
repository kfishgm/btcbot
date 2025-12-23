-- Add buy_mode column to strategy_config
-- Part 1 of buy mode support migration
ALTER TABLE strategy_config
ADD COLUMN IF NOT EXISTS buy_mode TEXT DEFAULT 'arithmetic';
