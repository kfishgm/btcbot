-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_bot_events_wal
ON bot_events (event_type, (metadata->>'status'), (metadata->>'bot_id'))
WHERE event_type = 'WRITE_AHEAD_LOG';