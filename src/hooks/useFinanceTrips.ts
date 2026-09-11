import { useState, useEffect, useCallback, useContext } from 'react';
import { FinanceContext } from '@/contexts/FinanceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface TripChecklistItem {
  label: string;
  done: boolean;
}

export interface FinanceTrip {
  id: string;
  user_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  goal_id: string | null;
  checklist: TripChecklistItem[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_CHECKLIST: TripChecklistItem[] = [
  { label: 'Travel pool funded', done: false },
  { label: 'Pause non-essential subscriptions', done: false },
  { label: 'Notify bank of travel', done: false },
  { label: 'Set up roaming / travel SIM', done: false },
  { label: 'Schedule fixed bill payments', done: false },
];

export function useFinanceTripsState() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<FinanceTrip[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('finance_trips' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('start_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      setTrips((data || []) as any);
    } catch (err) {
      console.error('Trips fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const createTrip = async (name = 'New Trip'): Promise<FinanceTrip | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('finance_trips' as any)
      .insert({
        user_id: user.id,
        name,
        checklist: DEFAULT_CHECKLIST,
      } as any)
      .select()
      .single();
    if (error) { toast.error('Failed to create trip'); return null; }
    toast.success('Trip created');
    await fetch();
    return data as any;
  };

  const updateTrip = async (id: string, updates: Partial<Omit<FinanceTrip, 'id' | 'user_id' | 'created_at' | 'updated_at'>>, silent = false) => {
    const { error } = await supabase
      .from('finance_trips' as any)
      .update(updates as any)
      .eq('id', id);
    if (error) { toast.error('Failed to update trip'); return; }
    if (!silent) toast.success('Trip saved');
    await fetch();
  };

  const deleteTrip = async (id: string) => {
    const { error } = await supabase
      .from('finance_trips' as any)
      .delete()
      .eq('id', id);
    if (error) { toast.error('Failed to delete trip'); return; }
    // Untag transactions
    await supabase
      .from('finance_transactions')
      .update({ trip_id: null } as any)
      .eq('trip_id', id);
    toast.success('Trip deleted');
    await fetch();
  };

  return { trips, loading, createTrip, updateTrip, deleteTrip, refetch: fetch, DEFAULT_CHECKLIST };
}

export function useFinanceTrips() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFinanceTrips must be used within a FinanceProvider');
  }
  return context.trips;
}
