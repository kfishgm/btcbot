-- Create the update_state_atomic function for atomic state updates
CREATE OR REPLACE FUNCTION update_state_atomic(
    p_bot_id UUID,
    p_updates JSONB,
    p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_version INTEGER;
    v_result RECORD;
    v_buy_grid DECIMAL[];
BEGIN
    -- Handle buy_grid array conversion from JSONB to DECIMAL[]
    IF p_updates ? 'buy_grid' AND p_updates->'buy_grid' IS NOT NULL THEN
        -- Convert JSONB array to DECIMAL array
        SELECT ARRAY(
            SELECT (value::text)::DECIMAL 
            FROM jsonb_array_elements(p_updates->'buy_grid')
        ) INTO v_buy_grid;
    END IF;

    -- Check version if expected version provided
    IF p_expected_version IS NOT NULL THEN
        SELECT version INTO v_current_version
        FROM cycle_state
        WHERE id = p_bot_id
        FOR UPDATE;
        
        IF v_current_version != p_expected_version THEN
            RAISE EXCEPTION 'Version conflict. Expected: %, Current: %', 
                p_expected_version, v_current_version;
        END IF;
    END IF;
    
    -- Build and execute dynamic UPDATE statement
    UPDATE cycle_state
    SET 
        btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::DECIMAL, btc_accumulated),
        cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::DECIMAL, cost_accum_usdt),
        btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::DECIMAL, btc_accum_net),
        capital_available = COALESCE((p_updates->>'capital_available')::DECIMAL, capital_available),
        purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
        reference_price = COALESCE((p_updates->>'reference_price')::DECIMAL, reference_price),
        ath_price = COALESCE((p_updates->>'ath_price')::DECIMAL, ath_price),
        status = COALESCE(p_updates->>'status', status),
        buy_index = COALESCE((p_updates->>'buy_index')::INTEGER, buy_index),
        buy_grid = COALESCE(v_buy_grid, buy_grid),
        buy_amount = COALESCE((p_updates->>'buy_amount')::DECIMAL, buy_amount),
        updated_at = NOW(),
        version = COALESCE(version, 0) + 1
    WHERE id = p_bot_id
    RETURNING * INTO v_result;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bot state not found: %', p_bot_id;
    END IF;
    
    -- Log the update
    INSERT INTO bot_events (
        event_type,
        severity,
        message,
        metadata
    ) VALUES (
        'STATE_UPDATE',
        'INFO',
        'State updated atomically',
        jsonb_build_object(
            'bot_id', p_bot_id,
            'updates', p_updates,
            'version', v_result.version
        )
    );
    
    -- Return the updated state as JSONB
    RETURN row_to_json(v_result)::JSONB;
END;
$$;

-- Create update_state_critical for critical updates with serializable isolation
CREATE OR REPLACE FUNCTION update_state_critical(
    p_bot_id UUID,
    p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result RECORD;
    v_buy_grid DECIMAL[];
BEGIN
    -- Set transaction isolation level for critical updates
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    
    -- Handle buy_grid array conversion
    IF p_updates ? 'buy_grid' AND p_updates->'buy_grid' IS NOT NULL THEN
        SELECT ARRAY(
            SELECT (value::text)::DECIMAL 
            FROM jsonb_array_elements(p_updates->'buy_grid')
        ) INTO v_buy_grid;
    END IF;
    
    -- Validate critical constraints
    IF (p_updates->>'capital_available')::DECIMAL < 0 THEN
        RAISE EXCEPTION 'Cannot set negative capital';
    END IF;
    
    IF (p_updates->>'purchases_remaining')::INTEGER < 0 THEN
        RAISE EXCEPTION 'Cannot set negative purchases remaining';
    END IF;
    
    -- Perform the update
    UPDATE cycle_state
    SET 
        btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::DECIMAL, btc_accumulated),
        cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::DECIMAL, cost_accum_usdt),
        btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::DECIMAL, btc_accum_net),
        capital_available = COALESCE((p_updates->>'capital_available')::DECIMAL, capital_available),
        purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
        reference_price = COALESCE((p_updates->>'reference_price')::DECIMAL, reference_price),
        ath_price = COALESCE((p_updates->>'ath_price')::DECIMAL, ath_price),
        status = COALESCE(p_updates->>'status', status),
        buy_index = COALESCE((p_updates->>'buy_index')::INTEGER, buy_index),
        buy_grid = COALESCE(v_buy_grid, buy_grid),
        buy_amount = COALESCE((p_updates->>'buy_amount')::DECIMAL, buy_amount),
        updated_at = NOW(),
        version = COALESCE(version, 0) + 1
    WHERE id = p_bot_id
    RETURNING * INTO v_result;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bot state not found: %', p_bot_id;
    END IF;
    
    -- Log critical update
    INSERT INTO bot_events (
        event_type,
        severity,
        message,
        metadata
    ) VALUES (
        'CRITICAL_UPDATE',
        'INFO',
        'Critical state update performed',
        jsonb_build_object(
            'bot_id', p_bot_id,
            'updates', p_updates,
            'version', v_result.version
        )
    );
    
    RETURN row_to_json(v_result)::JSONB;
END;
$$;

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

-- Create recover_incomplete_wal function
CREATE OR REPLACE FUNCTION recover_incomplete_wal(
    p_bot_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_recovered INTEGER := 0;
    v_failed INTEGER := 0;
BEGIN
    -- For now, just return zeros as we don't have actual WAL recovery logic
    -- This would be implemented based on your specific recovery requirements
    
    RETURN jsonb_build_object(
        'recovered', v_recovered,
        'failed', v_failed,
        'total', v_recovered + v_failed
    );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION update_state_atomic TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_state_critical TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION batch_update_states TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION execute_with_wal TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION recover_incomplete_wal TO anon, authenticated, service_role;