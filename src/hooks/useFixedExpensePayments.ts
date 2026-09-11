import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { startOfWeek, startOfMonth, startOfQuarter, startOfYear, format, subDays } from 'date-fns';

export interface FixedExpensePayment {
  id: string;
  user_id: string;
  fixed_expense_id: string;
  period_start: string;
  amount: number;
  paid_at: string;
  created_at: string;
}

/** Returns the current period start date for a given frequency */
function getCurrentPeriodStart(frequency: string, now: Date = new Date()): string {
  switch (frequency) {
    case 'weekly':
      return format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    case 'fortnightly': {
      // Use ISO week number; even weeks = period start
      const ws = startOfWeek(now, { weekStartsOn: 1 });
      const weekNum = Math.floor((ws.getTime() - new Date(ws.getFullYear(), 0, 1).getTime()) / (7 * 86400000));
      const periodStart = weekNum % 2 === 0 ? ws : subDays(ws, 7);
      return format(periodStart, 'yyyy-MM-dd');
    }
    case 'monthly':
      return format(startOfMonth(now), 'yyyy-MM-dd');
    case 'quarterly':
      return format(startOfQuarter(now), 'yyyy-MM-dd');
    case 'yearly':
      return format(startOfYear(now), 'yyyy-MM-dd');
    default:
      return format(startOfMonth(now), 'yyyy-MM-dd');
  }
}

export function useFixedExpensePayments() {
  const { user } = useAuth();
  const [payments, setPayments] = useState<FixedExpensePayment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data, error }, { data: expenses }] = await Promise.all([
      supabase.from('finance_fixed_expense_payments' as any).select('*').eq('user_id', user.id).order('paid_at', { ascending: false }),
      supabase.from('finance_fixed_expenses' as any).select('id, amount, frequency, auto_pay, due_day, effective_from, effective_to').eq('user_id', user.id).eq('auto_pay', true),
    ]);
    if (error) { console.error(error); setLoading(false); return; }
    let all = (data as any[]) || [];

    // Auto-insert payments for auto_pay expenses when period has arrived
    const today = new Date();
    const todayIso = format(today, 'yyyy-MM-dd');
    const toInsert: any[] = [];
    for (const e of (expenses as any[]) || []) {
      if (e.effective_from && todayIso < e.effective_from) continue;
      if (e.effective_to && todayIso > e.effective_to) continue;
      const periodStart = getCurrentPeriodStart(e.frequency);
      const dueDay = e.due_day || 1;
      const dueDate = new Date(periodStart);
      dueDate.setDate(dueDay);
      if (today < dueDate) continue;
      const already = all.some(p => p.fixed_expense_id === e.id && p.period_start === periodStart);
      if (already) continue;
      toInsert.push({ user_id: user.id, fixed_expense_id: e.id, period_start: periodStart, amount: e.amount });
    }
    if (toInsert.length) {
      const { data: inserted } = await supabase
        .from('finance_fixed_expense_payments' as any)
        .insert(toInsert as any)
        .select('*');
      if (inserted) all = [...(inserted as any[]), ...all];
    }

    setPayments(all);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const markPaid = async (expenseId: string, frequency: string, amount: number) => {
    if (!user) return;
    const periodStart = getCurrentPeriodStart(frequency);
    const { error } = await supabase
      .from('finance_fixed_expense_payments' as any)
      .insert({ user_id: user.id, fixed_expense_id: expenseId, period_start: periodStart, amount } as any);
    if (error) {
      if (error.code === '23505') {
        toast.info('Already marked as paid for this period');
      } else {
        toast.error('Failed to mark as paid');
        console.error(error);
      }
      return;
    }
    toast.success('Marked as paid');
    fetchPayments();
  };

  const unmarkPaid = async (expenseId: string, frequency: string) => {
    if (!user) return;
    const periodStart = getCurrentPeriodStart(frequency);
    const payment = payments.find(
      p => p.fixed_expense_id === expenseId && p.period_start === periodStart
    );
    if (!payment) return;
    const { error } = await supabase
      .from('finance_fixed_expense_payments' as any)
      .delete()
      .eq('id', payment.id);
    if (error) { toast.error('Failed to undo'); return; }
    toast.success('Unmarked');
    fetchPayments();
  };

  /** Check if a specific expense is paid for the current period */
  const isPaidThisPeriod = useCallback((expenseId: string, frequency: string): boolean => {
    const periodStart = getCurrentPeriodStart(frequency);
    return payments.some(p => p.fixed_expense_id === expenseId && p.period_start === periodStart);
  }, [payments]);

  /** Total amount paid this month (for runway deduction) */
  const totalPaidThisMonth = useMemo(() => {
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    return payments
      .filter(p => p.paid_at >= monthStart)
      .reduce((sum, p) => sum + p.amount, 0);
  }, [payments]);

  return { payments, loading, markPaid, unmarkPaid, isPaidThisPeriod, totalPaidThisMonth, refetch: fetchPayments };
}
