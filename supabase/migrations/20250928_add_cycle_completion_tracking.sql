-- Migration: Add cycle completion tracking columns
ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS final_profit DECIMAL(20,8),
ADD COLUMN IF NOT EXISTS previous_cycle_id UUID REFERENCES cycle_state(id),
ADD COLUMN IF NOT EXISTS strategy_config_id UUID REFERENCES strategy_config(id);
