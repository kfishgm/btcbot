-- Migration: Separate Reference Prices - Part 2: Drop old column
ALTER TABLE cycle_state
DROP COLUMN IF EXISTS reference_price CASCADE;
