-- Add new event types for better monitoring
ALTER TABLE bot_events DROP CONSTRAINT IF EXISTS bot_events_event_type_check;

ALTER TABLE bot_events ADD CONSTRAINT bot_events_event_type_check 
CHECK (event_type IN (
  'START',
  'STOP', 
  'ERROR',
  'CONFIG_UPDATED',
  'WEBSOCKET_CONNECTED',
  'WEBSOCKET_DISCONNECTED',
  'DRIFT_HALT',
  'TRADE_EXECUTED',
  'TRADE_FAILED',
  'ATH_UPDATED',
  'BUY_CONDITION_MET',
  'SELL_CONDITION_MET',
  'BUY_ORDER_PLACED',
  'SELL_ORDER_PLACED',
  'BUY_EXECUTED',
  'SELL_EXECUTED',
  'CANDLE_CLOSED',
  'BUY_ORDER_STATE_UPDATE',
  'SELL_ORDER_STATE_UPDATE',
  'REFERENCE_PRICE_UPDATED',
  'CYCLE_COMPLETE',
  'CYCLE_STATE_INITIALIZED',
  'CYCLE_STATE_CORRUPTION_DETECTED',
  'STRATEGY_PAUSED',
  'STRATEGY_RESUMED'
));

-- Also ensure severity values are consistent
ALTER TABLE bot_events DROP CONSTRAINT IF EXISTS bot_events_severity_check;

ALTER TABLE bot_events ADD CONSTRAINT bot_events_severity_check 
CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'info', 'warning', 'error'));