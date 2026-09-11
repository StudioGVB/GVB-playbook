import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { FinanceContext } from '@/contexts/FinanceContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { startOfWeek, format, addWeeks, isBefore } from 'date-fns';

export type WeekType = 'normal' | 'travel' | 'exception';

export interface WeekTypeRecord {
  id: string;
  user_id: string;
  week_start: string;
  week_type: WeekType;
  note: string | null;
  created_at: string;
}

interface TripRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

/** Build set of week_start keys covered by any trip's [start_date, end_date] window. */
function buildTripWeekKeys(trips: TripRow[]): Set<string> {
  const keys = new Set<string>();
  for (const t of trips) {
    if (!t.start_date || !t.end_date) continue;
    const start = new Date(t.start_date + 'T00:00');
    const end = new Date(t.end_date + 'T23:59');
    let cursor = startOfWeek(start, { weekStartsOn: 1 });
    while (isBefore(cursor, end) || cursor.getTime() === end.getTime() || cursor <= end) {
      keys.add(format(cursor, 'yyyy-MM-dd'));
      cursor = addWeeks(cursor, 1);
      // Safety bail: trips longer than ~2 years
      if (keys.size > 110) break;
    }
  }
  return keys;
}

export function useWeekTypesState() {
  const { user } = useAuth();
  const [weekTypes, setWeekTypes] = useState<WeekTypeRecord[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    const [wtRes, tripRes] = await Promise.all([
      supabase.from('finance_week_types' as any).select('*').eq('user_id', user.id).order('week_start', { ascending: false }),
      supabase.from('finance_trips' as any).select('id, name, start_date, end_date').eq('user_id', user.id),
    ]);
    if (wtRes.error) console.error('Week types fetch error', wtRes.error);
    else setWeekTypes((wtRes.data || []) as any);
    if (tripRes.error) console.error('Trips fetch error', tripRes.error);
    else setTrips((tripRes.data || []) as any);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const tripWeekKeys = useMemo(() => buildTripWeekKeys(trips), [trips]);

  const getWeekType = useCallback((weekStart: Date): WeekType => {
    const key = format(startOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const record = weekTypes.find(w => w.week_start === key);
    if (record) return record.week_type as WeekType;
    if (tripWeekKeys.has(key)) return 'travel';
    return 'normal';
  }, [weekTypes, tripWeekKeys]);

  /** Map of week_start string -> WeekType — manual records win, then auto-travel from trips. */
  const weekTypeMap = useCallback((): Map<string, WeekType> => {
    const map = new Map<string, WeekType>();
    // Layer 1: auto-travel from trip dates
    for (const key of tripWeekKeys) map.set(key, 'travel');
    // Layer 2: manual records override (exception or explicit normal-but-stored)
    for (const wt of weekTypes) map.set(wt.week_start, wt.week_type as WeekType);
    return map;
  }, [weekTypes, tripWeekKeys]);

  const setWeekType = useCallback(async (weekStart: Date, type: WeekType, note?: string) => {
    if (!user) return;
    const key = format(startOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    if (type === 'normal') {
      // Delete the manual record (normal is default). Note: auto-travel from trips will still apply.
      await supabase
        .from('finance_week_types' as any)
        .delete()
        .eq('user_id', user.id)
        .eq('week_start', key);
    } else {
      const { error } = await supabase
        .from('finance_week_types' as any)
        .upsert({
          user_id: user.id,
          week_start: key,
          week_type: type,
          note: note || null,
        } as any, { onConflict: 'user_id,week_start' } as any);
      if (error) {
        toast.error('Failed to set week type');
        console.error(error);
        return;
      }
    }
    toast.success(`Week marked as ${type}`);
    fetchAll();
  }, [user, fetchAll]);

  const isAutoTravel = useCallback((weekStart: Date): boolean => {
    const key = format(startOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const manual = weekTypes.find(w => w.week_start === key);
    return !manual && tripWeekKeys.has(key);
  }, [weekTypes, tripWeekKeys]);

  return { weekTypes, loading, getWeekType, setWeekType, weekTypeMap, isAutoTravel, refetch: fetchAll };
}

export function useWeekTypes() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useWeekTypes must be used within a FinanceProvider');
  }
  return context.weekTypes;
}
