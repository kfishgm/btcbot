-- Create the strategy_config table
CREATE TABLE IF NOT EXISTS strategy_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M')),
  drop_percentage DECIMAL(5,4) NOT NULL CHECK (drop_percentage >= 0.0200 AND drop_percentage <= 0.0800),
  rise_percentage DECIMAL(5,4) NOT NULL CHECK (rise_percentage >= 0.0200 AND rise_percentage <= 0.0800),
  max_purchases INTEGER NOT NULL CHECK (max_purchases >= 1 AND max_purchases <= 30),
  min_buy_usdt DECIMAL(20,8) NOT NULL CHECK (min_buy_usdt >= 10.00),
  initial_capital_usdt DECIMAL(20,8) NOT NULL,
  slippage_buy_pct DECIMAL(5,4) DEFAULT 0.0030,
  slippage_sell_pct DECIMAL(5,4) DEFAULT 0.0030,
  is_active BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create the cycle_state table
CREATE TABLE IF NOT EXISTS cycle_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('READY', 'HOLDING', 'PAUSED')),
  capital_available DECIMAL(20,8) NOT NULL,
  btc_accumulated DECIMAL(20,8) DEFAULT 0,
  purchases_remaining INTEGER NOT NULL,
  reference_price DECIMAL(20,8),
  cost_accum_usdt DECIMAL(20,8) DEFAULT 0,
  btc_accum_net DECIMAL(20,8) DEFAULT 0,
  ath_price DECIMAL(20,8),
  buy_amount DECIMAL(20,8),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create the trades table
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES cycle_state(id),
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('FILLED', 'PARTIAL', 'CANCELLED')),
  price DECIMAL(20,8) NOT NULL,
  quantity DECIMAL(20,8) NOT NULL,
  quote_quantity DECIMAL(20,8) NOT NULL,
  fee_asset TEXT,
  fee_amount DECIMAL(20,8),
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create the bot_events table
CREATE TABLE IF NOT EXISTS bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('START', 'STOP', 'ERROR', 'DRIFT_HALT', 'TRADE_EXECUTED', 'CYCLE_COMPLETE', 'CONFIG_UPDATED', 'WEBSOCKET_CONNECTED', 'WEBSOCKET_DISCONNECTED')),
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_trades_cycle_id ON trades(cycle_id);
CREATE INDEX IF NOT EXISTS idx_trades_type ON trades(type);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_event_type ON bot_events(event_type);
CREATE INDEX IF NOT EXISTS idx_bot_events_severity ON bot_events(severity);
CREATE INDEX IF NOT EXISTS idx_bot_events_created_at ON bot_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_state_status ON cycle_state(status);
CREATE INDEX IF NOT EXISTS idx_strategy_config_is_active ON strategy_config(is_active);

-- Create update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for auto-updating timestamps
CREATE TRIGGER update_strategy_config_updated_at
  BEFORE UPDATE ON strategy_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cycle_state_updated_at
  BEFORE UPDATE ON cycle_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE strategy_config IS 'Configuration for the trading strategy';
COMMENT ON TABLE cycle_state IS 'Current state of the trading cycle';
COMMENT ON TABLE trades IS 'History of all executed trades';
COMMENT ON TABLE bot_events IS 'Event log for monitoring and debugging';

COMMENT ON COLUMN strategy_config.timeframe IS 'Candlestick timeframe for trading decisions';
COMMENT ON COLUMN strategy_config.drop_percentage IS 'Percentage drop to trigger buy (0.02 = 2%)';
COMMENT ON COLUMN strategy_config.rise_percentage IS 'Percentage rise to trigger sell (0.02 = 2%)';
COMMENT ON COLUMN strategy_config.max_purchases IS 'Maximum number of purchases per cycle';
COMMENT ON COLUMN strategy_config.min_buy_usdt IS 'Minimum USDT amount per purchase';
COMMENT ON COLUMN strategy_config.initial_capital_usdt IS 'Starting capital for the trading cycle';
COMMENT ON COLUMN strategy_config.slippage_buy_pct IS 'Slippage protection for buy orders';
COMMENT ON COLUMN strategy_config.slippage_sell_pct IS 'Slippage protection for sell orders';

COMMENT ON COLUMN cycle_state.status IS 'Current cycle status: READY (waiting to buy), HOLDING (has BTC), PAUSED (error/drift)';
COMMENT ON COLUMN cycle_state.capital_available IS 'USDT available for trading';
COMMENT ON COLUMN cycle_state.btc_accumulated IS 'BTC accumulated in current cycle';
COMMENT ON COLUMN cycle_state.purchases_remaining IS 'Number of purchases left in current cycle';
COMMENT ON COLUMN cycle_state.reference_price IS 'Weighted average price for sell decisions';
COMMENT ON COLUMN cycle_state.cost_accum_usdt IS 'Total USDT spent including fees';
COMMENT ON COLUMN cycle_state.btc_accum_net IS 'Total BTC received after fees';
COMMENT ON COLUMN cycle_state.ath_price IS 'All-time high from 20-candle window';
COMMENT ON COLUMN cycle_state.buy_amount IS 'USDT amount per purchase';

COMMENT ON COLUMN trades.cycle_id IS 'Reference to the cycle this trade belongs to';
COMMENT ON COLUMN trades.type IS 'Trade type: BUY or SELL';
COMMENT ON COLUMN trades.order_id IS 'Binance order ID';
COMMENT ON COLUMN trades.status IS 'Order status: FILLED, PARTIAL, or CANCELLED';
COMMENT ON COLUMN trades.price IS 'Execution price in USDT';
COMMENT ON COLUMN trades.quantity IS 'BTC quantity';
COMMENT ON COLUMN trades.quote_quantity IS 'USDT quantity';
COMMENT ON COLUMN trades.fee_asset IS 'Asset used for fee payment';
COMMENT ON COLUMN trades.fee_amount IS 'Fee amount in fee_asset';
COMMENT ON COLUMN trades.executed_at IS 'Timestamp when the trade was executed';

COMMENT ON COLUMN bot_events.event_type IS 'Type of event that occurred';
COMMENT ON COLUMN bot_events.severity IS 'Event severity level';
COMMENT ON COLUMN bot_events.message IS 'Human-readable event description';
COMMENT ON COLUMN bot_events.metadata IS 'Additional structured data about the event';