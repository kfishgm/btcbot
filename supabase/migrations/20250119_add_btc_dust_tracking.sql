-- Add btc_dust column to track dust separately from current cycle BTC
-- This prevents dust from artificially lowering the reference price

ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS btc_dust DECIMAL(20,8) DEFAULT 0;
