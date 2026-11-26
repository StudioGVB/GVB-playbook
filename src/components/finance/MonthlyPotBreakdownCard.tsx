import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from 'recharts';
import {
  BarChart3,
  Sparkles,
  Scale,
} from 'lucide-react';
import {
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isSameMonth,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import type { FinanceGoal, FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';

interface Props {
  goals: FinanceGoal[];
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  trips?: FinanceTrip[];
  convertToBase: (amount: number, currency: string) => number;
  baseCurrency: string;
  monthlyPotCapacity?: number;
  onSelectGoalExpenses?: (goal: FinanceGoal) => void;
}

interface ActiveGoalMeta {
  goal: FinanceGoal;
  color: string;
  targetBase: number;
  assignedBase: number;
  spentBase: number;
  effectiveFundedBase: number;
  remainingToSaveBase: number;
  effectiveStart: Date;
  effectiveDeadline: Date;
  rawStart: Date | null;
  rawDeadline: Date | null;
  totalActiveDays: number;
}

interface MonthPotContribution {
  goal: FinanceGoal;
  color: string;
  amount: number;
  evenAmount: number;
  isBoosted: boolean;
  activeDays: number;
  weeklyPaceInMonth: number;
  projectedFundedAfterMonth: number;
  targetBase: number;
  startsThisMonth: boolean;
  endsThisMonth: boolean;
}

interface MonthSeriesPoint {
  monthKey: string;
  monthLabel: string;
  shortLabel: string;
  monthDate: Date;
  isCurrentMonth: boolean;
  isNextMonth: boolean;
  total: number;
  totalLabel: string;
  contributions: MonthPotContribution[];
  [goalId: string]: any;
}

const FALLBACK_COLORS = [
  '#4558ff',
  '#FF2EB8',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#6366f1',
];

const isProtectedSystemPot = (g: FinanceGoal) => {
  if ((g as any).is_emergency || (g as any).is_stash) return true;
  const lower = (g.name || '').trim().toLowerCase();
  return (
    lower.includes('emergency') ||
    lower.includes('stash') ||
    lower === 'savings' ||
    lower === 'core savings'
  );
};

export default function MonthlyPotBreakdownCard({
  goals,
  transactions,
  categories,
  convertToBase,
  baseCurrency,
  monthlyPotCapacity = 0,
}: Props) {
  const [pacingMode, setPacingMode] = useState<'dynamic' | 'even'>('dynamic');
  const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const fmt = (n: number) => formatCurrency(n, baseCurrency);
  const fmtCompact = (n: number) => {
    if (n <= 0) return '';
    return formatCurrency(Math.round(n), baseCurrency).replace(/\.00$/, '');
  };

  // Compute total spent per goal
  const spentByGoalTotal = useMemo(() => {
    const totalMap = new Map<string, number>();
    const catByLowerName = new Map<string, string>();
    categories.forEach(c => {
      if (c.name) catByLowerName.set(c.name.trim().toLowerCase(), c.id);
    });

    const goalByCatId = new Map<string, string>();
    goals.forEach(g => {
      if (isProtectedSystemPot(g)) return;
      const cid = catByLowerName.get((g.name || '').trim().toLowerCase());
      if (cid) goalByCatId.set(cid, g.id);
    });

    for (const tx of transactions) {
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).transfer_status === 'confirmed' || (tx as any).transfer_status === 'auto_confirmed') continue;
      const directGoalId = (tx as any).goal_id as string | undefined;
      const matchedGoalId = directGoalId || (tx.category_id ? goalByCatId.get(tx.category_id) : undefined);
      if (!matchedGoalId) continue;

      const amt = Math.abs(baseAmt(tx));
      totalMap.set(matchedGoalId, (totalMap.get(matchedGoalId) || 0) + amt);
    }

    return totalMap;
  }, [goals, transactions, categories]);

  // Build active goal metadata & monthly stacked bar chart series
  const { activeGoalMetas, chartData } = useMemo(() => {
    const today = startOfDay(new Date());
    const currentMonthStart = startOfMonth(today);

    const eligibleGoals = goals.filter(g => !isProtectedSystemPot(g));

    const metas: ActiveGoalMeta[] = [];
    let maxMonthDate = addMonths(currentMonthStart, 5);

    eligibleGoals.forEach((g, idx) => {
      const targetBase = convertToBase(g.target_amount || 0, g.currency);
      const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
      const spentBase = spentByGoalTotal.get(g.id) || 0;
      const refillWhenSpent = Boolean(g.refill_when_spent);
      const effectiveFundedBase = refillWhenSpent ? assignedBase : assignedBase + spentBase;
      const remainingToSaveBase = Math.max(0, targetBase - effectiveFundedBase);

      if (remainingToSaveBase <= 0.01) return;

      const rawStart = g.start_date
        ? startOfDay(new Date(String(g.start_date).split('T')[0] + 'T00:00:00'))
        : null;
      const effectiveStart = rawStart && rawStart > today ? rawStart : today;

      const rawDeadline = g.deadline
        ? startOfDay(new Date(String(g.deadline).split('T')[0] + 'T00:00:00'))
        : null;

      // For goals without a deadline, spread over 6 months by default so they still appear cleanly
      const fallbackDeadline = endOfMonth(addMonths(effectiveStart, 5));
      const effectiveDeadline = rawDeadline
        ? rawDeadline < effectiveStart
          ? effectiveStart
          : rawDeadline
        : fallbackDeadline;

      const dlMonth = startOfMonth(effectiveDeadline);
      if (dlMonth > maxMonthDate) maxMonthDate = dlMonth;

      const totalActiveDays = Math.max(
        1,
        differenceInCalendarDays(effectiveDeadline, effectiveStart) + 1
      );

      metas.push({
        goal: g,
        color: g.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
        targetBase,
        assignedBase,
        spentBase,
        effectiveFundedBase,
        remainingToSaveBase,
        effectiveStart,
        effectiveDeadline,
        rawStart,
        rawDeadline,
        totalActiveDays,
      });
    });

    // Sort active goals by deadline (soonest first) so urgent short-term goals get priority first
    metas.sort((a, b) => a.effectiveDeadline.getTime() - b.effectiveDeadline.getTime());

    // Cap horizon at 12 months forward
    const maxHorizon = addMonths(currentMonthStart, 11);
    if (maxMonthDate > maxHorizon) maxMonthDate = maxHorizon;

    const months: Date[] = [];
    let cursor = currentMonthStart;
    while (cursor <= maxMonthDate) {
      months.push(cursor);
      cursor = addMonths(cursor, 1);
    }

    // Available calendar days in each month (for current month, remaining days from today)
    const monthAvailableDays = months.map((mDate, mIdx) => {
      const mStart = startOfMonth(mDate);
      const mEnd = endOfMonth(mDate);
      const winStart = mIdx === 0 && today > mStart ? today : mStart;
      return Math.max(1, differenceInCalendarDays(mEnd, winStart) + 1);
    });

    // Precompute active days w_{g,m} and even linear amount for each goal in each month
    const activeDaysMatrix = new Map<string, number[]>();
    const evenAllocMatrix = new Map<string, number[]>();
    const dynamicAllocMatrix = new Map<string, number[]>();

    for (const meta of metas) {
      const daysPerMonth: number[] = [];
      const evenPerMonth: number[] = [];

      months.forEach((mDate, mIdx) => {
        const mStart = startOfMonth(mDate);
        const mEnd = endOfMonth(mDate);
        const windowStart = meta.effectiveStart > mStart ? meta.effectiveStart : mStart;
        const windowEnd = meta.effectiveDeadline < mEnd ? meta.effectiveDeadline : mEnd;

        if (windowEnd >= windowStart) {
          const activeDays = differenceInCalendarDays(windowEnd, windowStart) + 1;
          daysPerMonth[mIdx] = activeDays;
          evenPerMonth[mIdx] = (meta.remainingToSaveBase * activeDays) / meta.totalActiveDays;
        } else {
          daysPerMonth[mIdx] = 0;
          evenPerMonth[mIdx] = 0;
        }
      });

      activeDaysMatrix.set(meta.goal.id, daysPerMonth);
      evenAllocMatrix.set(meta.goal.id, evenPerMonth);
    }

    // Compute Dynamic Smart Pacing via urgency-ordered water-filling:
    // Early-deadline goals claim capacity first; longer-deadline goals (e.g. Italy, Ski trip, Visa)
    // stay lighter during crowded winter/spring months and automatically ramp up in months where earlier goals have finished.
    const monthCommittedLoad = new Array(months.length).fill(0);

    for (const meta of metas) {
      const daysPerMonth = activeDaysMatrix.get(meta.goal.id)!;
      const evenPerMonth = evenAllocMatrix.get(meta.goal.id)!;
      const activeMonthIndices = daysPerMonth
        .map((d, idx) => (d > 0 ? idx : -1))
        .filter(idx => idx !== -1);

      if (activeMonthIndices.length <= 1) {
        dynamicAllocMatrix.set(meta.goal.id, [...evenPerMonth]);
        activeMonthIndices.forEach(idx => {
          monthCommittedLoad[idx] += evenPerMonth[idx];
        });
        continue;
      }

      // Keep 20% baseline linear contribution in every active month so the goal always makes steady progress,
      // and water-fill the remaining 80% into the months that have the lowest competing goal load.
      const BASELINE_RATIO = 0.2;
      const baselinePerMonth = evenPerMonth.map(amt => amt * BASELINE_RATIO);
      const flexRemaining = meta.remainingToSaveBase * (1 - BASELINE_RATIO);

      // Existing daily load u_m in each active month
      const dailyLoad = months.map((_, mIdx) => {
        return (monthCommittedLoad[mIdx] + baselinePerMonth[mIdx]) / monthAvailableDays[mIdx];
      });

      let low = Math.min(...activeMonthIndices.map(mIdx => dailyLoad[mIdx]));
      let high =
        Math.max(...activeMonthIndices.map(mIdx => dailyLoad[mIdx])) +
        flexRemaining / Math.min(...activeMonthIndices.map(mIdx => Math.max(1, daysPerMonth[mIdx])));

      for (let iter = 0; iter < 45; iter++) {
        const mid = (low + high) / 2;
        let allocated = 0;
        for (const mIdx of activeMonthIndices) {
          if (mid > dailyLoad[mIdx]) {
            allocated += daysPerMonth[mIdx] * (mid - dailyLoad[mIdx]);
          }
        }
        if (allocated < flexRemaining) {
          low = mid;
        } else {
          high = mid;
        }
      }

      const waterLevel = (low + high) / 2;
      const dynPerMonth = months.map((_, mIdx) => {
        if (daysPerMonth[mIdx] <= 0) return 0;
        const flexAdd = daysPerMonth[mIdx] * Math.max(0, waterLevel - dailyLoad[mIdx]);
        return baselinePerMonth[mIdx] + flexAdd;
      });

      dynamicAllocMatrix.set(meta.goal.id, dynPerMonth);
      activeMonthIndices.forEach(mIdx => {
        monthCommittedLoad[mIdx] += dynPerMonth[mIdx];
      });
    }

    const cumulativeByGoal = new Map<string, number>();
    metas.forEach(m => cumulativeByGoal.set(m.goal.id, m.effectiveFundedBase));

    const series: MonthSeriesPoint[] = months.map((mDate, mIdx) => {
      const mKey = format(mDate, 'yyyy-MM');

      const point: MonthSeriesPoint = {
        monthKey: mKey,
        monthLabel: format(mDate, 'MMMM yyyy'),
        shortLabel: format(mDate, 'MMM yy'),
        monthDate: mDate,
        isCurrentMonth: mIdx === 0,
        isNextMonth: mIdx === 1,
        total: 0,
        totalLabel: '',
        contributions: [],
      };

      for (const meta of metas) {
        const activeDays = activeDaysMatrix.get(meta.goal.id)![mIdx];
        const evenAmt = evenAllocMatrix.get(meta.goal.id)![mIdx];
        const dynAmt = dynamicAllocMatrix.get(meta.goal.id)![mIdx];
        const chosenAmt = pacingMode === 'dynamic' ? dynAmt : evenAmt;

        if (activeDays > 0 && chosenAmt > 0.01) {
          const roundedAmt = Math.round(chosenAmt * 100) / 100;
          const roundedEven = Math.round(evenAmt * 100) / 100;
          const prevFunded = cumulativeByGoal.get(meta.goal.id) || 0;
          const projectedAfter = Math.min(meta.targetBase, prevFunded + roundedAmt);
          cumulativeByGoal.set(meta.goal.id, projectedAfter);

          const startsThisMonth = Boolean(meta.rawStart && isSameMonth(meta.rawStart, mDate));
          const endsThisMonth = Boolean(meta.rawDeadline && isSameMonth(meta.rawDeadline, mDate));
          const isBoosted = pacingMode === 'dynamic' && roundedAmt > roundedEven * 1.12;

          point[meta.goal.id] = roundedAmt;
          point.total += roundedAmt;
          point.contributions.push({
            goal: meta.goal,
            color: meta.color,
            amount: roundedAmt,
            evenAmount: roundedEven,
            isBoosted,
            activeDays,
            weeklyPaceInMonth: roundedAmt / Math.max(1, activeDays / 7),
            projectedFundedAfterMonth: projectedAfter,
            targetBase: meta.targetBase,
            startsThisMonth,
            endsThisMonth,
          });
        } else {
          point[meta.goal.id] = 0;
        }
      }

      point.total = Math.round(point.total * 100) / 100;
      point.totalLabel = point.total > 0 ? fmtCompact(point.total) : '';
      return point;
    });

    // Trim trailing empty months (keep at least 4 months)
    while (series.length > 4 && series[series.length - 1].total <= 0.01) {
      series.pop();
    }

    return { activeGoalMetas: metas, chartData: series };
  }, [goals, convertToBase, spentByGoalTotal, pacingMode]);

  // Default selected month to Next Month (e.g. Dec) if available, otherwise Current Month
  const activeSelectedMonth = useMemo(() => {
    if (selectedMonthKey) {
      const found = chartData.find(m => m.monthKey === selectedMonthKey);
      if (found) return found;
    }
    return chartData.find(m => m.isNextMonth && m.total > 0) || chartData[0] || null;
  }, [chartData, selectedMonthKey]);

  const displayedGoalMetas = useMemo(() => {
    if (!focusedGoalId) return activeGoalMetas;
    return activeGoalMetas.filter(m => m.goal.id === focusedGoalId);
  }, [activeGoalMetas, focusedGoalId]);

  // Custom Tooltip for the Stacked Bar Chart
  const renderCustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const monthPoint: MonthSeriesPoint = payload[0]?.payload;
    if (!monthPoint) return null;

    const items = monthPoint.contributions.filter(
      c => !focusedGoalId || c.goal.id === focusedGoalId
    );
    const monthTotal = items.reduce((s, c) => s + c.amount, 0);

    return (
      <div className="bg-white/95 backdrop-blur-md border-2 border-slate-200 rounded-2xl p-3.5 shadow-xl min-w-[260px] max-w-[340px] font-body">
        <div className="flex items-center justify-between gap-3 pb-2 mb-2 border-b border-slate-100">
          <div>
            <p className="text-xs font-display font-black text-slate-900">
              {monthPoint.monthLabel}
            </p>
            <p className="text-[10px] text-slate-500 font-medium">
              ≈ {fmt(monthTotal / 4.33)}/wk across {items.length} {items.length === 1 ? 'pot' : 'pots'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF2EB8] block">
              Total to Pots
            </span>
            <span className="text-sm font-display font-black text-slate-900 tabular-nums">
              {fmt(monthTotal)}
            </span>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No pot contributions scheduled</p>
        ) : (
          <div className="space-y-1.5">
            {items.map(item => (
              <div key={item.goal.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-semibold text-slate-800 truncate">
                    {item.goal.name}
                  </span>
                  {item.isBoosted && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0 rounded bg-amber-50 text-amber-800 border border-amber-200 shrink-0"
                      title="Ramped up this month because earlier pots finished"
                    >
                      ⚡ Ramped up
                    </span>
                  )}
                  {item.startsThisMonth && (
                    <span className="text-[9px] font-bold px-1.5 py-0 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                      Starts
                    </span>
                  )}
                  {item.endsThisMonth && (
                    <span className="text-[9px] font-bold px-1.5 py-0 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      Due
                    </span>
                  )}
                </div>
                <span className="font-bold text-slate-900 tabular-nums shrink-0">
                  {fmt(item.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[6px_6px_0px_0px_rgba(255,46,184,0.1)] overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0F9FF] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#FF2EB8] text-white p-1.5 rounded-xl">
                <BarChart3 className="w-4 h-4" />
              </span>
              <span className="text-[#FF2EB8] font-display font-bold uppercase tracking-wider text-xs">
                Monthly Pot Roadmap • Stacked Forecast
              </span>
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900">
              Monthly Pot Contributions Breakdown
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              {pacingMode === 'dynamic'
                ? 'Dynamic Smart Pace: prioritizes soonest due dates first, then automatically puts more towards later goals (like Italy or Ski trip) once earlier pots finish.'
                : 'Even Linear Pace: spreads each pot evenly by day count between its start date and due date.'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap self-start lg:self-center">
            {focusedGoalId && (
              <button
                type="button"
                onClick={() => setFocusedGoalId(null)}
                className="text-xs font-display font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
              >
                Show All Pots ✕
              </button>
            )}

            {/* Pacing Mode Switcher */}
            <div className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80">
              <button
                type="button"
                onClick={() => setPacingMode('dynamic')}
                className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  pacingMode === 'dynamic'
                    ? 'bg-[#FF2EB8] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Automatically shifts more contribution into months where fewer competing pots are active"
              >
                <Sparkles className="w-3.5 h-3.5" /> Dynamic Smart Pace
              </button>
              <button
                type="button"
                onClick={() => setPacingMode('even')}
                className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  pacingMode === 'even'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Flat daily rate per pot from start date to due date"
              >
                <Scale className="w-3.5 h-3.5" /> Even Linear Pace
              </button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Stacked Bar Chart */}
        {activeGoalMetas.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            All your active goal pots are currently 100% funded! 🎉
          </div>
        ) : (
          <div className="h-[340px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 28, right: 16, left: 4, bottom: 8 }}
                onClick={(state: any) => {
                  if (state?.activePayload?.[0]?.payload?.monthKey) {
                    setSelectedMonthKey(state.activePayload[0].payload.monthKey);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="shortLabel"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#334155', fontSize: 12, fontWeight: 700 }}
                  dy={6}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  tickFormatter={(val: number) => fmtCompact(val) || '£0'}
                  width={56}
                />
                <Tooltip
                  content={renderCustomTooltip}
                  cursor={{ fill: 'rgba(255, 46, 184, 0.05)', radius: 12 }}
                />

                {monthlyPotCapacity > 0 && (
                  <ReferenceLine
                    y={monthlyPotCapacity}
                    stroke="#10b981"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    label={{
                      value: `Monthly Pot Capacity (${fmtCompact(monthlyPotCapacity)})`,
                      position: 'insideTopRight',
                      fill: '#059669',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  />
                )}

                {displayedGoalMetas.map((meta, idx) => {
                  const isTopBar = idx === displayedGoalMetas.length - 1;
                  return (
                    <Bar
                      key={meta.goal.id}
                      dataKey={meta.goal.id}
                      name={meta.goal.name}
                      stackId="pots"
                      fill={meta.color}
                      maxBarSize={64}
                      radius={isTopBar ? [8, 8, 0, 0] : [0, 0, 0, 0]}
                      className="cursor-pointer transition-opacity"
                    >
                      {isTopBar && !focusedGoalId && (
                        <LabelList
                          dataKey="totalLabel"
                          position="top"
                          style={{
                            fill: '#0f172a',
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        />
                      )}
                    </Bar>
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Interactive Legend: Active Pots & Their Start -> End Windows */}
        {activeGoalMetas.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-display font-bold uppercase tracking-wider text-slate-500">
                Active Pots in Chart (Click to Isolate)
              </span>
              <span className="text-[11px] text-slate-400">
                Click any bar above to view that month’s breakdown
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeGoalMetas.map(meta => {
                const isFocused = focusedGoalId === meta.goal.id;
                const isDimmed = focusedGoalId !== null && !isFocused;
                const startText =
                  meta.rawStart && meta.rawStart > new Date()
                    ? `Starts ${format(meta.rawStart, 'MMM d')}`
                    : 'Active now';
                const endText = meta.rawDeadline
                  ? `Due ${format(meta.rawDeadline, 'MMM d')}`
                  : 'Ongoing';

                return (
                  <button
                    key={meta.goal.id}
                    type="button"
                    onClick={() =>
                      setFocusedGoalId(prev => (prev === meta.goal.id ? null : meta.goal.id))
                    }
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                      isFocused
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm scale-[1.02]'
                        : isDimmed
                        ? 'bg-slate-50 text-slate-400 border-slate-200 opacity-50 hover:opacity-80'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-md shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="font-bold">{meta.goal.name}</span>
                    <span
                      className={`text-[10px] font-medium ${
                        isFocused ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      ({startText} → {endText} • {fmt(meta.remainingToSaveBase)} left)
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected Month Detailed Breakdown Box */}
        {activeSelectedMonth && (
          <div className="rounded-2xl bg-gradient-to-r from-[#FFF9FC] via-white to-indigo-50/40 border-2 border-[#FF7AD1]/35 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-[#FF2EB8] text-white font-display font-bold text-xs px-2.5 py-0.5">
                  {activeSelectedMonth.monthLabel}
                </Badge>
                <span className="text-xs text-slate-600 font-semibold">
                  You will be putting{' '}
                  <strong className="text-slate-900 font-black">
                    {fmt(activeSelectedMonth.total)}
                  </strong>{' '}
                  towards your pots ({fmt(activeSelectedMonth.total / 4.33)}/wk)
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                {activeSelectedMonth.contributions.length} active{' '}
                {activeSelectedMonth.contributions.length === 1 ? 'pot' : 'pots'} in{' '}
                {format(activeSelectedMonth.monthDate, 'MMMM')}
              </span>
            </div>

            {activeSelectedMonth.contributions.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2">
                No pot contributions needed in {activeSelectedMonth.monthLabel}.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {activeSelectedMonth.contributions.map(c => {
                  const pctOfMonth =
                    activeSelectedMonth.total > 0
                      ? Math.round((c.amount / activeSelectedMonth.total) * 100)
                      : 0;
                  const afterPct =
                    c.targetBase > 0
                      ? Math.min(100, Math.round((c.projectedFundedAfterMonth / c.targetBase) * 100))
                      : 0;

                  return (
                    <div
                      key={c.goal.id}
                      className="rounded-xl bg-white border border-slate-200/80 p-3 flex flex-col justify-between gap-2 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-md shrink-0"
                            style={{ backgroundColor: c.color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {c.goal.name}
                              </span>
                              {c.isBoosted && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-amber-200 text-amber-800 bg-amber-50 font-bold"
                                  title="Ramped up this month because earlier pots finished"
                                >
                                  ⚡ Ramped up
                                </Badge>
                              )}
                              {c.startsThisMonth && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-indigo-200 text-indigo-700 bg-indigo-50 font-bold"
                                >
                                  Starts {format(new Date(String(c.goal.start_date).split('T')[0] + 'T00:00:00'), 'MMM d')}
                                </Badge>
                              )}
                              {c.endsThisMonth && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-emerald-200 text-emerald-700 bg-emerald-50 font-bold"
                                >
                                  Finishes {format(new Date(String(c.goal.deadline).split('T')[0] + 'T00:00:00'), 'MMM d')}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-display font-black text-slate-900 tabular-nums">
                            +{fmt(c.amount)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-semibold block">
                            {pctOfMonth}% of month
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                        <span>{fmt(c.weeklyPaceInMonth)}/wk pace</span>
                        <span className="font-semibold text-slate-700">
                          Reaches {fmt(c.projectedFundedAfterMonth)} ({afterPct}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
