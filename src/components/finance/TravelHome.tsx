import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Plane, Calendar as CalendarIcon, Wallet, Sun, ArrowRight, BarChart3 } from 'lucide-react';
import { format, differenceInCalendarDays, startOfDay, addDays, isSameDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import type { FinanceTransaction, FinanceGoal } from '@/hooks/useFinanceData';
import { computeTripSpent } from '@/lib/policyEngine';
import { formatCurrency } from '@/lib/financeUtils';

interface TravelHomeProps {
  trip: FinanceTrip;
  goal: FinanceGoal | null;
  transactions: FinanceTransaction[];
  onExitToBudget: () => void;
}

export function TravelHome({ trip, goal, transactions, onExitToBudget }: TravelHomeProps) {
  const navigate = useNavigate();
  const fmt = (n: number) => formatCurrency(n, 'AUD');

  const stats = useMemo(() => {
    const today = startOfDay(new Date());
    const start = trip.start_date ? startOfDay(new Date(trip.start_date)) : today;
    const end = trip.end_date ? startOfDay(new Date(trip.end_date)) : today;

    const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
    const dayIndex = Math.min(totalDays, Math.max(1, differenceInCalendarDays(today, start) + 1));
    const daysRemaining = Math.max(1, differenceInCalendarDays(end, today) + 1);

    const poolTotal = goal?.assigned_amount || 0;
    const tripSpent = computeTripSpent(transactions, trip.id, trip.start_date, trip.end_date);
    const poolRemaining = Math.max(0, poolTotal - tripSpent);

    // Trip spend includes tagged transactions OR any spend within trip date range
    const tripTxs = transactions.filter(tx => {
      if (tx.is_transfer || tx.amount >= 0) return false;
      if ((tx as any).trip_id === trip.id) return true;
      const d = startOfDay(new Date(tx.posted_at));
      return d >= start && d <= end;
    });

    // Spending today
    const spentToday = tripTxs
      .filter(tx => startOfDay(new Date(tx.posted_at)).getTime() === today.getTime())
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    const dailyBudgetEven = poolTotal / totalDays;
    const dailyBudgetRemaining = poolRemaining / daysRemaining;
    const todayLeft = Math.max(0, dailyBudgetRemaining - spentToday);

    const pctUsed = poolTotal > 0 ? Math.min(100, (tripSpent / poolTotal) * 100) : 0;
    const dayPctUsed = dailyBudgetRemaining > 0 ? Math.min(100, (spentToday / dailyBudgetRemaining) * 100) : 0;

    // On-pace check
    const idealSpentByNow = (dayIndex / totalDays) * poolTotal;
    const pacingDelta = tripSpent - idealSpentByNow;
    const dailyBreakdown: Array<{
      date: Date;
      dayNum: number;
      spent: number;
      txCount: number;
      isFuture: boolean;
      isToday: boolean;
    }> = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(start, i);
      const dayTxs = tripTxs.filter(tx => isSameDay(startOfDay(new Date(tx.posted_at)), d));
      const spent = dayTxs.reduce((s, tx) => s + Math.abs(tx.amount), 0);
      dailyBreakdown.push({
        date: d,
        dayNum: i + 1,
        spent,
        txCount: dayTxs.length,
        isFuture: d > today,
        isToday: isSameDay(d, today),
      });
    }
    const maxDaySpend = Math.max(dailyBudgetEven, ...dailyBreakdown.map(d => d.spent));

    return {
      totalDays, dayIndex, daysRemaining,
      poolTotal, tripSpent, poolRemaining,
      spentToday, dailyBudgetEven, dailyBudgetRemaining, todayLeft,
      pctUsed, dayPctUsed, pacingDelta,
      dailyBreakdown, maxDaySpend,
    };
  }, [trip, goal, transactions]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto px-3 sm:px-0">
      {/* Trip header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 flex items-center justify-center">
            <Plane className="w-5 h-5 text-sky-500" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight">{trip.name}</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="w-3 h-3" />
              {trip.start_date && format(new Date(trip.start_date), 'MMM d')} → {trip.end_date && format(new Date(trip.end_date), 'MMM d, yyyy')}
              <span className="text-muted-foreground/60">· Day {stats.dayIndex} of {stats.totalDays}</span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onExitToBudget} className="gap-1.5">
          Budget <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* HERO: Today's spend */}
      <Card className="border-2 border-sky-500/30 bg-gradient-to-br from-sky-500/[0.08] via-sky-500/[0.03] to-transparent">
        <CardContent className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5" /> Today's Budget
            </p>
            <Badge variant="secondary" className="text-[10px] bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30">
              Day {stats.dayIndex}/{stats.totalDays}
            </Badge>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-5xl sm:text-6xl font-black tabular-nums text-sky-600 dark:text-sky-400">
              {fmt(stats.todayLeft)}
            </span>
            <span className="text-sm text-muted-foreground">left today</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Spent {fmt(stats.spentToday)} of {fmt(stats.dailyBudgetRemaining)} daily allowance
          </p>
          <Progress value={stats.dayPctUsed} className="h-2" />
        </CardContent>
      </Card>

      {/* Trip pool overview */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Trip Pool
            </p>
            {goal && (
              <Badge variant="outline" className="text-[10px]">{goal.name}</Badge>
            )}
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-4xl font-black tabular-nums">{fmt(stats.poolRemaining)}</span>
            <span className="text-sm text-muted-foreground">of {fmt(stats.poolTotal)} left</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {fmt(stats.tripSpent)} spent · {stats.daysRemaining} day{stats.daysRemaining !== 1 ? 's' : ''} remaining
          </p>
          <Progress value={stats.pctUsed} className="h-2" />

          {/* Pacing */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Even split</p>
              <p className="text-lg font-bold tabular-nums">{fmt(stats.dailyBudgetEven)}<span className="text-xs text-muted-foreground font-normal">/day</span></p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {stats.pacingDelta > 0 ? 'Over pace' : 'Under pace'}
              </p>
              <p className={`text-lg font-bold tabular-nums ${stats.pacingDelta > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>
                {stats.pacingDelta > 0 ? '+' : ''}{fmt(stats.pacingDelta)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Daily breakdown */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" /> Daily Breakdown
            </p>
            <Badge variant="outline" className="text-[10px]">Target {fmt(stats.dailyBudgetEven)}/day</Badge>
          </div>
          <div className="space-y-2">
            {stats.dailyBreakdown.map(d => {
              const pct = stats.maxDaySpend > 0 ? (d.spent / stats.maxDaySpend) * 100 : 0;
              const overBudget = d.spent > stats.dailyBudgetEven;
              return (
                <div
                  key={d.dayNum}
                  className={`flex items-center gap-3 py-1.5 ${d.isFuture ? 'opacity-40' : ''}`}
                >
                  <div className="w-20 flex-shrink-0">
                    <p className={`text-xs font-semibold ${d.isToday ? 'text-sky-500' : 'text-foreground'}`}>
                      {format(d.date, 'EEE d')}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Day {d.dayNum}</p>
                  </div>
                  <div className="flex-1 relative h-6 rounded-md bg-muted/40 overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-md ${
                        overBudget ? 'bg-orange-500/60' : d.isToday ? 'bg-sky-500/60' : 'bg-emerald-500/50'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                    {/* Target line marker */}
                    {stats.maxDaySpend > 0 && (
                      <div
                        className="absolute inset-y-0 w-px bg-foreground/30"
                        style={{ left: `${(stats.dailyBudgetEven / stats.maxDaySpend) * 100}%` }}
                      />
                    )}
                  </div>
                  <div className="w-24 text-right flex-shrink-0">
                    <p className={`text-sm font-bold tabular-nums ${overBudget ? 'text-orange-500' : ''}`}>
                      {d.isFuture && d.spent === 0 ? '—' : fmt(d.spent)}
                    </p>
                    {d.txCount > 0 && (
                      <p className="text-[10px] text-muted-foreground">{d.txCount} tx</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('/finance/travel')}>
          Manage trip
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('/finance/transactions')}>
          Transactions
        </Button>
      </div>
    </div>
  );
}
