import { useState, useEffect, useCallback, useContext } from 'react';
import { FinanceContext } from '@/contexts/FinanceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface FixedExpense {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  frequency: string;
  currency: string;
  notes: string | null;
  due_day: number | null;
  auto_pay: boolean;
  paid_externally: boolean;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export function parseFrequencyWeeks(freq: string): number | null {
  if (!freq) return null;
  const match = freq.match(/(?:every[_\s]+)?(\d+)[_\s]*weeks?/i);
  if (match) {
    const num = parseInt(match[1], 10);
    return num > 0 ? num : null;
  }
  return null;
}

export function getFrequencyMonthlyMultiplier(frequency: string): number {
  if (frequency === 'weekly') return 52 / 12;
  if (frequency === 'fortnightly') return 26 / 12;
  if (frequency === 'monthly') return 1;
  if (frequency === 'quarterly') return 1 / 3;
  if (frequency === 'yearly') return 1 / 12;
  const weeks = parseFrequencyWeeks(frequency);
  if (weeks) {
    return 52 / (12 * weeks);
  }
  return 1;
}

export function getFrequencyWeeklyMultiplier(frequency: string): number {
  if (frequency === 'weekly') return 1;
  if (frequency === 'fortnightly') return 0.5;
  if (frequency === 'monthly') return 12 / 52;
  if (frequency === 'quarterly') return 4 / 52;
  if (frequency === 'yearly') return 1 / 52;
  const weeks = parseFrequencyWeeks(frequency);
  if (weeks) {
    return 1 / weeks;
  }
  return 12 / 52;
}

export function toMonthly(amount: number, frequency: string): number {
  return amount * getFrequencyMonthlyMultiplier(frequency);
}

export function toWeekly(amount: number, frequency: string): number {
  return amount * getFrequencyWeeklyMultiplier(frequency);
}

export function formatFrequency(frequency: string): string {
  if (!frequency) return 'monthly';
  if (frequency === 'weekly') return 'weekly';
  if (frequency === 'fortnightly') return 'fortnightly';
  if (frequency === 'monthly') return 'monthly';
  if (frequency === 'quarterly') return 'quarterly';
  if (frequency === 'yearly') return 'yearly';
  const weeks = parseFrequencyWeeks(frequency);
  if (weeks) {
    return `every ${weeks} weeks`;
  }
  return frequency.replace(/_/g, ' ');
}

export const FREQ_TO_MONTHLY: Record<string, number> = new Proxy(
  {
    weekly: 52 / 12,
    fortnightly: 26 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
  },
  {
    get(target, prop: string) {
      if (typeof prop === 'string') {
        if (prop in target) return (target as any)[prop];
        const weeks = parseFrequencyWeeks(prop);
        if (weeks) return 52 / (12 * weeks);
      }
      return 1;
    },
  }
);

export const FREQ_TO_WEEKLY: Record<string, number> = new Proxy(
  {
    weekly: 1,
    fortnightly: 0.5,
    monthly: 12 / 52,
    quarterly: 4 / 52,
    yearly: 1 / 52,
  },
  {
    get(target, prop: string) {
      if (typeof prop === 'string') {
        if (prop in target) return (target as any)[prop];
        const weeks = parseFrequencyWeeks(prop);
        if (weeks) return 1 / weeks;
      }
      return 12 / 52;
    },
  }
);

const DEFAULT_FX: Record<string, number> = { AUD_GBP: 0.52, GBP_AUD: 1.92 };

function isActiveOn(e: Pick<FixedExpense, 'effective_from' | 'effective_to'>, isoDate: string): boolean {
  if (e.effective_from && isoDate < e.effective_from) return false;
  if (e.effective_to && isoDate > e.effective_to) return false;
  return true;
}

function convert(amount: number, from: string, to: string, fx: Record<string, number>): number {
  if (from === to) return amount;
  const key = `${from}_${to}`;
  const rate = fx[key];
  if (rate) return amount * rate;
  const inverse = fx[`${to}_${from}`];
  if (inverse) return amount / inverse;
  return amount;
}

export function useFixedExpensesState() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<FixedExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseCurrency, setBaseCurrency] = useState<string>('GBP');
  const [fxRates, setFxRates] = useState<Record<string, number>>(DEFAULT_FX);

  const fetch = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: exp, error }, { data: settings }] = await Promise.all([
      supabase.from('finance_fixed_expenses' as any).select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      supabase.from('finance_settings' as any).select('base_currency, fx_rates').eq('user_id', user.id).maybeSingle(),
    ]);
    if (error) { console.error(error); setLoading(false); return; }
    setExpenses((exp as any[]) || []);
    if (settings) {
      setBaseCurrency((settings as any).base_currency || 'GBP');
      setFxRates({ ...DEFAULT_FX, ...((settings as any).fx_rates || {}) });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const add = async (expense: { name: string; amount: number; frequency: string; currency?: string; notes?: string; due_day?: number | null; auto_pay?: boolean; paid_externally?: boolean; effective_from?: string | null; effective_to?: string | null }) => {
    if (!user) return;
    const { error } = await supabase
      .from('finance_fixed_expenses' as any)
      .insert({ ...expense, user_id: user.id } as any);
    if (error) { toast.error('Failed to add expense'); return; }
    toast.success('Fixed expense added');
    fetch();
  };

  const update = async (id: string, updates: Partial<Pick<FixedExpense, 'name' | 'amount' | 'frequency' | 'currency' | 'notes' | 'due_day' | 'auto_pay' | 'paid_externally' | 'effective_from' | 'effective_to'>>) => {
    const { error } = await supabase
      .from('finance_fixed_expenses' as any)
      .update({ ...updates, updated_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) { toast.error('Failed to update'); return; }
    fetch();
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from('finance_fixed_expenses' as any)
      .delete()
      .eq('id', id);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Expense removed');
    fetch();
  };

  const today = new Date().toISOString().slice(0, 10);
  const activeExpenses = expenses.filter(e => isActiveOn(e, today));

  const monthlyTotal = activeExpenses.reduce((sum, e) => {
    const mult = getFrequencyMonthlyMultiplier(e.frequency);
    const inBase = convert(e.amount * mult, e.currency || baseCurrency, baseCurrency, fxRates);
    return sum + inBase;
  }, 0);

  // "Paid externally" is retired (bank APIs are connected) — all bills count.
  const monthlyTotalInternal = monthlyTotal;

  // Compute monthly total active on an arbitrary date (used by runway projections)
  const monthlyTotalOn = (isoDate: string) =>
    expenses.filter(e => isActiveOn(e, isoDate)).reduce((sum, e) => {
      const mult = getFrequencyMonthlyMultiplier(e.frequency);
      return sum + convert(e.amount * mult, e.currency || baseCurrency, baseCurrency, fxRates);
    }, 0);

  // Reimbursements from bills paid out of an external account (e.g. rent from Commbank).
  // Returns one entry per active, paid_externally monthly expense in base currency —
  // consumers add these to their income totals so the net isn't double-counted.
  // Retired: no phantom reimbursements any more.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const reimbursementsOn = (_isoDate: string): { id: string; name: string; amount: number }[] => [];

  return { expenses, activeExpenses, loading, add, update, remove, monthlyTotal, monthlyTotalInternal, monthlyTotalOn, reimbursementsOn, refetch: fetch };
}

export function useFixedExpenses() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFixedExpenses must be used within a FinanceProvider');
  }
  return context.fixedExpenses;
}
