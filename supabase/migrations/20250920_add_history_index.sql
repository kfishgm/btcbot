CREATE INDEX IF NOT EXISTS idx_bot_events_history
ON bot_events ((metadata->>'bot_id'), created_at DESC)
WHERE metadata IS NOT NULL;