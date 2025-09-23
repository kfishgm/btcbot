-- Simple atomic state update function
CREATE OR REPLACE FUNCTION update_state_atomic(
  p_bot_id TEXT,
  p_updates JSONB,
  p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result cycle_state%ROWTYPE;
BEGIN
  -- Apply updates and return the updated state
  UPDATE cycle_state
  SET 
    status = COALESCE((p_updates->>'status')::TEXT, status),
    capital_available = COALESCE((p_updates->>'capital_available')::FLOAT, capital_available),
    btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::FLOAT, btc_accumulated),
    purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
    reference_price = COALESCE((p_updates->>'reference_price')::FLOAT, reference_price),
    cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::FLOAT, cost_accum_usdt),
    btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::FLOAT, btc_accum_net),
    ath_price = COALESCE((p_updates->>'ath_price')::FLOAT, ath_price),
    buy_amount = COALESCE((p_updates->>'buy_amount')::FLOAT, buy_amount),
    updated_at = NOW()
  WHERE id = p_bot_id::UUID
  RETURNING * INTO v_result;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bot state not found: %', p_bot_id;
  END IF;
  
  RETURN to_jsonb(v_result);
END;
$$;