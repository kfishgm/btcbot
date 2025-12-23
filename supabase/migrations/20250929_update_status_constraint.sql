-- Update the check constraint on cycle_state.status to allow COMPLETED status
-- Note: idx_one_active_cycle_per_config already enforces one active cycle per config
ALTER TABLE cycle_state DROP CONSTRAINT IF EXISTS cycle_state_status_check;
