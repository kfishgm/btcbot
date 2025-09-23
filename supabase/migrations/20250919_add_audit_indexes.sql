CREATE INDEX IF NOT EXISTS idx_bot_events_audit
ON bot_events (event_type, (metadata->>'bot_id'), created_at DESC)
WHERE event_type IN ('STATE_UPDATE', 'CRITICAL_UPDATE', 'BATCH_UPDATE');