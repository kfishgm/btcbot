-- Add state_version column for forward compatibility
-- Part 3 of buy mode support migration
ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS state_version INTEGER DEFAULT 2;
