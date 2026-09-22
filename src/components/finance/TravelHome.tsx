import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Plane, Calendar as CalendarIcon, Wallet, Sun, ArrowRight, BarChart3, LayoutDashboard, Sparkles, Plus, Receipt } from 'lucide-react';
import { format, differenceInCalendarDays, startOfDay, addDays, isSameDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import type { FinanceTransaction, FinanceGoal, FinanceCategory } from '@/hooks/useFinanceData';
import { computeTripSpent } from '@/lib/policyEngine';
import { formatCurrency } from '@/lib/financeUtils';
import { TripCategoryBreakdown } from '@/components/finance/TripCategoryBreakdown';
import { LogTripExpenseDialog } from '@/components/finance/LogTripExpenseDialog';

interface TravelHomeProps {
  trip: FinanceTrip;
  goal: FinanceGoal | null;
  transactions: FinanceTransaction[];
  categories?: FinanceCategory[];
  onExitToBudget: () => void;
}

export function TravelHome({ trip, goal, transactions, categories = [], onExitToBudget }: TravelHomeProps) {
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
      {/* Top Mode Switcher Pill Bar */}
      <div className="flex items-center justify-between gap-3 p-1.5 rounded-xl bg-muted/60 border border-border">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="default" className="gap-1.5 text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white">
            <Plane className="w-3.5 h-3.5" /> 🌴 Holiday Mode
          </Button>
          <Button size="sm" variant="ghost" onClick={onExitToBudget} className="gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <LayoutDashboard className="w-3.5 h-3.5" /> 📊 Standard Dashboard
          </Button>
        </div>
        <Badge variant="outline" className="hidden sm:flex text-[10px] border-sky-500/30 text-sky-600 dark:text-sky-400 gap-1">
          <Sparkles className="w-3 h-3 text-sky-500" /> Holiday budget isolated
        </Badge>
      </div>

      {/* Trip Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 flex items-center justify-center border border-sky-500/20 shadow-sm">
            <Plane className="w-6 h-6 text-sky-500" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
              {trip.name}
              <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 text-[11px]">
                Day {stats.dayIndex} of {stats.totalDays}
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <CalendarIcon className="w-3 h-3" />
              {trip.start_date && format(new Date(trip.start_date), 'MMM d')} → {trip.end_date && format(new Date(trip.end_date), 'MMM d, yyyy')}
              <span className="text-muted-foreground/60">· {stats.daysRemaining} days remaining</span>
            </p>
          </div>
        </div>

        {/* Quick Log Action */}
        <LogTripExpenseDialog
          tripId={trip.id}
          tripName={trip.name}
          categories={categories}
          trigger={
            <Button size="sm" className="gap-1.5 bg-sky-500 hover:bg-sky-600 text-white font-bold">
              <Plus className="w-3.5 h-3.5" /> Log Expense
            </Button>
          }
        />
      </div>

      {/* HERO: Today's Spend */}
      <Card className="border-2 border-sky-500/30 bg-gradient-to-br from-sky-500/[0.12] via-sky-500/[0.04] to-transparent shadow-sm">
        <CardContent className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5" /> Today's Budget Gauge
            </p>
            <Badge variant="secondary" className="text-[10px] bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 font-bold">
              Day {stats.dayIndex}/{stats.totalDays}
            </Badge>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-5xl sm:text-6xl font-black tabular-nums text-sky-600 dark:text-sky-400">
              {fmt(stats.todayLeft)}
            </span>
            <span className="text-sm font-semibold text-muted-foreground">left for today</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Spent {fmt(stats.spentToday)} of {fmt(stats.dailyBudgetRemaining)} today's target allowance
          </p>
          <Progress value={stats.dayPctUsed} className="h-2.5 bg-sky-500/20" />
        </CardContent>
      </Card>

      {/* Trip Pool Overview */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-sky-500" /> Trip Pool Overview
            </p>
            {goal && (
              <Badge variant="outline" className="text-[10px]">{goal.name}</Badge>
            )}
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-4xl font-black tabular-nums">{fmt(stats.poolRemaining)}</span>
            <span className="text-sm text-muted-foreground">of {fmt(stats.poolTotal)} remaining</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {fmt(stats.tripSpent)} spent · {stats.daysRemaining} day{stats.daysRemaining !== 1 ? 's' : ''} left
          </p>
          <Progress value={stats.pctUsed} className="h-2" />

          {/* Pacing */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target Daily Rate</p>
              <p className="text-lg font-bold tabular-nums">{fmt(stats.dailyBudgetEven)}<span className="text-xs text-muted-foreground font-normal">/day</span></p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {stats.pacingDelta > 0 ? 'Over Pace' : 'Under Pace'}
              </p>
              <p className={`text-lg font-bold tabular-nums ${stats.pacingDelta > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>
                {stats.pacingDelta > 0 ? '+' : ''}{fmt(stats.pacingDelta)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pie Chart Category Breakdown */}
      <TripCategoryBreakdown
        tripId={trip.id}
        startDate={trip.start_date}
        endDate={trip.end_date}
        transactions={transactions}
        categories={categories}
      />

      {/* Daily Breakdown Timeline */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-sky-500" /> Daily Burn Breakdown
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

      {/* Shortcuts */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('/travel/trips')}>
          Manage Trip & Checklist
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('/finance/transactions')}>
          All Transactions
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={onExitToBudget}>
          Standard Budget
        </Button>
      </div>
    </div>
  );
}

