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

-- Create RPC functions for checking balances and exchange connectivity
CREATE OR REPLACE FUNCTION get_account_balances()
RETURNS TABLE(usdt_balance DECIMAL, btc_balance DECIMAL) AS $$
BEGIN
  -- This is a placeholder function that would be implemented with actual exchange API calls
  -- For now, return dummy values for testing
  RETURN QUERY SELECT 1000.0::DECIMAL AS usdt_balance, 0.01::DECIMAL AS btc_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_exchange_connectivity()
RETURNS TABLE(connected BOOLEAN, latency_ms INTEGER) AS $$
BEGIN
  -- This is a placeholder function that would be implemented with actual exchange API calls
  -- For now, return success for testing
  RETURN QUERY SELECT true AS connected, 50 AS latency_ms;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_account_balances() IS 'Get current USDT and BTC balances from exchange';
COMMENT ON FUNCTION check_exchange_connectivity() IS 'Check if exchange API is accessible';