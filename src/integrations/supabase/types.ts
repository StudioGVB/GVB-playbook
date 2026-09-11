export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      brain_dump: {
        Row: {
          content: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_dump_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      costs: {
        Row: {
          amount: number
          category: string
          created_at: string
          id: string
          name: string
          project_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          name: string
          project_id?: string | null
          type?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "costs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cover_letter_profiles: {
        Row: {
          created_at: string
          education: string
          interests: string
          personal_details: string
          preferred_tone: string
          projects: string
          resume_text: string
          skills: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          education?: string
          interests?: string
          personal_details?: string
          preferred_tone?: string
          projects?: string
          resume_text?: string
          skills?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          education?: string
          interests?: string
          personal_details?: string
          preferred_tone?: string
          projects?: string
          resume_text?: string
          skills?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cover_letters: {
        Row: {
          company_name: string
          created_at: string
          custom_notes: string | null
          generated_letter: string
          id: string
          job_description: string
          job_title: string
          source_url: string | null
          user_id: string
        }
        Insert: {
          company_name?: string
          created_at?: string
          custom_notes?: string | null
          generated_letter?: string
          id?: string
          job_description?: string
          job_title?: string
          source_url?: string | null
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          custom_notes?: string | null
          generated_letter?: string
          id?: string
          job_description?: string
          job_title?: string
          source_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      finance_accounts: {
        Row: {
          account_name: string
          balance: number
          created_at: string
          currency: string
          exclude_from_totals: boolean
          external_account_id: string | null
          id: string
          last_synced_at: string | null
          provider: string
          source_type: string
          user_id: string
        }
        Insert: {
          account_name: string
          balance?: number
          created_at?: string
          currency?: string
          exclude_from_totals?: boolean
          external_account_id?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: string
          source_type?: string
          user_id: string
        }
        Update: {
          account_name?: string
          balance?: number
          created_at?: string
          currency?: string
          exclude_from_totals?: boolean
          external_account_id?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: string
          source_type?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_assumptions: {
        Row: {
          baseline_savings_percent: number
          buffer_months: number
          carry_forward_debt: number
          created_at: string
          discretionary_end_date: string | null
          discretionary_savings_cap: number
          discretionary_start_date: string | null
          estimated_essential_variable: number
          expected_monthly_income: number | null
          future_monthly_survival_cost: number
          gross_annual_salary: number
          id: string
          income_start_date: string | null
          last_debt_week: string | null
          monthly_budget_override: number | null
          pension_percent: number
          student_loan_plan: string | null
          target_savings: number
          travel_checklist: Json
          travel_end_date: string | null
          travel_pool_amount: number
          travel_start_date: string | null
          updated_at: string
          user_id: string
          weekly_fun_budget: number
        }
        Insert: {
          baseline_savings_percent?: number
          buffer_months?: number
          carry_forward_debt?: number
          created_at?: string
          discretionary_end_date?: string | null
          discretionary_savings_cap?: number
          discretionary_start_date?: string | null
          estimated_essential_variable?: number
          expected_monthly_income?: number | null
          future_monthly_survival_cost?: number
          gross_annual_salary?: number
          id?: string
          income_start_date?: string | null
          last_debt_week?: string | null
          monthly_budget_override?: number | null
          pension_percent?: number
          student_loan_plan?: string | null
          target_savings?: number
          travel_checklist?: Json
          travel_end_date?: string | null
          travel_pool_amount?: number
          travel_start_date?: string | null
          updated_at?: string
          user_id: string
          weekly_fun_budget?: number
        }
        Update: {
          baseline_savings_percent?: number
          buffer_months?: number
          carry_forward_debt?: number
          created_at?: string
          discretionary_end_date?: string | null
          discretionary_savings_cap?: number
          discretionary_start_date?: string | null
          estimated_essential_variable?: number
          expected_monthly_income?: number | null
          future_monthly_survival_cost?: number
          gross_annual_salary?: number
          id?: string
          income_start_date?: string | null
          last_debt_week?: string | null
          monthly_budget_override?: number | null
          pension_percent?: number
          student_loan_plan?: string | null
          target_savings?: number
          travel_checklist?: Json
          travel_end_date?: string | null
          travel_pool_amount?: number
          travel_start_date?: string | null
          updated_at?: string
          user_id?: string
          weekly_fun_budget?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_assumptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_budgets: {
        Row: {
          created_at: string
          currency: string
          fixed_budget: number | null
          id: string
          month: string
          notes: string | null
          planned_income: number | null
          savings_goal: number | null
          user_id: string
          variable_budget: number | null
        }
        Insert: {
          created_at?: string
          currency?: string
          fixed_budget?: number | null
          id?: string
          month: string
          notes?: string | null
          planned_income?: number | null
          savings_goal?: number | null
          user_id: string
          variable_budget?: number | null
        }
        Update: {
          created_at?: string
          currency?: string
          fixed_budget?: number | null
          id?: string
          month?: string
          notes?: string | null
          planned_income?: number | null
          savings_goal?: number | null
          user_id?: string
          variable_budget?: number | null
        }
        Relationships: []
      }
      finance_categories: {
        Row: {
          color: string | null
          created_at: string
          exclude_from_reports: boolean
          id: string
          is_cuttable: boolean
          is_essential: boolean
          monthly_target: number | null
          name: string
          type: string
          user_id: string
          weekly_target: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          exclude_from_reports?: boolean
          id?: string
          is_cuttable?: boolean
          is_essential?: boolean
          monthly_target?: number | null
          name: string
          type?: string
          user_id: string
          weekly_target?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string
          exclude_from_reports?: boolean
          id?: string
          is_cuttable?: boolean
          is_essential?: boolean
          monthly_target?: number | null
          name?: string
          type?: string
          user_id?: string
          weekly_target?: number | null
        }
        Relationships: []
      }
      finance_fixed_expense_payments: {
        Row: {
          amount: number
          created_at: string
          fixed_expense_id: string
          id: string
          paid_at: string
          period_start: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          fixed_expense_id: string
          id?: string
          paid_at?: string
          period_start: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          fixed_expense_id?: string
          id?: string
          paid_at?: string
          period_start?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_fixed_expense_payments_fixed_expense_id_fkey"
            columns: ["fixed_expense_id"]
            isOneToOne: false
            referencedRelation: "finance_fixed_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_fixed_expenses: {
        Row: {
          amount: number
          auto_pay: boolean
          created_at: string
          currency: string
          due_day: number | null
          effective_from: string | null
          effective_to: string | null
          frequency: string
          id: string
          name: string
          notes: string | null
          paid_externally: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          auto_pay?: boolean
          created_at?: string
          currency?: string
          due_day?: number | null
          effective_from?: string | null
          effective_to?: string | null
          frequency?: string
          id?: string
          name: string
          notes?: string | null
          paid_externally?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          auto_pay?: boolean
          created_at?: string
          currency?: string
          due_day?: number | null
          effective_from?: string | null
          effective_to?: string | null
          frequency?: string
          id?: string
          name?: string
          notes?: string | null
          paid_externally?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_goal_plans: {
        Row: {
          baseline_weekly_surplus: number | null
          created_at: string
          est_weeks_to_goal: number | null
          goal_id: string
          id: string
          plan: Json | null
          suggested_weekly_savings: number | null
          user_id: string
        }
        Insert: {
          baseline_weekly_surplus?: number | null
          created_at?: string
          est_weeks_to_goal?: number | null
          goal_id: string
          id?: string
          plan?: Json | null
          suggested_weekly_savings?: number | null
          user_id: string
        }
        Update: {
          baseline_weekly_surplus?: number | null
          created_at?: string
          est_weeks_to_goal?: number | null
          goal_id?: string
          id?: string
          plan?: Json | null
          suggested_weekly_savings?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_goal_plans_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "finance_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_goals: {
        Row: {
          assigned_amount: number
          color: string | null
          created_at: string
          currency: string
          deadline: string | null
          id: string
          is_stash: boolean
          name: string
          percent_allocation: number
          priority: number
          safety_mode: string
          target_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_amount?: number
          color?: string | null
          created_at?: string
          currency?: string
          deadline?: string | null
          id?: string
          is_stash?: boolean
          name: string
          percent_allocation?: number
          priority?: number
          safety_mode?: string
          target_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_amount?: number
          color?: string | null
          created_at?: string
          currency?: string
          deadline?: string | null
          id?: string
          is_stash?: boolean
          name?: string
          percent_allocation?: number
          priority?: number
          safety_mode?: string
          target_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_import_logs: {
        Row: {
          account_id: string
          balance_extracted: number | null
          created_at: string
          file_name: string
          file_type: string
          id: string
          transactions_imported: number
          transactions_skipped: number
          user_id: string
        }
        Insert: {
          account_id: string
          balance_extracted?: number | null
          created_at?: string
          file_name: string
          file_type?: string
          id?: string
          transactions_imported?: number
          transactions_skipped?: number
          user_id: string
        }
        Update: {
          account_id?: string
          balance_extracted?: number | null
          created_at?: string
          file_name?: string
          file_type?: string
          id?: string
          transactions_imported?: number
          transactions_skipped?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_import_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_settings: {
        Row: {
          base_currency: string
          created_at: string
          fx_rates: Json
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          fx_rates?: Json
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          fx_rates?: Json
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_transactions: {
        Row: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string
          currency: string
          description: string
          external_transaction_id: string | null
          fixed_expense_id: string | null
          goal_id: string | null
          id: string
          import_log_id: string | null
          is_fixed: boolean
          is_refund: boolean
          is_reviewed: boolean
          is_transfer: boolean
          is_travel_spend: boolean
          matched_transaction_id: string | null
          merchant: string | null
          posted_at: string
          raw: Json | null
          transaction_fingerprint: string | null
          transfer_group_id: string | null
          transfer_match_confidence: number | null
          transfer_pattern_key: string | null
          transfer_side: string | null
          transfer_status: string | null
          trip_id: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category_id?: string | null
          created_at?: string
          currency?: string
          description: string
          external_transaction_id?: string | null
          fixed_expense_id?: string | null
          goal_id?: string | null
          id?: string
          import_log_id?: string | null
          is_fixed?: boolean
          is_refund?: boolean
          is_reviewed?: boolean
          is_transfer?: boolean
          is_travel_spend?: boolean
          matched_transaction_id?: string | null
          merchant?: string | null
          posted_at: string
          raw?: Json | null
          transaction_fingerprint?: string | null
          transfer_group_id?: string | null
          transfer_match_confidence?: number | null
          transfer_pattern_key?: string | null
          transfer_side?: string | null
          transfer_status?: string | null
          trip_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          external_transaction_id?: string | null
          fixed_expense_id?: string | null
          goal_id?: string | null
          id?: string
          import_log_id?: string | null
          is_fixed?: boolean
          is_refund?: boolean
          is_reviewed?: boolean
          is_transfer?: boolean
          is_travel_spend?: boolean
          matched_transaction_id?: string | null
          merchant?: string | null
          posted_at?: string
          raw?: Json | null
          transaction_fingerprint?: string | null
          transfer_group_id?: string | null
          transfer_match_confidence?: number | null
          transfer_pattern_key?: string | null
          transfer_side?: string | null
          transfer_status?: string | null
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_fixed_expense_id_fkey"
            columns: ["fixed_expense_id"]
            isOneToOne: false
            referencedRelation: "finance_fixed_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_import_log_id_fkey"
            columns: ["import_log_id"]
            isOneToOne: false
            referencedRelation: "finance_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_trips: {
        Row: {
          checklist: Json
          created_at: string
          end_date: string | null
          goal_id: string | null
          id: string
          name: string
          notes: string | null
          start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          end_date?: string | null
          goal_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          end_date?: string | null
          goal_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_week_types: {
        Row: {
          created_at: string
          id: string
          note: string | null
          user_id: string
          week_start: string
          week_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          user_id: string
          week_start: string
          week_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          user_id?: string
          week_start?: string
          week_type?: string
        }
        Relationships: []
      }
      finance_weekly_boosts: {
        Row: {
          amount: number
          created_at: string
          goal_id: string
          id: string
          note: string | null
          user_id: string
          week_start: string
        }
        Insert: {
          amount: number
          created_at?: string
          goal_id: string
          id?: string
          note?: string | null
          user_id: string
          week_start: string
        }
        Update: {
          amount?: number
          created_at?: string
          goal_id?: string
          id?: string
          note?: string | null
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_weekly_boosts_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "finance_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_weekly_boosts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      income_source_tags: {
        Row: {
          created_at: string
          group_name: string
          id: string
          source_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_name: string
          id?: string
          source_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_name?: string
          id?: string
          source_key?: string
          user_id?: string
        }
        Relationships: []
      }
      job_applications: {
        Row: {
          company_name: string
          cover_letter: string | null
          created_at: string
          custom_notes: string | null
          id: string
          job_description: string
          job_title: string
          match_analysis: Json | null
          questions_answers: Json | null
          source_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name?: string
          cover_letter?: string | null
          created_at?: string
          custom_notes?: string | null
          id?: string
          job_description?: string
          job_title?: string
          match_analysis?: Json | null
          questions_answers?: Json | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string
          cover_letter?: string | null
          created_at?: string
          custom_notes?: string | null
          id?: string
          job_description?: string
          job_title?: string
          match_analysis?: Json | null
          questions_answers?: Json | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meal_combos: {
        Row: {
          base_id: string | null
          created_at: string
          id: string
          meat_id: string | null
          name: string
          side_id: string | null
          side2_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          base_id?: string | null
          created_at?: string
          id?: string
          meat_id?: string | null
          name: string
          side_id?: string | null
          side2_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          base_id?: string | null
          created_at?: string
          id?: string
          meat_id?: string | null
          name?: string
          side_id?: string | null
          side2_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_combos_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "meal_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_combos_meat_id_fkey"
            columns: ["meat_id"]
            isOneToOne: false
            referencedRelation: "meal_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_combos_side_id_fkey"
            columns: ["side_id"]
            isOneToOne: false
            referencedRelation: "meal_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_combos_side2_id_fkey"
            columns: ["side2_id"]
            isOneToOne: false
            referencedRelation: "meal_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_combos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_ingredients: {
        Row: {
          calories_per_serving: number
          category: Database["public"]["Enums"]["meal_category"]
          created_at: string
          id: string
          name: string
          notes: string | null
          pack_currency: string
          pack_price: number
          servings_per_pack: number
          updated_at: string
          user_id: string
        }
        Insert: {
          calories_per_serving?: number
          category: Database["public"]["Enums"]["meal_category"]
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          pack_currency?: string
          pack_price?: number
          servings_per_pack?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          calories_per_serving?: number
          category?: Database["public"]["Enums"]["meal_category"]
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          pack_currency?: string
          pack_price?: number
          servings_per_pack?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_ingredients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          color_class: string
          created_at: string
          description: string | null
          has_move_ai: boolean | null
          id: string
          monthly_cost: number | null
          name: string
          next_actions: string[] | null
          notes: string | null
          slug: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color_class?: string
          created_at?: string
          description?: string | null
          has_move_ai?: boolean | null
          id?: string
          monthly_cost?: number | null
          name: string
          next_actions?: string[] | null
          notes?: string | null
          slug: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color_class?: string
          created_at?: string
          description?: string | null
          has_move_ai?: boolean | null
          id?: string
          monthly_cost?: number | null
          name?: string
          next_actions?: string[] | null
          notes?: string | null
          slug?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          created_at: string
          id: string
          name: string
          order: number
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          order?: number
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          order?: number
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed: boolean
          created_at: string
          deadline: string | null
          id: string
          notes: string | null
          priority: string
          project_id: string
          section_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          deadline?: string | null
          id?: string
          notes?: string | null
          priority?: string
          project_id: string
          section_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          deadline?: string | null
          id?: string
          notes?: string | null
          priority?: string
          project_id?: string
          section_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_patterns: {
        Row: {
          account_from_id: string
          account_to_id: string
          amount_tolerance: number
          auto_match_enabled: boolean
          confirmation_count: number
          created_at: string
          frequency: string
          id: string
          pattern_key: string
          typical_amount: number
          user_id: string
        }
        Insert: {
          account_from_id: string
          account_to_id: string
          amount_tolerance?: number
          auto_match_enabled?: boolean
          confirmation_count?: number
          created_at?: string
          frequency?: string
          id?: string
          pattern_key: string
          typical_amount: number
          user_id: string
        }
        Update: {
          account_from_id?: string
          account_to_id?: string
          amount_tolerance?: number
          auto_match_enabled?: boolean
          confirmation_count?: number
          created_at?: string
          frequency?: string
          id?: string
          pattern_key?: string
          typical_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_patterns_account_from_id_fkey"
            columns: ["account_from_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_patterns_account_to_id_fkey"
            columns: ["account_to_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          available_cash: number | null
          created_at: string
          id: string
          monthly_non_negotiables: number | null
          uk_move_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          available_cash?: number | null
          created_at?: string
          id?: string
          monthly_non_negotiables?: number | null
          uk_move_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          available_cash?: number | null
          created_at?: string
          id?: string
          monthly_non_negotiables?: number | null
          uk_move_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_priorities: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          text: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          text: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_priorities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_users_view: {
        Row: {
          created_at: string | null
          email: string | null
          email_confirmed_at: string | null
          id: string | null
          last_sign_in_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          email_confirmed_at?: string | null
          id?: string | null
          last_sign_in_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          email_confirmed_at?: string | null
          id?: string | null
          last_sign_in_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_transaction_categories: { Args: { updates: Json }; Returns: number }
      get_up_token: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      meal_category: "base" | "meat" | "side"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      meal_category: ["base", "meat", "side"],
    },
  },
} as const
