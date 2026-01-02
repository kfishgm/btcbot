-- Migration: Add p_last_buy to update_state_atomic function
-- The column was added in 20251221_add_p_last_buy_column.sql but the function was not updated
CREATE OR REPLACE FUNCTION update_state_atomic(
    p_bot_id UUID,
    p_updates JSONB,
    p_expected_version INTEGER DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_current_version INTEGER;
    v_result RECORD;
    v_buy_grid DECIMAL[];
BEGIN
    -- Handle buy_grid array conversion from JSONB to DECIMAL[]
    IF p_updates ? 'buy_grid' THEN
        -- Check if buy_grid is not null AND is an array type
        IF p_updates->'buy_grid' IS NOT NULL AND jsonb_typeof(p_updates->'buy_grid') = 'array' THEN
            -- Convert JSONB array to DECIMAL array
            SELECT ARRAY(
                SELECT (value::text)::DECIMAL
                FROM jsonb_array_elements(p_updates->'buy_grid')
            ) INTO v_buy_grid;
        ELSE
            -- If buy_grid is null or not an array, set it to NULL
            v_buy_grid := NULL;
        END IF;
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

    RETURN to_jsonb(v_result);
END;
$$ LANGUAGE plpgsql;
