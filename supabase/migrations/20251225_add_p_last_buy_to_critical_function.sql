-- Migration: Add p_last_buy to update_state_critical function
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
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    IF p_updates ? 'buy_grid' THEN
        IF p_updates->'buy_grid' IS NOT NULL AND jsonb_typeof(p_updates->'buy_grid') = 'array' THEN
            SELECT ARRAY(
                SELECT (value::text)::DECIMAL
                FROM jsonb_array_elements(p_updates->'buy_grid')
            ) INTO v_buy_grid;
        ELSE
            v_buy_grid := NULL;
        END IF;
    END IF;

    IF (p_updates->>'capital_available')::DECIMAL < 0 THEN
        RAISE EXCEPTION 'Cannot set negative capital';
    END IF;

    IF (p_updates->>'purchases_remaining')::INTEGER < 0 THEN
        RAISE EXCEPTION 'Cannot set negative purchases remaining';
    END IF;

    UPDATE cycle_state
    SET
        btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::DECIMAL, btc_accumulated),
        cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::DECIMAL, cost_accum_usdt),
        btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::DECIMAL, btc_accum_net),
        btc_dust = COALESCE((p_updates->>'btc_dust')::DECIMAL, btc_dust),
        capital_available = COALESCE((p_updates->>'capital_available')::DECIMAL, capital_available),
        purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
        ath_reference_price = COALESCE((p_updates->>'ath_reference_price')::DECIMAL, ath_reference_price),
        sell_reference_price = COALESCE((p_updates->>'sell_reference_price')::DECIMAL, sell_reference_price),
        ath_price = COALESCE((p_updates->>'ath_price')::DECIMAL, ath_price),
        buy_anchor_price = COALESCE((p_updates->>'buy_anchor_price')::DECIMAL, buy_anchor_price),
        status = COALESCE(p_updates->>'status', status),
        buy_index = COALESCE((p_updates->>'buy_index')::INTEGER, buy_index),
        buy_grid = CASE
            WHEN p_updates ? 'buy_grid' THEN v_buy_grid
            ELSE buy_grid
        END,
        buy_amount = COALESCE((p_updates->>'buy_amount')::DECIMAL, buy_amount),
        p_last_buy = COALESCE((p_updates->>'p_last_buy')::DECIMAL, p_last_buy),
        updated_at = NOW(),
        version = COALESCE(version, 0) + 1
    WHERE id = p_bot_id
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bot state not found: %', p_bot_id;
    END IF;

    INSERT INTO bot_events (event_type, severity, message, metadata)
    VALUES ('CRITICAL_UPDATE', 'info', 'Critical state update performed',
            jsonb_build_object('bot_id', p_bot_id, 'updates', p_updates));

    RETURN to_jsonb(v_result);
END;
$$;
