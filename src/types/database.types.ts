export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          variables?: Json
          operationName?: string
          query?: string
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      bot_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          message: string | null
          metadata: Json | null
          severity: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          message?: string | null
          metadata?: Json | null
          severity: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          severity?: string
        }
        Relationships: []
      }
      cycle_state: {
        Row: {
          ath_price: number | null
          ath_reference_price: number | null
          btc_accum_net: number | null
          btc_accumulated: number | null
          btc_dust: number | null
          buy_amount: number | null
          buy_anchor_price: number | null
          buy_grid: number[] | null
          buy_index: number | null
          capital_available: number
          completed_at: string | null
          cost_accum_usdt: number | null
          final_profit: number | null
          id: string
          previous_cycle_id: string | null
          purchases_remaining: number
          sell_reference_price: number | null
          status: string
          strategy_config_id: string | null
          updated_at: string | null
          version: number
        }
        Insert: {
          ath_price?: number | null
          ath_reference_price?: number | null
          btc_accum_net?: number | null
          btc_accumulated?: number | null
          btc_dust?: number | null
          buy_amount?: number | null
          buy_anchor_price?: number | null
          buy_grid?: number[] | null
          buy_index?: number | null
          capital_available: number
          completed_at?: string | null
          cost_accum_usdt?: number | null
          final_profit?: number | null
          id?: string
          previous_cycle_id?: string | null
          purchases_remaining: number
          sell_reference_price?: number | null
          status: string
          strategy_config_id?: string | null
          updated_at?: string | null
          version?: number
        }
        Update: {
          ath_price?: number | null
          ath_reference_price?: number | null
          btc_accum_net?: number | null
          btc_accumulated?: number | null
          btc_dust?: number | null
          buy_amount?: number | null
          buy_anchor_price?: number | null
          buy_grid?: number[] | null
          buy_index?: number | null
          capital_available?: number
          completed_at?: string | null
          cost_accum_usdt?: number | null
          final_profit?: number | null
          id?: string
          previous_cycle_id?: string | null
          purchases_remaining?: number
          sell_reference_price?: number | null
          status?: string
          strategy_config_id?: string | null
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cycle_state_previous_cycle_id_fkey"
            columns: ["previous_cycle_id"]
            isOneToOne: false
            referencedRelation: "cycle_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_state_previous_cycle_id_fkey"
            columns: ["previous_cycle_id"]
            isOneToOne: false
            referencedRelation: "v_active_configs"
            referencedColumns: ["cycle_id"]
          },
          {
            foreignKeyName: "cycle_state_strategy_config_id_fkey"
            columns: ["strategy_config_id"]
            isOneToOne: false
            referencedRelation: "strategy_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_state_strategy_config_id_fkey"
            columns: ["strategy_config_id"]
            isOneToOne: false
            referencedRelation: "v_active_configs"
            referencedColumns: ["config_id"]
          },
        ]
      }
      pause_states: {
        Row: {
          created_at: string | null
          id: number
          pause_metadata: Json | null
          pause_reason: string
          paused_at: string | null
          resume_metadata: Json | null
          resumed_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          pause_metadata?: Json | null
          pause_reason: string
          paused_at?: string | null
          resume_metadata?: Json | null
          resumed_at?: string | null
          status: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          pause_metadata?: Json | null
          pause_reason?: string
          paused_at?: string | null
          resume_metadata?: Json | null
          resumed_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      strategy_config: {
        Row: {
          ath_window: number | null
          capital_allocation_pct: number | null
          drop_percentage: number
          id: string
          initial_capital_usdt: number
          is_active: boolean | null
          max_purchases: number
          min_buy_usdt: number
          rise_percentage: number
          slippage_buy_pct: number | null
          slippage_sell_pct: number | null
          timeframe: string
          updated_at: string | null
        }
        Insert: {
          ath_window?: number | null
          capital_allocation_pct?: number | null
          drop_percentage: number
          id?: string
          initial_capital_usdt: number
          is_active?: boolean | null
          max_purchases: number
          min_buy_usdt: number
          rise_percentage: number
          slippage_buy_pct?: number | null
          slippage_sell_pct?: number | null
          timeframe: string
          updated_at?: string | null
        }
        Update: {
          ath_window?: number | null
          capital_allocation_pct?: number | null
          drop_percentage?: number
          id?: string
          initial_capital_usdt?: number
          is_active?: boolean | null
          max_purchases?: number
          min_buy_usdt?: number
          rise_percentage?: number
          slippage_buy_pct?: number | null
          slippage_sell_pct?: number | null
          timeframe?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      trade_fills: {
        Row: {
          binance_trade_id: number | null
          commission: number | null
          commission_asset: string | null
          created_at: string | null
          fill_index: number
          id: string
          price: number
          quantity: number
          trade_id: string
        }
        Insert: {
          binance_trade_id?: number | null
          commission?: number | null
          commission_asset?: string | null
          created_at?: string | null
          fill_index: number
          id?: string
          price: number
          quantity: number
          trade_id: string
        }
        Update: {
          binance_trade_id?: number | null
          commission?: number | null
          commission_asset?: string | null
          created_at?: string | null
          fill_index?: number
          id?: string
          price?: number
          quantity?: number
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_fills_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          created_at: string | null
          cycle_id: string
          executed_at: string
          fee_amount: number | null
          fee_asset: string | null
          fee_details: Json | null
          id: string
          order_id: string
          price: number
          quantity: number
          quote_quantity: number
          status: string
          type: string
        }
        Insert: {
          created_at?: string | null
          cycle_id: string
          executed_at: string
          fee_amount?: number | null
          fee_asset?: string | null
          fee_details?: Json | null
          id?: string
          order_id: string
          price: number
          quantity: number
          quote_quantity: number
          status: string
          type: string
        }
        Update: {
          created_at?: string | null
          cycle_id?: string
          executed_at?: string
          fee_amount?: number | null
          fee_asset?: string | null
          fee_details?: Json | null
          id?: string
          order_id?: string
          price?: number
          quantity?: number
          quote_quantity?: number
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "cycle_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "v_active_configs"
            referencedColumns: ["cycle_id"]
          },
        ]
      }
    }
    Views: {
      v_active_configs: {
        Row: {
          ath_price: number | null
          btc_accumulated: number | null
          capital_available: number | null
          config_id: string | null
          cycle_id: string | null
          cycle_status: string | null
          cycle_updated_at: string | null
          drop_percentage: number | null
          initial_capital_usdt: number | null
          is_active: boolean | null
          max_purchases: number | null
          purchases_remaining: number | null
          rise_percentage: number | null
          timeframe: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      batch_activate_strategy_configs: {
        Args: { config_ids: string[] }
        Returns: undefined
      }
      batch_deactivate_strategy_configs: {
        Args: Record<string, never>
        Returns: undefined
      }
      batch_update_states: {
        Args: { p_updates: Json[] }
        Returns: Json
      }
      cleanup_old_events: {
        Args: { retention_days?: number }
        Returns: number
      }
      execute_with_wal: {
        Args: {
          p_operation_metadata?: Json
          p_state_update: Json
          p_bot_id: string
        }
        Returns: undefined
      }
      get_event_statistics: {
        Args: { start_time?: string; end_time?: string }
        Returns: {
          event_type: string
          severity: string
          event_count: number
          first_occurrence: string
          last_occurrence: string
        }[]
      }
      recover_incomplete_wal: {
        Args: { p_bot_id: string }
        Returns: Json
      }
      update_state_atomic: {
        Args: { p_updates: Json; p_bot_id: string; p_expected_version?: number }
        Returns: Json
      }
      update_state_critical: {
        Args: { p_bot_id: string; p_updates: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
