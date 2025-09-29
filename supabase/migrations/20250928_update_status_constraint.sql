-- Update the check constraint on cycle_state.status to allow COMPLETED status

-- Drop the existing constraint
ALTER TABLE cycle_state DROP CONSTRAINT IF EXISTS cycle_state_status_check;

-- Add the new constraint that includes COMPLETED
ALTER TABLE cycle_state ADD CONSTRAINT cycle_state_status_check
CHECK (status IN ('READY', 'HOLDING', 'PAUSED', 'COMPLETED'));

-- Also update the partial index to exclude COMPLETED cycles
DROP INDEX IF EXISTS idx_cycle_state_single_active;
CREATE UNIQUE INDEX idx_cycle_state_single_active
ON cycle_state(status)
WHERE status IN ('READY', 'HOLDING', 'PAUSED');