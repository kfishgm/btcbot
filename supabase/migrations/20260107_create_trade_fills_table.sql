-- Create trade_fills table for storing individual fill details from orders
-- Each order can have multiple fills when it's executed in parts

CREATE TABLE IF NOT EXISTS trade_fills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    fill_index INTEGER NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL,
    commission DECIMAL(20, 8) NOT NULL,
    commission_asset VARCHAR(10) NOT NULL,
    binance_trade_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique fill per trade
    UNIQUE(trade_id, fill_index)
);

-- Index for fast lookups by trade
CREATE INDEX IF NOT EXISTS idx_trade_fills_trade_id ON trade_fills(trade_id);

-- Grant permissions
GRANT SELECT, INSERT ON trade_fills TO authenticated;
GRANT SELECT, INSERT ON trade_fills TO service_role;
