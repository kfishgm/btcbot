-- Create execute_with_wal function for write-ahead logging
CREATE OR REPLACE FUNCTION execute_with_wal(
    p_bot_id UUID,
    p_state_update JSONB,
    p_operation_metadata JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_wal_id UUID;
BEGIN
    -- Create WAL entry
    v_wal_id := gen_random_uuid();

    INSERT INTO bot_events (
        event_type,
        severity,
        message,
        metadata
    ) VALUES (
        'WAL_ENTRY',
        'INFO',
        'Write-ahead log entry created',
        jsonb_build_object(
            'wal_id', v_wal_id,
            'bot_id', p_bot_id,
            'state_update', p_state_update,
            'operation_metadata', p_operation_metadata,
            'status', 'pending'
        )
    );

    -- Update state
    PERFORM update_state_atomic(p_bot_id, p_state_update, NULL);

    -- Mark WAL as completed
    INSERT INTO bot_events (
        event_type,
        severity,
        message,
        metadata
    ) VALUES (
        'WAL_COMPLETE',
        'INFO',
        'Write-ahead log entry completed',
        jsonb_build_object(
            'wal_id', v_wal_id,
            'bot_id', p_bot_id,
            'status', 'completed'
        )
    );
END;
$$;
