-- Add version column for optimistic locking support
-- This enables detection of concurrent updates to prevent lost writes

-- Add version column to cycle_state if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cycle_state' 
    AND column_name = 'version'
  ) THEN
    ALTER TABLE cycle_state ADD COLUMN version INTEGER DEFAULT 1 NOT NULL;
    
    -- Initialize existing rows with version 1
    UPDATE cycle_state SET version = 1 WHERE version IS NULL;
    
    -- Add comment for documentation
    COMMENT ON COLUMN cycle_state.version IS 'Optimistic locking version number - increments on each update';
  END IF;
END $$;

-- Create index for version queries (useful for conflict detection)
CREATE INDEX IF NOT EXISTS idx_cycle_state_version 
ON cycle_state (id, version);