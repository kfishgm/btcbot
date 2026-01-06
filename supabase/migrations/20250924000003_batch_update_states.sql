-- Create batch update function
CREATE OR REPLACE FUNCTION batch_update_states(
    p_updates JSONB[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_update JSONB;
    v_bot_id UUID;
    v_changes JSONB;
BEGIN
    -- Process each update in the batch
    FOREACH v_update IN ARRAY p_updates
    LOOP
        v_bot_id := (v_update->>'bot_id')::UUID;
        v_changes := v_update->'changes';

        -- Use the atomic update function for each bot
        PERFORM update_state_atomic(v_bot_id, v_changes, NULL);
    END LOOP;

    -- Log batch update
    INSERT INTO bot_events (
        event_type,
        severity,
        message,
        metadata
    ) VALUES (
        'BATCH_UPDATE',
        'INFO',
        format('Batch update completed for %s bots', array_length(p_updates, 1)),
        jsonb_build_object(
            'update_count', array_length(p_updates, 1)
        )
    );
END;
$$;
