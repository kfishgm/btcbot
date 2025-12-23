-- Migration: Add buy_grid and buy_index columns for arithmetic grid strategy
-- Date: 2025-09-23
-- Purpose: Support the new arithmetic buy grid strategy from STRATEGY_UPDATED.md

-- Add buy_grid column to store pre-calculated grid levels
ALTER TABLE cycle_state 
ADD COLUMN IF NOT EXISTS buy_grid DECIMAL[] DEFAULT '{}';

-- Add buy_index column to track current position in the grid
ALTER TABLE cycle_state 
ADD COLUMN IF NOT EXISTS buy_index INTEGER DEFAULT 0;

-- Add comment explaining the columns
COMMENT ON COLUMN cycle_state.buy_grid IS 'Pre-calculated buy trigger levels based on ATH and drop percentage';
COMMENT ON COLUMN cycle_state.buy_index IS 'Current position in buy_grid array (next uncrossed level)';

-- Update existing rows to have empty grid and zero index
UPDATE cycle_state 
SET buy_grid = '{}', buy_index = 0 
WHERE buy_grid IS NULL;