-- Add missing event types to bot_events table constraint
-- This migration adds new event types that were missing from the original schema

-- Drop the existing constraint
ALTER TABLE bot_events 
  DROP CONSTRAINT IF EXISTS bot_events_event_type_check;

-- Add the updated constraint with all event types
ALTER TABLE bot_events 
  ADD CONSTRAINT bot_events_event_type_check 
  CHECK (event_type = ANY (ARRAY[
    -- System events
    'START'::text, 
    'STOP'::text, 
    'ERROR'::text, 
    'CONFIG_UPDATED'::text,
    'WEBSOCKET_CONNECTED'::text, 
    'WEBSOCKET_DISCONNECTED'::text,
    
    -- Trading events
    'DRIFT_HALT'::text,
    'TRADE_EXECUTED'::text, 
    'TRADE_FAILED'::text,
    'ATH_UPDATED'::text,
    'BUY_CONDITION_MET'::text,
    'SELL_CONDITION_MET'::text,
    'BUY_ORDER_PLACED'::text,
    'SELL_ORDER_PLACED'::text,
    
    -- Cycle events
    'CYCLE_COMPLETE'::text,
    'CYCLE_STATE_INITIALIZED'::text,
    'CYCLE_STATE_CORRUPTION_DETECTED'::text,
    
    -- Strategy events
    'STRATEGY_PAUSED'::text, 
    'STRATEGY_RESUMED'::text
  ]));