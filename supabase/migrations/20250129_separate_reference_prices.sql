-- Migration: Separate ATH Reference Price and Sell Reference Price
-- Part 1: Add new columns
ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS ath_reference_price DECIMAL(20,2),
ADD COLUMN IF NOT EXISTS sell_reference_price DECIMAL(20,2);
