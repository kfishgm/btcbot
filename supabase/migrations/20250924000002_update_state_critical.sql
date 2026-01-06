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
