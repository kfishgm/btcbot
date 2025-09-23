-- Add event types for WAL and advanced state management
ALTER TABLE bot_events DROP CONSTRAINT IF EXISTS bot_events_event_type_check;