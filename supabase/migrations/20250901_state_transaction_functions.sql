-- Migration: State transaction functions for atomic updates
-- Description: PostgreSQL functions for atomic state management with proper transaction support

-- Drop old invalid functions if they exist
DROP FUNCTION IF EXISTS begin_transaction();
DROP FUNCTION IF EXISTS commit_transaction();
DROP FUNCTION IF EXISTS rollback_transaction();
DROP FUNCTION IF EXISTS begin_transaction_serializable();

-- Add version column to cycle_state for optimistic locking (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cycle_state' 
    AND column_name = 'version'
  ) THEN
    ALTER TABLE cycle_state ADD COLUMN version INTEGER DEFAULT 1;
  END IF;
END $$;

-- Remove the automatic version trigger (we'll handle it explicitly)
DROP TRIGGER IF EXISTS cycle_state_version_trigger ON cycle_state;
DROP FUNCTION IF EXISTS update_cycle_state_version();

-- Function for atomic state update with optimistic locking
CREATE OR REPLACE FUNCTION update_state_atomic(
  p_bot_id TEXT,
  p_updates JSONB,
  p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current_state cycle_state%ROWTYPE;
  v_updated_state cycle_state%ROWTYPE;
  v_old_state JSONB;
BEGIN
  -- Lock the row for update
  SELECT * INTO v_current_state
  FROM cycle_state
  WHERE id = p_bot_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bot state not found: %', p_bot_id;
  END IF;
  
  -- Check version if provided (optimistic locking)
  IF p_expected_version IS NOT NULL AND v_current_state.version != p_expected_version THEN
    RAISE EXCEPTION 'Version conflict. Expected: %, Current: %', 
      p_expected_version, v_current_state.version;
  END IF;
  
  -- Store old state for audit
  v_old_state := to_jsonb(v_current_state);
  
  -- Apply updates dynamically
  UPDATE cycle_state
  SET 
    capital_available = COALESCE((p_updates->>'capital_available')::DECIMAL, capital_available),
    purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
    btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::DECIMAL, btc_accumulated),
    ath_price = COALESCE((p_updates->>'ath_price')::DECIMAL, ath_price),
    reference_price = COALESCE((p_updates->>'reference_price')::DECIMAL, reference_price),
    cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::DECIMAL, cost_accum_usdt),
    btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::DECIMAL, btc_accum_net),
    buy_amount = COALESCE((p_updates->>'buy_amount')::DECIMAL, buy_amount),
    status = COALESCE(p_updates->>'status', status),
    version = version + 1,
    updated_at = NOW()
  WHERE id = p_bot_id
  RETURNING * INTO v_updated_state;
  
  -- Log the state change to bot_events for audit trail
  INSERT INTO bot_events (
    event_type,
    severity,
    message,
    metadata,
    created_at
  ) VALUES (
    'STATE_UPDATE',
    'info',
    'Atomic state update completed',
    jsonb_build_object(
      'bot_id', p_bot_id,
      'old_state', v_old_state,
      'new_state', to_jsonb(v_updated_state),
      'changes', p_updates,
      'version', v_updated_state.version
    ),
    NOW()
  );
  
  -- Return the updated state
  RETURN to_jsonb(v_updated_state);
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error
    INSERT INTO bot_events (
      event_type,
      severity,
      message,
      metadata,
      created_at
    ) VALUES (
      'STATE_UPDATE_ERROR',
      'error',
      'State update failed: ' || SQLERRM,
      jsonb_build_object(
        'bot_id', p_bot_id,
        'updates', p_updates,
        'error', SQLERRM
      ),
      NOW()
    );
    -- Re-raise the exception to rollback
    RAISE;
END;
$$;

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
  -- Set isolation level for this transaction
  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  
  -- Validate critical constraints
  IF (p_updates->>'capital_available')::DECIMAL < 0 THEN
    RAISE EXCEPTION 'Cannot set negative capital';
  END IF;
  
  IF (p_updates->>'purchases_remaining')::INTEGER < 0 THEN
    RAISE EXCEPTION 'Cannot set negative purchases remaining';
  END IF;
  
  -- Perform the update with additional validation
  v_result := update_state_atomic(p_bot_id, p_updates, NULL);
  
  -- Log as critical update
  UPDATE bot_events
  SET event_type = 'CRITICAL_UPDATE'
  WHERE metadata->>'bot_id' = p_bot_id
  AND event_type = 'STATE_UPDATE'
  ORDER BY created_at DESC
  LIMIT 1;
  
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
  -- Process each update in the batch
  FOREACH v_update IN ARRAY p_updates
  LOOP
    v_bot_id := v_update->>'bot_id';
    v_changes := v_update->'changes';
    
    -- Update each bot's state
    v_result := update_state_atomic(v_bot_id, v_changes, NULL);
    v_results := array_append(v_results, v_result);
  END LOOP;
  
  -- Log batch update
  INSERT INTO bot_events (
    event_type,
    severity,
    message,
    metadata,
    created_at
  ) VALUES (
    'BATCH_UPDATE',
    'info',
    format('Batch update completed for %s bots', array_length(p_updates, 1)),
    jsonb_build_object(
      'count', array_length(p_updates, 1),
      'bot_ids', (SELECT array_agg(u->>'bot_id') FROM unnest(p_updates) AS u)
    ),
    NOW()
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'count', array_length(v_results, 1),
    'results', to_jsonb(v_results)
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- All updates are rolled back on any error
    INSERT INTO bot_events (
      event_type,
      severity,
      message,
      metadata,
      created_at
    ) VALUES (
      'BATCH_UPDATE_ERROR',
      'error',
      'Batch update failed: ' || SQLERRM,
      jsonb_build_object(
        'error', SQLERRM,
        'attempted_count', array_length(p_updates, 1)
      ),
      NOW()
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
  v_wal_id BIGINT;
  v_result JSONB;
BEGIN
  -- Create WAL entry
  INSERT INTO bot_events (
    event_type,
    severity,
    message,
    metadata,
    created_at
  ) VALUES (
    'WRITE_AHEAD_LOG',
    'info',
    'WAL entry created for state update',
    jsonb_build_object(
      'bot_id', p_bot_id,
      'status', 'pending',
      'state_update', p_state_update,
      'operation', p_operation_metadata
    ),
    NOW()
  ) RETURNING id INTO v_wal_id;
  
  -- Execute the state update
  v_result := update_state_atomic(p_bot_id, p_state_update, NULL);
  
  -- Mark WAL as completed
  UPDATE bot_events
  SET metadata = metadata || jsonb_build_object('status', 'completed', 'completed_at', NOW())
  WHERE id = v_wal_id;
  
  RETURN jsonb_build_object(
    'wal_id', v_wal_id,
    'state', v_result,
    'success', true
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Mark WAL as failed
    UPDATE bot_events
    SET metadata = metadata || jsonb_build_object(
      'status', 'failed',
      'error', SQLERRM,
      'failed_at', NOW()
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
  -- Find pending WAL entries
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
        'recovered_at', NOW()
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
          'recovery_attempted_at', NOW()
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_cycle_state_version 
ON cycle_state (id, version);

CREATE INDEX IF NOT EXISTS idx_bot_events_wal 
ON bot_events (event_type, (metadata->>'status'), (metadata->>'bot_id'))
WHERE event_type = 'WRITE_AHEAD_LOG';

CREATE INDEX IF NOT EXISTS idx_bot_events_audit
ON bot_events (event_type, (metadata->>'bot_id'), created_at DESC)
WHERE event_type IN ('STATE_UPDATE', 'CRITICAL_UPDATE', 'BATCH_UPDATE');

-- Grant permissions
GRANT EXECUTE ON FUNCTION update_state_atomic(TEXT, JSONB, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION update_state_critical(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION batch_update_states(JSONB[]) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_with_wal(TEXT, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION recover_incomplete_wal(TEXT) TO authenticated;

-- Add comments for documentation
COMMENT ON FUNCTION update_state_atomic IS 'Atomically update bot state with optimistic locking support';
COMMENT ON FUNCTION update_state_critical IS 'Update bot state with serializable isolation for critical operations';
COMMENT ON FUNCTION batch_update_states IS 'Update multiple bot states in a single transaction';
COMMENT ON FUNCTION execute_with_wal IS 'Execute state update with write-ahead logging';
COMMENT ON FUNCTION recover_incomplete_wal IS 'Recover incomplete WAL entries for a bot';