export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export interface Database {
  public: {
    Tables: {
      strategy_config: {
        Row: {
          id: string;
          timeframe: string;
          drop_percentage: number;
          rise_percentage: number;
          max_purchases: number;
          min_buy_usdt: number;
          initial_capital_usdt: number;
          slippage_buy_pct: number;
          slippage_sell_pct: number;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          timeframe: string;
          drop_percentage: number;
          rise_percentage: number;
          max_purchases: number;
          min_buy_usdt: number;
          initial_capital_usdt: number;
          slippage_buy_pct?: number;
          slippage_sell_pct?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          id?: string;
          timeframe?: string;
          drop_percentage?: number;
          rise_percentage?: number;
          max_purchases?: number;
          min_buy_usdt?: number;
          initial_capital_usdt?: number;
          slippage_buy_pct?: number;
          slippage_sell_pct?: number;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      cycle_state: {
        Row: {
          id: string;
          status: string;
          capital_available: number;
          btc_accumulated: number;
          purchases_remaining: number;
          reference_price: number | null;
          cost_accum_usdt: number;
          btc_accum_net: number;
          ath_price: number | null;
          buy_amount: number | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          status: string;
          capital_available: number;
          btc_accumulated?: number;
          purchases_remaining: number;
          reference_price?: number | null;
          cost_accum_usdt?: number;
          btc_accum_net?: number;
          ath_price?: number | null;
          buy_amount?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          status?: string;
          capital_available?: number;
          btc_accumulated?: number;
          purchases_remaining?: number;
          reference_price?: number | null;
          cost_accum_usdt?: number;
          btc_accum_net?: number;
          ath_price?: number | null;
          buy_amount?: number | null;
          updated_at?: string;
        };
      };
      trades: {
        Row: {
          id: string;
          cycle_id: string;
          type: string;
          order_id: string;
          status: string;
          price: number;
          quantity: number;
          quote_quantity: number;
          fee_asset: string | null;
          fee_amount: number | null;
          executed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          type: string;
          order_id: string;
          status: string;
          price: number;
          quantity: number;
          quote_quantity: number;
          fee_asset?: string | null;
          fee_amount?: number | null;
          executed_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          cycle_id?: string;
          type?: string;
          order_id?: string;
          status?: string;
          price?: number;
          quantity?: number;
          quote_quantity?: number;
          fee_asset?: string | null;
          fee_amount?: number | null;
          executed_at?: string;
          created_at?: string;
        };
      };
      bot_events: {
        Row: {
          id: string;
          event_type: string;
          severity: string;
          message: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_type: string;
          severity: string;
          message?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_type?: string;
          severity?: string;
          message?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
      };
    };
  };
}
