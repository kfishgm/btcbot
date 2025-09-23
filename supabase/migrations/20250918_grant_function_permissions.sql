-- Grant permissions for all state management functions

GRANT EXECUTE ON FUNCTION update_state_atomic(TEXT, JSONB, INTEGER) TO authenticated, anon, service_role;