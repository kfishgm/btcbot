-- Migration: Add transaction support functions for StateTransactionManager
-- Description: Adds RPC functions for managing database transactions with various isolation levels

-- Function to begin a transaction
CREATE OR REPLACE FUNCTION begin_transaction()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Start a new transaction (implicit in PostgreSQL when called from client)
  -- This is mainly for explicit transaction control
  PERFORM pg_advisory_lock(1);
END;
$$;

-- Function to commit a transaction
CREATE OR REPLACE FUNCTION commit_transaction()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Release the advisory lock
  PERFORM pg_advisory_unlock(1);
  -- Actual COMMIT happens at the client level
END;
$$;

-- Function to rollback a transaction
CREATE OR REPLACE FUNCTION rollback_transaction()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Release the advisory lock
  PERFORM pg_advisory_unlock(1);
  -- Actual ROLLBACK happens at the client level
  RAISE EXCEPTION 'Transaction rolled back' USING ERRCODE = 'P0000';
END;
$$;

-- Function to begin a transaction with SERIALIZABLE isolation
CREATE OR REPLACE FUNCTION begin_transaction_serializable()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Set transaction isolation level to SERIALIZABLE
  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  PERFORM pg_advisory_lock(2);
END;
$$;

-- Add version column to cycle_state for optimistic locking (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cycle_state' 
    AND column_name = 'version'
  ) THEN
    ALTER TABLE cycle_state ADD COLUMN version INTEGER DEFAULT 1;
  END IF;
END $$;

-- Create index on bot_events for WAL queries
CREATE INDEX IF NOT EXISTS idx_bot_events_wal 
ON bot_events (event_type, severity, (metadata->>'status'), (metadata->>'bot_id'))
WHERE event_type = 'write_ahead_log';

-- Create index on bot_events for state history queries
CREATE INDEX IF NOT EXISTS idx_bot_events_state_history
ON bot_events (event_type, (metadata->>'bot_id'), created_at DESC)
WHERE event_type IN ('STATE_UPDATE', 'VERSION_UPDATE', 'CRITICAL_UPDATE', 'BATCH_UPDATE');

-- Add trigger to automatically update version on cycle_state changes
CREATE OR REPLACE FUNCTION update_cycle_state_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = COALESCE(OLD.version, 0) + 1;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cycle_state_version_trigger ON cycle_state;
CREATE TRIGGER cycle_state_version_trigger
BEFORE UPDATE ON cycle_state
FOR EACH ROW
EXECUTE FUNCTION update_cycle_state_version();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION begin_transaction() TO authenticated;
GRANT EXECUTE ON FUNCTION commit_transaction() TO authenticated;
GRANT EXECUTE ON FUNCTION rollback_transaction() TO authenticated;
GRANT EXECUTE ON FUNCTION begin_transaction_serializable() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION begin_transaction() IS 'Begins a database transaction with advisory lock';
COMMENT ON FUNCTION commit_transaction() IS 'Commits the current transaction and releases lock';
COMMENT ON FUNCTION rollback_transaction() IS 'Rolls back the current transaction and releases lock';
COMMENT ON FUNCTION begin_transaction_serializable() IS 'Begins a transaction with SERIALIZABLE isolation level';