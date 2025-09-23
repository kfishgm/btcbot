-- Add fee_details column to trades table for enhanced fee tracking
ALTER TABLE trades 
ADD COLUMN fee_details JSONB;

-- Create trade_fills table for detailed fill-level tracking
CREATE TABLE trade_fills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  fill_index INTEGER NOT NULL, -- Order of fill in the order
  price NUMERIC(20, 8) NOT NULL,
  quantity NUMERIC(20, 8) NOT NULL,
  commission NUMERIC(20, 8),
  commission_asset VARCHAR(10),
  binance_trade_id BIGINT, -- Binance's trade ID if available
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique fills per trade
  UNIQUE(trade_id, fill_index)
);

-- Add index for querying fills by trade
CREATE INDEX idx_trade_fills_trade_id ON trade_fills(trade_id);

-- Add index for analyzing fills by price
CREATE INDEX idx_trade_fills_price ON trade_fills(price);

-- Add comment explaining the tables
COMMENT ON COLUMN trades.fee_details IS 'JSON object containing detailed fee breakdown: {BTC: amount, USDT: amount, BNB: amount, etc.}';
COMMENT ON TABLE trade_fills IS 'Individual fills that make up a trade order, for detailed execution analysis';
COMMENT ON COLUMN trade_fills.fill_index IS 'Sequential order of this fill within the trade (0-based)';
COMMENT ON COLUMN trade_fills.binance_trade_id IS 'Binance trade ID from the fill, if provided';