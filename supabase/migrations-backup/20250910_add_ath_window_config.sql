-- Add ATH window configuration to strategy_config table
-- This controls how many candles are used for ATH calculation

-- Add ath_window column with default value per STRATEGY.md
ALTER TABLE strategy_config 
ADD COLUMN ath_window INTEGER DEFAULT 20 
CHECK (ath_window >= 10 AND ath_window <= 500);

-- Update current active config for testnet (100 candles for better testing)
UPDATE strategy_config 
SET ath_window = 100 
WHERE is_active = true;

-- Add comment for documentation
COMMENT ON COLUMN strategy_config.ath_window IS 'Number of candles to use for ATH calculation (default: 20 per STRATEGY.md, testnet: 100)';