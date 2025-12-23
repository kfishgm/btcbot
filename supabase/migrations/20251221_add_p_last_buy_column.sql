-- Add p_last_buy column to cycle_state for geom_modified mode
-- Part 2 of buy mode support migration
ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS p_last_buy NUMERIC NULL;
