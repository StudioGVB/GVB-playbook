import { useState, useEffect, useCallback, useContext } from 'react';
import { FinanceContext } from '@/contexts/FinanceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface FinanceAssumptions {
  id: string;
  user_id: string;
  future_monthly_survival_cost: number;
  buffer_months: number;
  weekly_fun_budget: number;
  expected_monthly_income: number | null;
  discretionary_savings_cap: number;
  discretionary_start_date: string | null;
  discretionary_end_date: string | null;
  baseline_savings_percent: number;
  income_start_date: string | null;
  estimated_essential_variable: number;
  target_savings: number;
  carry_forward_debt: number;
  last_debt_week: string | null;
  travel_start_date: string | null;
  travel_end_date: string | null;
  travel_pool_amount: number;
  travel_checklist: Array<{ label: string; done: boolean }>;
  gross_annual_salary: number;
  pension_percent: number;
  student_loan_plan: string | null;
  created_at: string;
  updated_at: string;
}


export function useFinanceAssumptionsState() {
  const { user } = useAuth();
  const [assumptions, setAssumptions] = useState<FinanceAssumptions | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('finance_assumptions' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setAssumptions(data as any);
      } else {
        // Create defaults using upsert
        const { data: created } = await supabase
          .from('finance_assumptions' as any)
          .upsert({
            user_id: user.id,
            future_monthly_survival_cost: 0,
            buffer_months: 3,
            weekly_fun_budget: 100,
            discretionary_savings_cap: 0,
            target_savings: 0,
          } as any, { onConflict: 'user_id' })
          .select()
          .maybeSingle();
        if (created) setAssumptions(created as any);
      }
    } catch (err) {
      console.error('Assumptions fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const update = async (updates: Partial<Omit<FinanceAssumptions, 'id' | 'user_id' | 'created_at' | 'updated_at'>>, silent = false) => {
    if (!user) return;
    const existing = assumptions || {};
    const updated = {
      ...existing,
      ...updates,
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };
    setAssumptions(updated as any);
    const { data, error } = await supabase
      .from('finance_assumptions' as any)
      .upsert(updated as any, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    if (error) { toast.error('Failed to update assumptions: ' + error.message); return; }
    if (data) setAssumptions(data as any);
    if (!silent) toast.success('Assumptions updated');
  };

  return { assumptions, loading, update, refetch: fetch };
}

export function useFinanceAssumptions() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFinanceAssumptions must be used within a FinanceProvider');
  }
  return context.assumptions;
}
