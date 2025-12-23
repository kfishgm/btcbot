-- Add the status constraint that includes COMPLETED
ALTER TABLE cycle_state ADD CONSTRAINT cycle_state_status_check
CHECK (status IN ('READY', 'HOLDING', 'PAUSED', 'COMPLETED'));
