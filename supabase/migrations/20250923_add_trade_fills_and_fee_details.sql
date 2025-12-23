-- Add fee_details column to trades table for enhanced fee tracking
ALTER TABLE trades
ADD COLUMN IF NOT EXISTS fee_details JSONB;
