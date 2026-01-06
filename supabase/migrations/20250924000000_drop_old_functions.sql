DO $$
BEGIN
    -- Drop existing functions to allow return type changes in subsequent migrations
    DROP FUNCTION IF EXISTS update_state_atomic(UUID, JSONB, INTEGER);
    DROP FUNCTION IF EXISTS update_state_atomic(TEXT, JSONB, INTEGER);
    DROP FUNCTION IF EXISTS update_state_critical(UUID, JSONB);
    DROP FUNCTION IF EXISTS update_state_critical(TEXT, JSONB);
    DROP FUNCTION IF EXISTS batch_update_states(JSONB[]);
    DROP FUNCTION IF EXISTS execute_with_wal(UUID, JSONB, JSONB);
    DROP FUNCTION IF EXISTS execute_with_wal(TEXT, JSONB, JSONB);
    DROP FUNCTION IF EXISTS recover_incomplete_wal(UUID);
    DROP FUNCTION IF EXISTS recover_incomplete_wal(TEXT);
END;
$$;
