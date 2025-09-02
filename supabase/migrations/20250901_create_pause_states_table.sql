-- Create the pause_states table for tracking strategy pause/resume events
CREATE TABLE IF NOT EXISTS pause_states (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('paused', 'active')),
  pause_reason TEXT NOT NULL,
  pause_metadata JSONB DEFAULT '{}',
  paused_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resumed_at TIMESTAMP WITH TIME ZONE,
  resume_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pause_states_status ON pause_states(status);
CREATE INDEX IF NOT EXISTS idx_pause_states_paused_at ON pause_states(paused_at DESC);
CREATE INDEX IF NOT EXISTS idx_pause_states_resumed_at ON pause_states(resumed_at DESC);

-- Add trigger for auto-updating timestamps
CREATE TRIGGER update_pause_states_updated_at
  BEFORE UPDATE ON pause_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE pause_states IS 'History of strategy pause and resume events';
COMMENT ON COLUMN pause_states.status IS 'Current status: paused or active';
COMMENT ON COLUMN pause_states.pause_reason IS 'Human-readable reason for the pause';
COMMENT ON COLUMN pause_states.pause_metadata IS 'Additional metadata about the pause (drift values, error details, etc)';
COMMENT ON COLUMN pause_states.paused_at IS 'Timestamp when the pause occurred';
COMMENT ON COLUMN pause_states.resumed_at IS 'Timestamp when the strategy was resumed';
COMMENT ON COLUMN pause_states.resume_metadata IS 'Metadata about the resume (forced, validated, etc)';

-- Also need to add new event types to bot_events table
ALTER TABLE bot_events 
DROP CONSTRAINT IF EXISTS bot_events_event_type_check;

ALTER TABLE bot_events 
ADD CONSTRAINT bot_events_event_type_check 
CHECK (event_type IN (
  'START', 
  'STOP', 
  'ERROR', 
  'DRIFT_HALT', 
  'TRADE_EXECUTED', 
  'CYCLE_COMPLETE', 
  'CONFIG_UPDATED', 
  'WEBSOCKET_CONNECTED', 
  'WEBSOCKET_DISCONNECTED',
  'STRATEGY_PAUSED',
  'STRATEGY_RESUMED',
  'CYCLE_STATE_INITIALIZED',
  'CYCLE_STATE_CORRUPTION_DETECTED'
));

-- Also update severity levels to use lowercase
ALTER TABLE bot_events 
DROP CONSTRAINT IF EXISTS bot_events_severity_check;

ALTER TABLE bot_events 
ADD CONSTRAINT bot_events_severity_check 
CHECK (severity IN ('info', 'warning', 'error', 'INFO', 'WARNING', 'ERROR'));

-- Note: The actual balance and connectivity checks are implemented in the application layer
-- These database functions are not needed as the pause mechanism uses the existing
-- exchange client and balance tracking from the cycle state manager