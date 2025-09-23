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
  -- Lock the row for update to prevent concurrent modifications
  SELECT * INTO v_current_state
  FROM cycle_state
  WHERE id = p_bot_id::UUID
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bot state not found: %', p_bot_id;
  END IF;
  
  -- Check version if provided (optimistic locking)
  IF p_expected_version IS NOT NULL AND v_current_state.version != p_expected_version THEN
    RAISE EXCEPTION 'Version conflict. Expected: %, Current: %', 
      p_expected_version, v_current_state.version;
  END IF;
  
  -- Store old state for audit trail
  v_old_state := to_jsonb(v_current_state);
  
  -- Apply updates with version increment
  UPDATE cycle_state
  SET 
    status = COALESCE((p_updates->>'status')::TEXT, status),
    capital_available = COALESCE((p_updates->>'capital_available')::NUMERIC, capital_available),
    btc_accumulated = COALESCE((p_updates->>'btc_accumulated')::NUMERIC, btc_accumulated),
    purchases_remaining = COALESCE((p_updates->>'purchases_remaining')::INTEGER, purchases_remaining),
    reference_price = COALESCE((p_updates->>'reference_price')::NUMERIC, reference_price),
    cost_accum_usdt = COALESCE((p_updates->>'cost_accum_usdt')::NUMERIC, cost_accum_usdt),
    btc_accum_net = COALESCE((p_updates->>'btc_accum_net')::NUMERIC, btc_accum_net),
    ath_price = COALESCE((p_updates->>'ath_price')::NUMERIC, ath_price),
    buy_amount = COALESCE((p_updates->>'buy_amount')::NUMERIC, buy_amount),
    version = version + 1,
    updated_at = NOW()
  WHERE id = p_bot_id::UUID
  RETURNING * INTO v_updated_state;
  
  -- Log the state change for audit trail
  INSERT INTO bot_events (
    event_type,
    severity,
    message,
    metadata
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
    )
  );
  
  -- Return the updated state
  RETURN to_jsonb(v_updated_state);
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error for debugging
    INSERT INTO bot_events (
      event_type,
      severity,
      message,
      metadata
    ) VALUES (
      'STATE_UPDATE_ERROR',
      'error',
      'State update failed: ' || SQLERRM,
      jsonb_build_object(
        'bot_id', p_bot_id,
        'updates', p_updates,
        'error', SQLERRM,
        'error_detail', SQLSTATE
      )
    );
    -- Re-raise the exception to rollback transaction
    RAISE;
END;
$$;