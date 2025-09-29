-- Migration: Separate ATH Reference Price and Sell Reference Price
-- Date: 2025-01-29
-- Purpose: Implement clear separation between ATH reference (for first buy) and sell reference (average cost)

-- Step 1: Add new columns for separated reference prices
ALTER TABLE cycle_state
ADD COLUMN IF NOT EXISTS ath_reference_price DECIMAL(20,2),
ADD COLUMN IF NOT EXISTS sell_reference_price DECIMAL(20,2);

-- Step 2: Drop the old reference_price column (starting fresh, no data migration)
ALTER TABLE cycle_state
DROP COLUMN IF EXISTS reference_price CASCADE;

-- Step 3: Update the update_state_atomic function to handle new fields
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
        -- NEW: Handle both reference prices separately
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
        updated_at = NOW(),
        version = COALESCE(version, 0) + 1
    WHERE id = p_bot_id
    RETURNING * INTO v_result;

    -- Return the updated state as JSONB
    RETURN to_jsonb(v_result);
END;
$$ LANGUAGE plpgsql;

-- Step 4: Add comments for documentation
COMMENT ON COLUMN cycle_state.ath_reference_price IS 'Dynamic ATH from rolling N-candle window, used only for first buy trigger';
COMMENT ON COLUMN cycle_state.sell_reference_price IS 'Average cost basis (cost_accum_usdt / btc_accum_net), used for sell trigger calculation';

-- Step 5: Update any views that reference the old reference_price column
-- (Add any view updates here if needed)

-- Step 6: Verify the migration
DO $$
BEGIN
    -- Check that new columns exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cycle_state'
        AND column_name = 'ath_reference_price'
    ) THEN
        RAISE EXCEPTION 'Migration failed: ath_reference_price column not created';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cycle_state'
        AND column_name = 'sell_reference_price'
    ) THEN
        RAISE EXCEPTION 'Migration failed: sell_reference_price column not created';
    END IF;

    -- Check that old column is removed
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cycle_state'
        AND column_name = 'reference_price'
    ) THEN
        RAISE EXCEPTION 'Migration failed: reference_price column still exists';
    END IF;

    RAISE NOTICE 'Migration completed successfully: reference prices separated';
END $$;