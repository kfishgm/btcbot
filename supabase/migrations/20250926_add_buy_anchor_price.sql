-- Add buy_anchor_price column to cycle_state table
-- This column stores the first buy execution price which becomes the anchor for the arithmetic grid

ALTER TABLE public.cycle_state
ADD COLUMN IF NOT EXISTS buy_anchor_price NUMERIC;

COMMENT ON COLUMN public.cycle_state.buy_anchor_price IS 'The execution price of the first buy in a cycle, used as anchor for arithmetic grid calculation';

-- Create index for performance when querying cycles with anchors
CREATE INDEX IF NOT EXISTS idx_cycle_state_buy_anchor
ON public.cycle_state(buy_anchor_price)
WHERE buy_anchor_price IS NOT NULL;