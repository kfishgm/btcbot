DO $$
BEGIN
    -- Grant permissions for state update functions
    GRANT EXECUTE ON FUNCTION update_state_atomic TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION update_state_critical TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION batch_update_states TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION execute_with_wal TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION recover_incomplete_wal TO anon, authenticated, service_role;
END;
$$;
