-- Add btc_dust column to track dust separately from current cycle BTC
-- This prevents dust from artificially lowering the reference price

-- Add btc_dust column
ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS btc_dust DECIMAL(20,8) DEFAULT 0;

-- Add comment explaining the field
COMMENT ON COLUMN cycle_state.btc_dust IS 'BTC dust from previous cycles not backed by current USDT';

-- Drop existing functions first to avoid return type conflicts
DROP FUNCTION IF EXISTS update_state_atomic(UUID, JSONB, INTEGER);
DROP FUNCTION IF EXISTS update_state_critical(UUID, JSONB);

-- Update the update_state_atomic function to handle btc_dust
CREATE OR REPLACE FUNCTION update_state_atomic(
    p_bot_id UUID,
    p_updates JSONB,
    p_expected_version INTEGER DEFAULT NULL
) RETURNS cycle_state AS $$
DECLARE
    v_result cycle_state;
    v_current_version INTEGER;
    v_buy_grid DECIMAL[];
BEGIN
    -- Parse buy_grid if provided
    IF p_updates ? 'buy_grid' THEN
        IF p_updates->>'buy_grid' IS NULL OR p_updates->>'buy_grid' = 'null' THEN
            v_buy_grid := NULL;
        ELSE
            v_buy_grid := ARRAY(
                SELECT (elem::TEXT)::DECIMAL
                FROM jsonb_array_elements(p_updates->'buy_grid') elem
            );
        END IF;
    END IF;

    -- Lock and update with optional version check
    IF p_expected_version IS NOT NULL THEN
        UPDATE cycle_state
        SET
            btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::DECIMAL, btc_accumulated),
            cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::DECIMAL, cost_accum_usdt),
            btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::DECIMAL, btc_accum_net),
            btc_dust = COALESCE((p_updates->>'btc_dust')::DECIMAL, btc_dust),
            capital_available = COALESCE((p_updates->>'capital_available')::DECIMAL, capital_available),
            purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
            reference_price = COALESCE((p_updates->>'reference_price')::DECIMAL, reference_price),
            ath_price = COALESCE((p_updates->>'ath_price')::DECIMAL, ath_price),
            status = COALESCE(p_updates->>'status', status),
            buy_index = COALESCE((p_updates->>'buy_index')::INTEGER, buy_index),
            buy_grid = CASE
                WHEN p_updates ? 'buy_grid' THEN v_buy_grid
                ELSE buy_grid
            END,
            buy_amount = COALESCE((p_updates->>'buy_amount')::DECIMAL, buy_amount),
            buy_anchor_price = COALESCE((p_updates->>'buy_anchor_price')::DECIMAL, buy_anchor_price),
            updated_at = NOW(),
            version = COALESCE(version, 0) + 1
        WHERE id = p_bot_id
        AND version = p_expected_version
        RETURNING * INTO v_result;

        IF NOT FOUND THEN
            SELECT version INTO v_current_version
            FROM cycle_state
            WHERE id = p_bot_id;

            RAISE EXCEPTION 'Version conflict. Expected: %, Current: %',
                p_expected_version, v_current_version;
        END IF;
    ELSE
        -- Update without version check
        UPDATE cycle_state
        SET
            btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::DECIMAL, btc_accumulated),
            cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::DECIMAL, cost_accum_usdt),
            btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::DECIMAL, btc_accum_net),
            btc_dust = COALESCE((p_updates->>'btc_dust')::DECIMAL, btc_dust),
            capital_available = COALESCE((p_updates->>'capital_available')::DECIMAL, capital_available),
            purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
            reference_price = COALESCE((p_updates->>'reference_price')::DECIMAL, reference_price),
            ath_price = COALESCE((p_updates->>'ath_price')::DECIMAL, ath_price),
            status = COALESCE(p_updates->>'status', status),
            buy_index = COALESCE((p_updates->>'buy_index')::INTEGER, buy_index),
            buy_grid = CASE
                WHEN p_updates ? 'buy_grid' THEN v_buy_grid
                ELSE buy_grid
            END,
            buy_amount = COALESCE((p_updates->>'buy_amount')::DECIMAL, buy_amount),
            buy_anchor_price = COALESCE((p_updates->>'buy_anchor_price')::DECIMAL, buy_anchor_price),
            updated_at = NOW(),
            version = COALESCE(version, 0) + 1
        WHERE id = p_bot_id
        RETURNING * INTO v_result;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Update the update_state_critical function to handle btc_dust
CREATE OR REPLACE FUNCTION update_state_critical(
    p_bot_id UUID,
    p_updates JSONB
) RETURNS cycle_state AS $$
DECLARE
    v_result cycle_state;
    v_buy_grid DECIMAL[];
BEGIN
    -- Parse buy_grid if provided
    IF p_updates ? 'buy_grid' THEN
        IF p_updates->>'buy_grid' IS NULL OR p_updates->>'buy_grid' = 'null' THEN
            v_buy_grid := NULL;
        ELSE
            v_buy_grid := ARRAY(
                SELECT (elem::TEXT)::DECIMAL
                FROM jsonb_array_elements(p_updates->'buy_grid') elem
            );
        END IF;
    END IF;

    -- Use SERIALIZABLE isolation for critical updates
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    UPDATE cycle_state
    SET
        btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::DECIMAL, btc_accumulated),
        cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::DECIMAL, cost_accum_usdt),
        btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::DECIMAL, btc_accum_net),
        btc_dust = COALESCE((p_updates->>'btc_dust')::DECIMAL, btc_dust),
        capital_available = COALESCE((p_updates->>'capital_available')::DECIMAL, capital_available),
        purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
        reference_price = COALESCE((p_updates->>'reference_price')::DECIMAL, reference_price),
        ath_price = COALESCE((p_updates->>'ath_price')::DECIMAL, ath_price),
        status = COALESCE(p_updates->>'status', status),
        buy_index = COALESCE((p_updates->>'buy_index')::INTEGER, buy_index),
        buy_grid = CASE
            WHEN p_updates ? 'buy_grid' THEN v_buy_grid
            ELSE buy_grid
        END,
        buy_amount = COALESCE((p_updates->>'buy_amount')::DECIMAL, buy_amount),
        buy_anchor_price = COALESCE((p_updates->>'buy_anchor_price')::DECIMAL, buy_anchor_price),
        updated_at = NOW(),
        version = COALESCE(version, 0) + 1
    WHERE id = p_bot_id
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bot state not found: %', p_bot_id;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;