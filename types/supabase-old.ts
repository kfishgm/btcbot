export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          variables?: Json;
          operationName?: string;
          query?: string;
          extensions?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      bot_events: {
        Row: {
          created_at: string | null;
          event_type: string;
          id: string;
          message: string | null;
          metadata: Json | null;
          severity: string;
        };
        Insert: {
          created_at?: string | null;
          event_type: string;
          id?: string;
          message?: string | null;
          metadata?: Json | null;
          severity: string;
        };
        Update: {
          created_at?: string | null;
          event_type?: string;
          id?: string;
          message?: string | null;
          metadata?: Json | null;
          severity?: string;
        };
        Relationships: [];
      };
      cycle_state: {
        Row: {
          ath_price: number | null;
          btc_accum_net: number | null;
          btc_accumulated: number | null;
          buy_amount: number | null;
          buy_grid: number[] | null;
          buy_index: number;
          capital_available: number;
          cost_accum_usdt: number | null;
          id: string;
          purchases_remaining: number;
          reference_price: number | null;
          status: string;
          updated_at: string | null;
          version: number;
        };
        Insert: {
          ath_price?: number | null;
          btc_accum_net?: number | null;
          btc_accumulated?: number | null;
          buy_amount?: number | null;
          buy_grid?: number[] | null;
          buy_index?: number;
          capital_available: number;
          cost_accum_usdt?: number | null;
          id?: string;
          purchases_remaining: number;
          reference_price?: number | null;
          status: string;
          updated_at?: string | null;
          version?: number;
        };
        Update: {
          ath_price?: number | null;
          btc_accum_net?: number | null;
          btc_accumulated?: number | null;
          buy_amount?: number | null;
          buy_grid?: number[] | null;
          buy_index?: number;
          capital_available?: number;
          cost_accum_usdt?: number | null;
          id?: string;
          purchases_remaining?: number;
          reference_price?: number | null;
          status?: string;
          updated_at?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      pause_states: {
        Row: {
          created_at: string | null;
          id: number;
          pause_metadata: Json | null;
          pause_reason: string;
          paused_at: string | null;
          resume_metadata: Json | null;
          resumed_at: string | null;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: number;
          pause_metadata?: Json | null;
          pause_reason: string;
          paused_at?: string | null;
          resume_metadata?: Json | null;
          resumed_at?: string | null;
          status: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: number;
          pause_metadata?: Json | null;
          pause_reason?: string;
          paused_at?: string | null;
          resume_metadata?: Json | null;
          resumed_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      strategy_config: {
        Row: {
          ath_window: number | null;
          drop_percentage: number;
          id: string;
          initial_capital_usdt: number;
          is_active: boolean | null;
          max_purchases: number;
          min_buy_usdt: number;
          rise_percentage: number;
          slippage_buy_pct: number | null;
          slippage_sell_pct: number | null;
          timeframe: string;
          updated_at: string | null;
        };
        Insert: {
          ath_window?: number | null;
          drop_percentage: number;
          id?: string;
          initial_capital_usdt: number;
          is_active?: boolean | null;
          max_purchases: number;
          min_buy_usdt: number;
          rise_percentage: number;
          slippage_buy_pct?: number | null;
          slippage_sell_pct?: number | null;
          timeframe: string;
          updated_at?: string | null;
        };
        Update: {
          ath_window?: number | null;
          drop_percentage?: number;
          id?: string;
          initial_capital_usdt?: number;
          is_active?: boolean | null;
          max_purchases?: number;
          min_buy_usdt?: number;
          rise_percentage?: number;
          slippage_buy_pct?: number | null;
          slippage_sell_pct?: number | null;
          timeframe?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      trade_fills: {
        Row: {
          binance_trade_id: number | null;
          commission: number | null;
          commission_asset: string | null;
          created_at: string | null;
          fill_index: number;
          id: string;
          price: number;
          quantity: number;
          trade_id: string;
        };
        Insert: {
          binance_trade_id?: number | null;
          commission?: number | null;
          commission_asset?: string | null;
          created_at?: string | null;
          fill_index: number;
          id?: string;
          price: number;
          quantity: number;
          trade_id: string;
        };
        Update: {
          binance_trade_id?: number | null;
          commission?: number | null;
          commission_asset?: string | null;
          created_at?: string | null;
          fill_index?: number;
          id?: string;
          price?: number;
          quantity?: number;
          trade_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trade_fills_trade_id_fkey";
            columns: ["trade_id"];
            isOneToOne: false;
            referencedRelation: "trades";
            referencedColumns: ["id"];
          },
        ];
      };
      trades: {
        Row: {
          created_at: string | null;
          cycle_id: string;
          executed_at: string;
          fee_amount: number | null;
          fee_asset: string | null;
          fee_details: Json | null;
          id: string;
          order_id: string;
          price: number;
          quantity: number;
          quote_quantity: number;
          status: string;
          type: string;
        };
        Insert: {
          created_at?: string | null;
          cycle_id: string;
          executed_at: string;
          fee_amount?: number | null;
          fee_asset?: string | null;
          fee_details?: Json | null;
          id?: string;
          order_id: string;
          price: number;
          quantity: number;
          quote_quantity: number;
          status: string;
          type: string;
        };
        Update: {
          created_at?: string | null;
          cycle_id?: string;
          executed_at?: string;
          fee_amount?: number | null;
          fee_asset?: string | null;
          fee_details?: Json | null;
          id?: string;
          order_id?: string;
          price?: number;
          quantity?: number;
          quote_quantity?: number;
          status?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trades_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycle_state";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      batch_update_states: {
        Args: { p_updates: Json[] };
        Returns: Json;
      };
      cleanup_old_events: {
        Args: { retention_days?: number };
        Returns: number;
      };
      execute_with_wal: {
        Args: {
          p_state_update: Json;
          p_operation_metadata: Json;
          p_bot_id: string;
        };
        Returns: Json;
      };
      get_event_statistics: {
        Args: { start_time?: string; end_time?: string };
        Returns: {
          event_type: string;
          severity: string;
          event_count: number;
          first_occurrence: string;
          last_occurrence: string;
        }[];
      };
      recover_incomplete_wal: {
        Args: { p_bot_id: string };
        Returns: Json;
      };
      update_state_atomic: {
        Args: {
          p_expected_version?: number;
          p_bot_id: string;
          p_updates: Json;
        };
        Returns: Json;
      };
      update_state_critical: {
        Args: { p_bot_id: string; p_updates: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DefaultSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
