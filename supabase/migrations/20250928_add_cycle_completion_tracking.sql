-- Migration: Add cycle completion tracking and lineage
-- This migration adds support for creating new cycles after completion instead of reusing the same cycle ID

-- Note: Status column is TEXT, not an enum, so no need to add enum values

-- Add new columns for cycle completion tracking
ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS final_profit DECIMAL(20,8),
ADD COLUMN IF NOT EXISTS previous_cycle_id UUID REFERENCES cycle_state(id),
ADD COLUMN IF NOT EXISTS strategy_config_id UUID REFERENCES strategy_config(id);

-- Add comment for documentation
COMMENT ON COLUMN cycle_state.completed_at IS 'Timestamp when the cycle was completed';
COMMENT ON COLUMN cycle_state.final_profit IS 'Final profit/loss for the completed cycle';
COMMENT ON COLUMN cycle_state.previous_cycle_id IS 'Reference to the previous cycle for lineage tracking';
COMMENT ON COLUMN cycle_state.strategy_config_id IS 'Reference to the strategy configuration used for this cycle';

-- Create index for finding active cycles quickly
CREATE INDEX IF NOT EXISTS idx_cycle_state_active
ON cycle_state(status)
WHERE status IN ('READY', 'HOLDING', 'PAUSED');

-- Create index for cycle lineage tracking
CREATE INDEX IF NOT EXISTS idx_cycle_state_lineage
ON cycle_state(previous_cycle_id)
WHERE previous_cycle_id IS NOT NULL;

-- Create index for finding cycles by strategy config
CREATE INDEX IF NOT EXISTS idx_cycle_state_strategy
ON cycle_state(strategy_config_id)
WHERE strategy_config_id IS NOT NULL;

-- Add a partial unique index to ensure only one active cycle at a time
-- This prevents multiple non-completed cycles from existing simultaneously
CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_state_single_active
ON cycle_state(status)
WHERE status IN ('READY', 'HOLDING', 'PAUSED');

-- Update existing cycles to link to active strategy config (if any)
UPDATE cycle_state cs
SET strategy_config_id = (
  SELECT id FROM strategy_config
  WHERE is_active = true
  LIMIT 1
)
WHERE cs.strategy_config_id IS NULL
AND cs.status IN ('READY', 'HOLDING', 'PAUSED');

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON cycle_state TO authenticated;
GRANT SELECT, INSERT, UPDATE ON cycle_state TO anon;
GRANT SELECT, INSERT, UPDATE ON cycle_state TO service_role;