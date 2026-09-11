import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays } from 'lucide-react';
import { format, differenceInCalendarDays, startOfDay, addDays, isSameDay, getDay } from 'date-fns';
import type { FinanceTransaction } from '@/hooks/useFinanceData';
import { formatCurrency } from '@/lib/financeUtils';

interface TripDailyBreakdownProps {
  tripId: string;
  startDate: Date | null;
  endDate: Date | null;
  poolTotal: number;
  transactions: FinanceTransaction[];
  className?: string;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Mon=0..Sun=6 indexing
const mondayIndex = (d: Date) => (getDay(d) + 6) % 7;

interface DayCell {
  date: Date;
  dayNum: number;
  spent: number;
  txCount: number;
  isFuture: boolean;
  isToday: boolean;
  inTrip: boolean;
}

export function TripDailyBreakdown({
  tripId, startDate, endDate, poolTotal, transactions, className,
}: TripDailyBreakdownProps) {
  const fmt = (n: number) => formatCurrency(n, 'AUD');
  const fmtCompact = (n: number) => {
    if (n === 0) return '';
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${Math.round(n)}`;
  };

  const data = useMemo(() => {
    if (!startDate || !endDate) return null;
    const today = startOfDay(new Date());
    const start = startOfDay(startDate);
    const end = startOfDay(endDate);
    const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
    const dailyEven = poolTotal / totalDays;

    const tripTxs = transactions.filter(tx => {
      if (tx.is_transfer || tx.amount >= 0) return false;
      if ((tx as any).trip_id === tripId) return true;
      // Auto-include any spend during trip dates (untagged travel spend)
      const d = startOfDay(new Date(tx.posted_at));
      return d >= start && d <= end;
    });

    // Build calendar grid: pad start to Monday, end to Sunday
    const padStart = mondayIndex(start);
    const gridStart = addDays(start, -padStart);
    const padEnd = 6 - mondayIndex(end);
    const gridEnd = addDays(end, padEnd);
    const totalGridDays = differenceInCalendarDays(gridEnd, gridStart) + 1;

    const cells: DayCell[] = [];
    let totalSpent = 0;
    for (let i = 0; i < totalGridDays; i++) {
      const d = addDays(gridStart, i);
      const inTrip = d >= start && d <= end;
      const dayNum = inTrip ? differenceInCalendarDays(d, start) + 1 : 0;
      const dayTxs = inTrip
        ? tripTxs.filter(tx => isSameDay(startOfDay(new Date(tx.posted_at)), d))
        : [];
      const spent = dayTxs.reduce((s, tx) => s + Math.abs(tx.amount), 0);
      if (inTrip) totalSpent += spent;
      cells.push({
        date: d, dayNum, spent, txCount: dayTxs.length,
        isFuture: d > today,
        isToday: isSameDay(d, today),
        inTrip,
      });
    }

    // Split into week-rows
    const weeks: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    const maxDaySpend = Math.max(dailyEven, ...cells.map(c => c.spent));
    return { weeks, dailyEven, maxDaySpend, totalSpent, totalDays };
  }, [tripId, startDate, endDate, poolTotal, transactions]);

  if (!data) return null;

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" /> Daily Breakdown
          </p>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">Target {fmt(data.dailyEven)}/day</Badge>
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAY_LABELS.map(l => (
            <div key={l} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-center">
              {l}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="space-y-1.5">
          {data.weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {week.map((c, ci) => {
                if (!c.inTrip) {
                  return <div key={ci} className="aspect-square rounded-md bg-muted/20" />;
                }
                const overBudget = c.spent > data.dailyEven && data.dailyEven > 0;
                const heightPct = data.maxDaySpend > 0 ? (c.spent / data.maxDaySpend) * 100 : 0;
                return (
                  <div
                    key={ci}
                    className={`aspect-square rounded-md border relative overflow-hidden flex flex-col p-1.5 ${
                      c.isToday ? 'border-sky-500 border-2' :
                      c.isFuture ? 'border-border/40 bg-muted/10' :
                      'border-border bg-card'
                    }`}
                  >
                    {/* Spend fill from bottom */}
                    {c.spent > 0 && (
                      <div
                        className={`absolute inset-x-0 bottom-0 ${
                          overBudget ? 'bg-orange-500/25' :
                          c.isToday ? 'bg-sky-500/25' :
                          'bg-emerald-500/20'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    )}
                    {/* Date label */}
                    <div className="relative flex items-start justify-between">
                      <span className={`text-[11px] font-bold leading-none ${
                        c.isToday ? 'text-sky-500' :
                        c.isFuture ? 'text-muted-foreground/50' :
                        'text-foreground'
                      }`}>
                        {format(c.date, 'd')}
                      </span>
                      {c.txCount > 0 && (
                        <span className="text-[8px] text-muted-foreground leading-none mt-0.5">
                          {c.txCount}
                        </span>
                      )}
                    </div>
                    {/* Spend amount */}
                    <div className="relative mt-auto">
                      {c.spent > 0 ? (
                        <p className={`text-[10px] font-bold tabular-nums leading-tight ${
                          overBudget ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'
                        }`}>
                          {fmtCompact(c.spent)}
                        </p>
                      ) : !c.isFuture ? (
                        <p className="text-[10px] text-muted-foreground/40 leading-tight">—</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer summary */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t text-[11px]">
          <span className="text-muted-foreground">Trip total</span>
          <span className="font-bold tabular-nums">{fmt(data.totalSpent)} <span className="text-muted-foreground font-normal">over {data.totalDays} days</span></span>
        </div>
      </CardContent>
    </Card>
  );
}
