-- Advanced state management functions
-- Includes critical updates, batch operations, and WAL support

-- Function for critical updates with serializable isolation
CREATE OR REPLACE FUNCTION update_state_critical(
  p_bot_id TEXT,
  p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Note: For true serializable isolation, the transaction must be started
  -- with that isolation level from the client side
  
  -- Validate critical constraints before update
  IF (p_updates->>'capital_available')::NUMERIC < 0 THEN
    RAISE EXCEPTION 'Cannot set negative capital';
  END IF;
  
  IF (p_updates->>'purchases_remaining')::INTEGER < 0 THEN
    RAISE EXCEPTION 'Cannot set negative purchases remaining';
  END IF;
  
  -- Perform the update using atomic function
  v_result := update_state_atomic(p_bot_id, p_updates, NULL);
  
  -- Mark as critical update in audit log
  UPDATE bot_events
  SET event_type = 'CRITICAL_UPDATE'
  WHERE id = (
    SELECT id FROM bot_events
    WHERE metadata->>'bot_id' = p_bot_id
    AND event_type = 'STATE_UPDATE'
    ORDER BY created_at DESC
    LIMIT 1
  );
  
  RETURN v_result;
END;
$$;

-- Function for batch updates (multiple bots in single transaction)
CREATE OR REPLACE FUNCTION batch_update_states(
  p_updates JSONB[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_update JSONB;
  v_results JSONB[] := '{}';
  v_bot_id TEXT;
  v_changes JSONB;
  v_result JSONB;
BEGIN
  -- Process each update in the batch atomically
  FOREACH v_update IN ARRAY p_updates
  LOOP
    v_bot_id := v_update->>'bot_id';
    v_changes := v_update->'changes';
    
    -- Update each bot's state
    v_result := update_state_atomic(v_bot_id, v_changes, NULL);
    v_results := array_append(v_results, v_result);
  END LOOP;
  
  -- Log batch update completion
  INSERT INTO bot_events (
    event_type,
    severity,
    message,
    metadata
  ) VALUES (
    'BATCH_UPDATE',
    'info',
    format('Batch update completed for %s bots', array_length(p_updates, 1)),
    jsonb_build_object(
      'count', array_length(p_updates, 1),
      'bot_ids', (SELECT array_agg(u->>'bot_id') FROM unnest(p_updates) AS u)
    )
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'count', array_length(v_results, 1),
    'results', to_jsonb(v_results)
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- All updates rolled back on any error (atomic batch)
    INSERT INTO bot_events (
      event_type,
      severity,
      message,
      metadata
    ) VALUES (
      'BATCH_UPDATE_ERROR',
      'error',
      'Batch update failed: ' || SQLERRM,
      jsonb_build_object(
        'error', SQLERRM,
        'attempted_count', array_length(p_updates, 1)
      )
    );
    RAISE;
END;
$$;

-- Function to execute operation with write-ahead logging
CREATE OR REPLACE FUNCTION execute_with_wal(
  p_bot_id TEXT,
  p_state_update JSONB,
  p_operation_metadata JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_wal_id UUID;
  v_result JSONB;
BEGIN
  -- Create WAL entry before state change
  INSERT INTO bot_events (
    event_type,
    severity,
    message,
    metadata
  ) VALUES (
    'WRITE_AHEAD_LOG',
    'info',
    'WAL entry created for state update',
    jsonb_build_object(
      'bot_id', p_bot_id,
      'status', 'pending',
      'state_update', p_state_update,
      'operation', p_operation_metadata
    )
  ) RETURNING id INTO v_wal_id;
  
  -- Execute the state update
  v_result := update_state_atomic(p_bot_id, p_state_update, NULL);
  
  -- Mark WAL as completed
  UPDATE bot_events
  SET metadata = metadata || jsonb_build_object(
    'status', 'completed',
    'completed_at', NOW()::TEXT
  )
  WHERE id = v_wal_id;
  
  RETURN jsonb_build_object(
    'wal_id', v_wal_id,
    'state', v_result,
    'success', true
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Mark WAL as failed for recovery
    UPDATE bot_events
    SET metadata = metadata || jsonb_build_object(
      'status', 'failed',
      'error', SQLERRM,
      'failed_at', NOW()::TEXT
    )
    WHERE id = v_wal_id;
    RAISE;
END;
$$;

-- Function to recover incomplete WAL entries
CREATE OR REPLACE FUNCTION recover_incomplete_wal(
  p_bot_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_wal_record RECORD;
  v_recovered_count INTEGER := 0;
  v_failed_count INTEGER := 0;
BEGIN
  -- Find pending WAL entries for this bot
  FOR v_wal_record IN
    SELECT id, metadata
    FROM bot_events
    WHERE event_type = 'WRITE_AHEAD_LOG'
    AND metadata->>'bot_id' = p_bot_id
    AND metadata->>'status' = 'pending'
    ORDER BY created_at ASC
  LOOP
    BEGIN
      -- Attempt to apply the state update
      PERFORM update_state_atomic(
        p_bot_id,
        v_wal_record.metadata->'state_update',
        NULL
      );
      
      -- Mark as recovered
      UPDATE bot_events
      SET metadata = metadata || jsonb_build_object(
        'status', 'recovered',
        'recovered_at', NOW()::TEXT
      )
      WHERE id = v_wal_record.id;
      
      v_recovered_count := v_recovered_count + 1;
      
    EXCEPTION
      WHEN OTHERS THEN
        -- Mark as unrecoverable
        UPDATE bot_events
        SET metadata = metadata || jsonb_build_object(
          'status', 'unrecoverable',
          'recovery_error', SQLERRM,
          'recovery_attempted_at', NOW()::TEXT
        )
        WHERE id = v_wal_record.id;
        
        v_failed_count := v_failed_count + 1;
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'recovered', v_recovered_count,
    'failed', v_failed_count,
    'total', v_recovered_count + v_failed_count
  );
END;
$$;

-- Grant permissions on all new functions
GRANT EXECUTE ON FUNCTION update_state_critical(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION batch_update_states(JSONB[]) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_with_wal(TEXT, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION recover_incomplete_wal(TEXT) TO authenticated;