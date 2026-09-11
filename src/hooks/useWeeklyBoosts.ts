import { useState, useEffect, useCallback, useContext } from 'react';
import { FinanceContext } from '@/contexts/FinanceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { startOfWeek, format } from 'date-fns';
import { toast } from 'sonner';

export interface WeeklyBoost {
  id: string;
  user_id: string;
  goal_id: string;
  amount: number;
  week_start: string;
  note: string | null;
  created_at: string;
}

export function useWeeklyBoostsState() {
  const { user } = useAuth();
  const [boosts, setBoosts] = useState<WeeklyBoost[]>([]);
  const [loading, setLoading] = useState(true);

  const currentWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const fetchBoosts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('finance_weekly_boosts' as any)
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      setBoosts((data as any) || []);
    } catch (err) {
      console.error('Boosts fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchBoosts(); }, [fetchBoosts]);

  const addBoost = async (goalId: string, amount: number, note?: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('finance_weekly_boosts' as any)
      .insert({
        user_id: user.id,
        goal_id: goalId,
        amount,
        week_start: currentWeekStart,
        note: note || null,
      } as any);
    if (error) {
      toast.error('Failed to add boost');
      return;
    }
    toast.success(`Added boost of ${amount} for this week`);
    fetchBoosts();
  };

  const removeBoost = async (id: string) => {
    const { error } = await supabase
      .from('finance_weekly_boosts' as any)
      .delete()
      .eq('id', id);
    if (error) {
      toast.error('Failed to remove boost');
      return;
    }
    fetchBoosts();
  };

  const totalBoostThisWeek = boosts
    .filter(b => b.week_start === currentWeekStart)
    .reduce((s, b) => s + b.amount, 0);

  return { boosts, loading, addBoost, removeBoost, totalBoostThisWeek, refetch: fetchBoosts };
}

export function useWeeklyBoosts() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useWeeklyBoosts must be used within a FinanceProvider');
  }
  return context.boosts;
}
