import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/financeUtils';
import { startOfWeek, endOfWeek, eachWeekOfInterval, subWeeks, format, isWithinInterval, differenceInDays } from 'date-fns';
import { CalendarIcon, ChevronDown, ChevronUp, X } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const FREQ_TO_WEEKLY: Record<string, number> = {
  weekly: 1,
  fortnightly: 1 / 2,
  monthly: 12 / 52,
  quarterly: 4 / 52,
  yearly: 1 / 52,
};

export default function FinanceHistory() {
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
  const { expenses: fixedExpenses, monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll } = useFixedExpenses();
  const { weekTypes, getWeekType, setWeekType, weekTypeMap } = useWeekTypes();
  const { user } = useAuth();

  // Fetch ALL boosts (not just current week) for history
  const [allBoosts, setAllBoosts] = useState<{ week_start: string; amount: number }[]>([]);
  useEffect(() => {
    if (!user) return;
    supabase
      .from('finance_weekly_boosts' as any)
      .select('week_start, amount')
      .eq('user_id', user.id)
      .then(({ data }) => setAllBoosts((data as any) || []));
  }, [user]);

  // Map of week_start -> total boost for that week
  const boostByWeek = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of allBoosts) {
      map.set(b.week_start, (map.get(b.week_start) || 0) + b.amount);
    }
    return map;
  }, [allBoosts]);

  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [holidayRange, setHolidayRange] = useState<DateRange | undefined>();
  const [holidayType, setHolidayType] = useState<'travel' | 'exception'>('travel');
  const [holidayNote, setHolidayNote] = useState('');
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const catMap = useMemo(() => new Map(finance.categories.map(c => [c.id, c])), [finance.categories]);
  const essentialCatIds = useMemo(() => new Set(
    finance.categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)
  ), [finance.categories]);

  const fixedWeeklyCost = useMemo(() => {
    return fixedExpenses.reduce((sum, e) => sum + e.amount * (FREQ_TO_WEEKLY[e.frequency] || 12 / 52), 0);
  }, [fixedExpenses]);

  const wtMap = useMemo(() => weekTypeMap(), [weekTypeMap]);

  const weeklyBudget = useMemo(() => {
    if (!assumptions) return 0;
    const snapshot = computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions,
      finance.categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, 0, wtMap, [], fixedExpensesMonthlyAll,
    );
    return snapshot.weeklyEssentialBudget + snapshot.baseWeeklyFun;
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, wtMap]);

  const weeks = useMemo(() => {
    const now = new Date();
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    const twelveWeeksAgo = subWeeks(currentWeekStart, 11);
    return eachWeekOfInterval(
      { start: twelveWeeksAgo, end: currentWeekStart },
      { weekStartsOn: 1 }
    ).reverse();
  }, []);

  const weekData = useMemo(() => {
    return weeks.map(ws => {
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const key = format(ws, 'yyyy-MM-dd');
      const weekType = getWeekType(ws);

      const weekTxns = finance.transactions.filter(tx => {
        if (tx.amount >= 0 || tx.is_transfer || tx.is_fixed) return false;
        if ((tx as any).goal_id) return false;
        const d = new Date(tx.posted_at);
        if (!isWithinInterval(d, { start: ws, end: we })) return false;
        const cat = catMap.get(tx.category_id || '');
        if (cat?.exclude_from_reports) return false;
        if (cat?.type === 'fixed' || cat?.type === 'income' || cat?.type === 'transfer') return false;
        return true;
      });

      let essentialSpent = 0;
      let funSpent = 0;
      const categoryBreakdown = new Map<string, { name: string; amount: number; isEssential: boolean }>();
      const dailySpending = Array(7).fill(0);

      for (const tx of weekTxns) {
        const amt = Math.abs(tx.amount);
        const catId = tx.category_id || '__uncategorised';
        const cat = catMap.get(catId);
        const isEssential = essentialCatIds.has(catId);

        if (isEssential) essentialSpent += amt;
        else funSpent += amt;

        const existing = categoryBreakdown.get(catId);
        if (existing) {
          existing.amount += amt;
        } else {
          categoryBreakdown.set(catId, {
            name: cat?.name || 'Uncategorised',
            amount: amt,
            isEssential,
          });
        }

        const dayIdx = differenceInDays(new Date(tx.posted_at), ws);
        if (dayIdx >= 0 && dayIdx < 7) dailySpending[dayIdx] += amt;
      }

      const totalSpent = essentialSpent + funSpent;
      const isCurrentWeek = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') === key;
      const weekBoost = boostByWeek.get(key) || 0;
      const effectiveBudget = weeklyBudget + weekBoost;
      const effectiveFunSpent = Math.max(0, funSpent - weekBoost);
      const effectiveTotalSpent = essentialSpent + effectiveFunSpent;

      return {
        key,
        weekStart: ws,
        weekEnd: we,
        weekType,
        totalSpent,
        essentialSpent,
        funSpent,
        boostAmount: weekBoost,
        budget: effectiveBudget,
        overUnder: effectiveBudget - effectiveTotalSpent,
        isOver: effectiveTotalSpent > effectiveBudget,
        isCurrentWeek,
        categoryBreakdown: Array.from(categoryBreakdown.values()).sort((a, b) => b.amount - a.amount),
        dailySpending,
      };
    });
  }, [weeks, finance.transactions, catMap, essentialCatIds, weeklyBudget, getWeekType, boostByWeek]);

  if (finance.loading || assumptionsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Spending History</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Spending History</h1>
        <p className="text-muted-foreground text-sm">Week-by-week spending vs budget</p>
      </div>

      <div className="space-y-2">
        {weekData.map(w => {
          const isExpanded = expandedWeek === w.key;
          const effectiveSpent = w.essentialSpent + Math.max(0, w.funSpent - w.boostAmount);
          const percentSpent = w.budget > 0 ? Math.min((effectiveSpent / w.budget) * 100, 100) : 0;
          const barColor = w.isOver ? 'bg-destructive' : effectiveSpent > w.budget * 0.85 ? 'bg-amber-500' : 'bg-emerald-500';

          return (
            <Card key={w.key} className={`transition-colors ${w.isCurrentWeek ? 'border-primary/30' : ''}`}>
              <CardContent className="p-0">
                <button
                  className="w-full p-4 flex items-center gap-3 text-left"
                  onClick={() => setExpandedWeek(isExpanded ? null : w.key)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {format(w.weekStart, 'd MMM')} – {format(w.weekEnd, 'd MMM')}
                      </span>
                      {w.isCurrentWeek && (
                        <Badge variant="secondary" className="text-[10px] py-0">This week</Badge>
                      )}
                      {w.weekType !== 'normal' && (
                        <Badge variant="outline" className="text-[10px] py-0">
                          {w.weekType === 'travel' ? '🏖 Travel' : '⚡ Exception'}
                        </Badge>
                      )}
                      {w.boostAmount > 0 && (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          ⚡ +{fmt(w.boostAmount)} boost
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${percentSpent}%` }}
                      />
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold tabular-nums ${w.isOver ? 'text-destructive' : 'text-foreground'}`}>
                      {fmt(effectiveSpent)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {w.isOver ? `${fmt(Math.abs(w.overUnder))} over` : `${fmt(w.overUnder)} under`}
                    </p>
                  </div>

                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 border-t">
                    <div className="grid grid-cols-3 gap-3 pt-3">
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Essentials</p>
                        <p className="text-sm font-semibold tabular-nums">{fmt(w.essentialSpent)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fun</p>
                        <p className="text-sm font-semibold tabular-nums">{fmt(w.funSpent)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Budget</p>
                        <p className="text-sm font-semibold tabular-nums">{fmt(w.budget)}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Daily Spending</p>
                      <div className="flex items-end gap-1 h-16">
                        {w.dailySpending.map((amt, i) => {
                          const max = Math.max(...w.dailySpending, 1);
                          const height = (amt / max) * 100;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                              <span className="text-[8px] tabular-nums text-muted-foreground">
                                {amt > 0 ? fmt(amt) : ''}
                              </span>
                              <div className="w-full flex items-end" style={{ height: '40px' }}>
                                <div
                                  className="w-full rounded-t bg-primary/60"
                                  style={{ height: `${Math.max(height, amt > 0 ? 8 : 2)}%` }}
                                />
                              </div>
                              <span className="text-[8px] text-muted-foreground">{DAY_LABELS[i]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {w.categoryBreakdown.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">By Category</p>
                        <div className="space-y-1">
                          {w.categoryBreakdown.map(cat => (
                            <div key={cat.name} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${cat.isEssential ? 'bg-primary' : 'bg-accent'}`} />
                                <span className="text-muted-foreground">{cat.name}</span>
                                {cat.isEssential && (
                                  <Badge variant="outline" className="text-[8px] py-0 px-1">Essential</Badge>
                                )}
                              </div>
                              <span className="font-medium tabular-nums">{fmt(cat.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Collapsible open={calendarOpen} onOpenChange={setCalendarOpen}>
        <Card>
          <CardContent className="p-4">
            <CollapsibleTrigger className="w-full flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Mark Holiday / Exception Period
                </p>
              </div>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${calendarOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>

            <CollapsibleContent className="mt-4 space-y-4">
              <Calendar
                mode="range"
                selected={holidayRange}
                onSelect={setHolidayRange}
                className="p-3 pointer-events-auto rounded-md border mx-auto"
                numberOfMonths={1}
              />

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Type</label>
                <Select value={holidayType} onValueChange={(v) => setHolidayType(v as 'travel' | 'exception')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="travel">🏖 Travel / Holiday</SelectItem>
                    <SelectItem value="exception">⚡ Exception</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Note (optional)</label>
                <Input
                  value={holidayNote}
                  onChange={(e) => setHolidayNote(e.target.value)}
                  placeholder="e.g. Trip to Melbourne"
                />
              </div>

              <Button
                className="w-full"
                disabled={!holidayRange?.from || savingHoliday}
                onClick={async () => {
                  if (!holidayRange?.from) return;
                  setSavingHoliday(true);
                  const end = holidayRange.to || holidayRange.from;
                  const allWeeks = eachWeekOfInterval(
                    { start: holidayRange.from, end },
                    { weekStartsOn: 1 }
                  );
                  for (const ws of allWeeks) {
                    await setWeekType(ws, holidayType, holidayNote || undefined);
                  }
                  setHolidayRange(undefined);
                  setHolidayNote('');
                  setSavingHoliday(false);
                }}
              >
                {savingHoliday ? 'Saving...' : 'Mark Period'}
              </Button>

              {weekTypes.length > 0 && (
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Marked Weeks</p>
                  {weekTypes.map(wt => (
                    <div key={wt.id} className="flex items-center justify-between text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span>{wt.week_type === 'travel' ? '🏖' : '⚡'}</span>
                        <span className="tabular-nums">{format(new Date(wt.week_start + 'T00:00:00'), 'd MMM yyyy')}</span>
                        {wt.note && <span className="text-muted-foreground text-xs">— {wt.note}</span>}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setWeekType(new Date(wt.week_start + 'T00:00:00'), 'normal')}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>
    </div>
  );
}
