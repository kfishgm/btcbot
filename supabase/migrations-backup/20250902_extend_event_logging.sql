-- Extend bot_events table for comprehensive event logging
-- This migration extends the existing event types and adds new indexes for better query performance

-- First, drop the existing constraint on event_type
ALTER TABLE bot_events 
DROP CONSTRAINT IF EXISTS bot_events_event_type_check;

-- Add new event types for comprehensive logging
ALTER TABLE bot_events 
ADD CONSTRAINT bot_events_event_type_check 
CHECK (event_type IN (
  -- Existing event types
  'START',
  'STOP',
  'ERROR',
  'DRIFT_HALT',
  'TRADE_EXECUTED',
  'CYCLE_COMPLETE',
  'CONFIG_UPDATED',
  'WEBSOCKET_CONNECTED',
  'WEBSOCKET_DISCONNECTED',
  -- New event types for comprehensive logging
  'TRADE_FAILED',
  'PERFORMANCE_METRICS',
  'STRATEGY_METRICS',
  'CUSTOM'
));

-- Add indexes for better query performance
-- Index for querying events by cycle (stored in metadata)
CREATE INDEX IF NOT EXISTS idx_bot_events_cycle_id 
ON bot_events ((metadata->>'cycleId'))
WHERE metadata->>'cycleId' IS NOT NULL;

-- Index for querying trade events
CREATE INDEX IF NOT EXISTS idx_bot_events_trade 
ON bot_events (event_type, (metadata->>'type'))
WHERE event_type IN ('TRADE_EXECUTED', 'TRADE_FAILED');

-- Composite index for time-based queries with type and severity
CREATE INDEX IF NOT EXISTS idx_bot_events_time_type_severity 
ON bot_events (created_at DESC, event_type, severity);

-- Index for test isolation (when running tests)
CREATE INDEX IF NOT EXISTS idx_bot_events_test_run 
ON bot_events ((metadata->>'testRunId'))
WHERE metadata->>'testRunId' IS NOT NULL;

-- Index for performance metrics queries
CREATE INDEX IF NOT EXISTS idx_bot_events_metrics 
ON bot_events (event_type, created_at DESC)
WHERE event_type IN ('PERFORMANCE_METRICS', 'STRATEGY_METRICS', 'CYCLE_COMPLETE');

-- Add comments for documentation
COMMENT ON COLUMN bot_events.event_type IS 'Extended event types including trade failures and metrics';
COMMENT ON COLUMN bot_events.metadata IS 'Structured data including cycleId, trade details, metrics, and test isolation';

-- Function to clean up old events (retention policy)
CREATE OR REPLACE FUNCTION cleanup_old_events(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM bot_events
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
  AND severity != 'ERROR'; -- Keep errors longer for debugging
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get event statistics
CREATE OR REPLACE FUNCTION get_event_statistics(
  start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '24 hours',
  end_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  event_type TEXT,
  severity TEXT,
  event_count BIGINT,
  first_occurrence TIMESTAMP WITH TIME ZONE,
  last_occurrence TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    be.event_type,
    be.severity,
    COUNT(*) as event_count,
    MIN(be.created_at) as first_occurrence,
    MAX(be.created_at) as last_occurrence
  FROM bot_events be
  WHERE be.created_at BETWEEN start_time AND end_time
  GROUP BY be.event_type, be.severity
  ORDER BY event_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION cleanup_old_events TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_statistics TO authenticated;