import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  ShoppingBag,
  PiggyBank,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Clock,
  Receipt,
  TrendingUp,
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
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
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

interface MonthPotContribution {
  goal: FinanceGoal;
  amount: number;
  activeDays: number;
  totalActiveDays: number;
  weeklyPaceInMonth: number;
  projectedFundedAfterMonth: number;
  targetBase: number;
}

interface MonthPotSpending {
  goal: FinanceGoal;
  targetBase: number;
  currentInPotBase: number;
  spentTotalBase: number;
  spentInMonthBase: number;
  expectedRemainingSpendBase: number;
  stillToSaveBase: number;
  dueDateLabel: string;
  isDueThisMonth: boolean;
  isTripMonth: boolean;
}

interface MonthBreakdown {
  monthDate: Date;
  monthKey: string;
  monthLabel: string;
  shortMonthLabel: string;
  isCurrentMonth: boolean;
  isNextMonth: boolean;
  contributions: MonthPotContribution[];
  totalContribution: number;
  spendings: MonthPotSpending[];
  totalExpectedSpend: number;
  totalAlreadySpent: number;
  totalRemainingToSpend: number;
}

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
  trips = [],
  convertToBase,
  baseCurrency,
  monthlyPotCapacity = 0,
  onSelectGoalExpenses,
}: Props) {
  const [viewMode, setViewMode] = useState<'both' | 'spending' | 'saving'>('both');
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Compute total spent per goal and spent per goal per month (yyyy-MM)
  const { spentByGoalTotal, spentByGoalByMonth } = useMemo(() => {
    const totalMap = new Map<string, number>();
    const monthMap = new Map<string, Map<string, number>>();
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

      const d = parseUkDate(tx.posted_at);
      const mKey = format(d, 'yyyy-MM');
      if (!monthMap.has(matchedGoalId)) {
        monthMap.set(matchedGoalId, new Map());
      }
      const gMonth = monthMap.get(matchedGoalId)!;
      gMonth.set(mKey, (gMonth.get(mKey) || 0) + amt);
    }

    return { spentByGoalTotal: totalMap, spentByGoalByMonth: monthMap };
  }, [goals, transactions, categories]);

  // Build month-by-month breakdown from current month through latest deadline (up to 12 months)
  const monthlyBreakdowns = useMemo<MonthBreakdown[]>(() => {
    const today = startOfDay(new Date());
    const currentMonthStart = startOfMonth(today);
    const activeGoals = goals.filter(g => !isProtectedSystemPot(g));

    // Find farthest deadline month
    let maxMonthDate = addMonths(currentMonthStart, 4);
    for (const g of activeGoals) {
      if (g.deadline) {
        const dl = startOfMonth(new Date(String(g.deadline).split('T')[0] + 'T00:00:00'));
        if (dl > maxMonthDate) maxMonthDate = dl;
      }
    }
    // Cap horizon at 12 months forward so UI stays scannable
    const maxHorizon = addMonths(currentMonthStart, 11);
    if (maxMonthDate > maxHorizon) maxMonthDate = maxHorizon;

    const months: Date[] = [];
    let cursor = currentMonthStart;
    while (cursor <= maxMonthDate) {
      months.push(cursor);
      cursor = addMonths(cursor, 1);
    }

    // Pre-calculate per-goal saving window & remaining amount
    const goalMeta = activeGoals.map(g => {
      const targetBase = convertToBase(g.target_amount || 0, g.currency);
      const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
      const spentBase = spentByGoalTotal.get(g.id) || 0;
      const refillWhenSpent = Boolean(g.refill_when_spent);
      const effectiveFundedBase = refillWhenSpent ? assignedBase : assignedBase + spentBase;
      const remainingToSaveBase = Math.max(0, targetBase - effectiveFundedBase);

      const rawStart = g.start_date
        ? startOfDay(new Date(String(g.start_date).split('T')[0] + 'T00:00:00'))
        : today;
      const effectiveStart = rawStart > today ? rawStart : today;

      const rawDeadline = g.deadline
        ? startOfDay(new Date(String(g.deadline).split('T')[0] + 'T00:00:00'))
        : null;
      const effectiveDeadline = rawDeadline && rawDeadline < effectiveStart ? effectiveStart : rawDeadline;

      const totalActiveDays = effectiveDeadline
        ? Math.max(1, differenceInCalendarDays(effectiveDeadline, effectiveStart) + 1)
        : 0;

      const linkedTrip = trips.find(t => t.goal_id === g.id);

      return {
        goal: g,
        targetBase,
        assignedBase,
        spentBase,
        effectiveFundedBase,
        remainingToSaveBase,
        effectiveStart,
        effectiveDeadline,
        rawDeadline,
        totalActiveDays,
        linkedTrip,
      };
    });

    // Track cumulative projected savings across months per goal
    const cumulativeSavedByGoal = new Map<string, number>();
    goalMeta.forEach(m => cumulativeSavedByGoal.set(m.goal.id, m.effectiveFundedBase));

    return months.map((mDate, idx) => {
      const mStart = startOfMonth(mDate);
      const mEnd = endOfMonth(mDate);
      const mKey = format(mDate, 'yyyy-MM');

      const contributions: MonthPotContribution[] = [];
      const spendings: MonthPotSpending[] = [];

      for (const meta of goalMeta) {
        const {
          goal,
          targetBase,
          assignedBase,
          spentBase,
          remainingToSaveBase,
          effectiveStart,
          effectiveDeadline,
          rawDeadline,
          totalActiveDays,
          linkedTrip,
        } = meta;

        // 1. Expected Contributions in this month
        if (remainingToSaveBase > 0.01 && effectiveDeadline && totalActiveDays > 0) {
          const windowStart = idx === 0 ? (effectiveStart > mStart ? effectiveStart : mStart) : (effectiveStart > mStart ? effectiveStart : mStart);
          const windowEnd = effectiveDeadline < mEnd ? effectiveDeadline : mEnd;

          if (windowEnd >= windowStart) {
            const activeDays = differenceInCalendarDays(windowEnd, windowStart) + 1;
            const amount = (remainingToSaveBase * activeDays) / totalActiveDays;
            if (amount > 0.01) {
              const prevFunded = cumulativeSavedByGoal.get(goal.id) || 0;
              const projectedFundedAfterMonth = Math.min(targetBase, prevFunded + amount);
              cumulativeSavedByGoal.set(goal.id, projectedFundedAfterMonth);

              const weeksInActiveWindow = Math.max(1, activeDays / 7);
              contributions.push({
                goal,
                amount,
                activeDays,
                totalActiveDays,
                weeklyPaceInMonth: amount / weeksInActiveWindow,
                projectedFundedAfterMonth,
                targetBase,
              });
            }
          }
        }

        // 2. Expected Pot Spending in this month
        const isDueThisMonth = Boolean(rawDeadline && isSameMonth(rawDeadline, mDate));
        const isTripMonth = Boolean(
          linkedTrip &&
            linkedTrip.start_date &&
            linkedTrip.end_date &&
            startOfDay(new Date(linkedTrip.start_date)) <= mEnd &&
            startOfDay(new Date(linkedTrip.end_date)) >= mStart
        );
        const spentInMonthBase = spentByGoalByMonth.get(goal.id)?.get(mKey) || 0;

        if (isDueThisMonth || isTripMonth || spentInMonthBase > 0.01) {
          // Expected remaining spend = total target minus already spent (or current pot balance if refill_when_spent)
          const expectedRemainingSpendBase = goal.refill_when_spent
            ? Math.max(0, targetBase - spentInMonthBase)
            : Math.max(0, targetBase - spentBase);

          spendings.push({
            goal,
            targetBase,
            currentInPotBase: assignedBase,
            spentTotalBase: spentBase,
            spentInMonthBase,
            expectedRemainingSpendBase,
            stillToSaveBase: remainingToSaveBase,
            dueDateLabel: rawDeadline ? format(rawDeadline, 'MMM d') : isTripMonth ? 'Trip' : 'Active',
            isDueThisMonth,
            isTripMonth,
          });
        }
      }

      contributions.sort((a, b) => b.amount - a.amount);
      spendings.sort((a, b) => b.targetBase - a.targetBase);

      const totalContribution = contributions.reduce((s, c) => s + c.amount, 0);
      const totalExpectedSpend = spendings.reduce((s, sp) => s + sp.targetBase, 0);
      const totalAlreadySpent = spendings.reduce((s, sp) => s + sp.spentTotalBase, 0);
      const totalRemainingToSpend = spendings.reduce((s, sp) => s + sp.expectedRemainingSpendBase, 0);

      return {
        monthDate: mDate,
        monthKey: mKey,
        monthLabel: format(mDate, 'MMMM yyyy'),
        shortMonthLabel: format(mDate, 'MMM yyyy'),
        isCurrentMonth: idx === 0,
        isNextMonth: idx === 1,
        contributions,
        totalContribution,
        spendings,
        totalExpectedSpend,
        totalAlreadySpent,
        totalRemainingToSpend,
      };
    }).filter(m => m.contributions.length > 0 || m.spendings.length > 0 || m.isCurrentMonth || m.isNextMonth);
  }, [goals, trips, convertToBase, spentByGoalTotal, spentByGoalByMonth]);

  const currentMonthData = monthlyBreakdowns[0];
  const nextMonthData = monthlyBreakdowns[1];
  const totalUpcomingSpend = monthlyBreakdowns.reduce((s, m) => s + m.totalRemainingToSpend, 0);
  const totalUpcomingSave = monthlyBreakdowns.reduce((s, m) => s + m.totalContribution, 0);

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[6px_6px_0px_0px_rgba(255,46,184,0.1)] overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0F9FF] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#FF2EB8] text-white p-1.5 rounded-xl">
                <Calendar className="w-4 h-4" />
              </span>
              <span className="text-[#FF2EB8] font-display font-bold uppercase tracking-wider text-xs">
                Month-by-Month Pot Forecast
              </span>
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900">
              Monthly Expected Pot Spending & Saving Breakdown
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              See exactly which pots you are expected to spend from each month, how much has already been spent, and how much goes into each pot per month.
            </p>
          </div>

          {/* View Mode Filter Pills */}
          <div className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 self-start">
            <button
              type="button"
              onClick={() => setViewMode('both')}
              className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold transition-all cursor-pointer ${
                viewMode === 'both'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Combined
            </button>
            <button
              type="button"
              onClick={() => setViewMode('spending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === 'spending'
                  ? 'bg-[#FF2EB8] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShoppingBag className="w-3 h-3" /> Expected Pot Spending
            </button>
            <button
              type="button"
              onClick={() => setViewMode('saving')}
              className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === 'saving'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PiggyBank className="w-3 h-3" /> Monthly Saving Pace
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Top KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#FFF5FA] rounded-2xl p-4 border-2 border-[#FF7AD1]/30">
            <span className="text-xs font-display font-bold text-[#FF2EB8] uppercase tracking-wider block mb-1">
              {currentMonthData?.shortMonthLabel || 'This Month'} Expected Pot Spend
            </span>
            <div className="text-2xl sm:text-3xl font-display font-black text-slate-900 tabular-nums">
              {fmt(currentMonthData?.totalRemainingToSpend || 0)}
              <span className="text-xs font-semibold text-slate-500 ml-1">left to spend</span>
            </div>
            <span className="text-[11px] text-slate-600 font-medium block mt-1">
              {currentMonthData && currentMonthData.totalExpectedSpend > 0
                ? `${fmt(currentMonthData.totalExpectedSpend)} total pot budget (${fmt(currentMonthData.totalAlreadySpent)} spent)`
                : 'No pots due this month'}
            </span>
          </div>

          <div className="bg-sky-50/70 rounded-2xl p-4 border-2 border-sky-200/80">
            <span className="text-xs font-display font-bold text-sky-700 uppercase tracking-wider block mb-1">
              {nextMonthData?.shortMonthLabel || 'Next Month'} Expected Pot Spend
            </span>
            <div className="text-2xl sm:text-3xl font-display font-black text-slate-900 tabular-nums">
              {fmt(nextMonthData?.totalRemainingToSpend || 0)}
              <span className="text-xs font-semibold text-slate-500 ml-1">left to spend</span>
            </div>
            <span className="text-[11px] text-slate-600 font-medium block mt-1">
              {nextMonthData && nextMonthData.totalExpectedSpend > 0
                ? `${nextMonthData.spendings.map(s => s.goal.name).join(', ')} (${fmt(nextMonthData.totalExpectedSpend)} target)`
                : 'No pots due next month'}
            </span>
          </div>

          <div className="bg-indigo-50/70 rounded-2xl p-4 border-2 border-indigo-200/80">
            <span className="text-xs font-display font-bold text-indigo-700 uppercase tracking-wider block mb-1">
              Total Upcoming Pot Spending
            </span>
            <div className="text-2xl sm:text-3xl font-display font-black text-indigo-950 tabular-nums">
              {fmt(totalUpcomingSpend)}
            </div>
            <span className="text-[11px] text-indigo-800/80 font-medium block mt-1">
              {fmt(totalUpcomingSave)} left to save across {monthlyBreakdowns.length} months
            </span>
          </div>
        </div>

        {/* Month-by-Month Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {monthlyBreakdowns.map(month => {
            const isOverCapacity =
              monthlyPotCapacity > 0 && month.totalContribution > monthlyPotCapacity * 1.05;

            return (
              <div
                key={month.monthKey}
                className={`rounded-2xl border-2 p-4 flex flex-col justify-between transition-all ${
                  month.isCurrentMonth
                    ? 'bg-gradient-to-b from-[#FFF9FC] to-white border-[#FF2EB8]/45 shadow-sm'
                    : month.isNextMonth
                    ? 'bg-gradient-to-b from-sky-50/40 to-white border-sky-200/90'
                    : 'bg-white border-slate-200/80'
                }`}
              >
                <div className="space-y-4">
                  {/* Month Header */}
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-base font-display font-black text-slate-900">
                          {month.monthLabel}
                        </h3>
                        {month.isCurrentMonth && (
                          <Badge className="bg-[#FF2EB8] text-white text-[10px] px-2 py-0 font-bold">
                            This Month
                          </Badge>
                        )}
                        {month.isNextMonth && (
                          <Badge
                            variant="outline"
                            className="border-sky-300 text-sky-800 bg-sky-50 text-[10px] px-2 py-0 font-bold"
                          >
                            Next Month
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {month.spendings.length} {month.spendings.length === 1 ? 'pot' : 'pots'} to spend •{' '}
                        {month.contributions.length} {month.contributions.length === 1 ? 'pot' : 'pots'} saving
                      </p>
                    </div>

                    <div className="text-right">
                      {viewMode !== 'saving' && (
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 block">
                            Expected Spend
                          </span>
                          <span className="text-sm font-black text-slate-900 tabular-nums">
                            {fmt(month.totalRemainingToSpend)}
                          </span>
                        </div>
                      )}
                      {viewMode !== 'spending' && (
                        <div className={viewMode === 'both' ? 'mt-1' : ''}>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block">
                            To Save
                          </span>
                          <span className="text-xs font-extrabold text-indigo-700 tabular-nums">
                            +{fmt(month.totalContribution)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section 1: Expected Pot Spending in This Month */}
                  {viewMode !== 'saving' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-display font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1">
                          <ShoppingBag className="w-3 h-3" />
                          Expected Pot Spending
                        </span>
                        {month.totalExpectedSpend > 0 && (
                          <span className="text-[10px] font-semibold text-slate-500">
                            Budget: {fmt(month.totalExpectedSpend)}
                          </span>
                        )}
                      </div>

                      {month.spendings.length === 0 ? (
                        <div className="rounded-xl bg-slate-50/80 border border-dashed border-slate-200 px-3 py-2.5 text-[11px] text-slate-400">
                          No pots due for spending in {month.shortMonthLabel}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {month.spendings.map(sp => {
                            const dotColor = sp.goal.color || '#FF2EB8';
                            const spentPct =
                              sp.targetBase > 0
                                ? Math.min(100, (sp.spentTotalBase / sp.targetBase) * 100)
                                : 0;

                            return (
                              <div
                                key={sp.goal.id}
                                onClick={() => onSelectGoalExpenses?.(sp.goal)}
                                className={`rounded-xl border border-rose-100 bg-rose-50/35 p-2.5 space-y-1.5 transition-colors ${
                                  onSelectGoalExpenses ? 'cursor-pointer hover:bg-rose-50/70' : ''
                                }`}
                                title="Click to view or log expenses for this pot"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: dotColor }}
                                    />
                                    <span className="text-xs font-bold text-slate-900 truncate">
                                      {sp.goal.name}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] px-1.5 py-0 border-rose-200 text-rose-700 bg-white font-semibold shrink-0"
                                    >
                                      Due {sp.dueDateLabel}
                                    </Badge>
                                  </div>
                                  <span className="text-xs font-black text-slate-900 tabular-nums shrink-0">
                                    {fmt(sp.expectedRemainingSpendBase)}
                                    <span className="text-[10px] font-normal text-slate-500"> left</span>
                                  </span>
                                </div>

                                {/* Progress of actual spending vs pot budget */}
                                <div className="h-1.5 rounded-full bg-white overflow-hidden border border-rose-100">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                      width: `${Math.max(spentPct, sp.currentInPotBase > 0 ? 6 : 0)}%`,
                                      backgroundColor: dotColor,
                                    }}
                                  />
                                </div>

                                <div className="flex items-center justify-between text-[10px] text-slate-600">
                                  <span>
                                    Target: <strong className="text-slate-800">{fmt(sp.targetBase)}</strong>
                                    {sp.spentTotalBase > 0 && (
                                      <>
                                        {' '}•{' '}
                                        <span className="text-rose-600 font-semibold">
                                          {fmt(sp.spentTotalBase)} spent
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  <span>
                                    In pot: <strong className="text-emerald-700">{fmt(sp.currentInPotBase)}</strong>
                                    {sp.stillToSaveBase > 0.01 && (
                                      <span className="text-indigo-600 font-semibold">
                                        {' '}(+{fmt(sp.stillToSaveBase)} to save)
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Section 2: Expected Monthly Saving Contributions Into Pots */}
                  {viewMode !== 'spending' && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-display font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1">
                          <PiggyBank className="w-3 h-3" />
                          Expected Saving Into Pots
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500">
                          ≈ {fmt(month.totalContribution / 4.33)}/wk
                        </span>
                      </div>

                      {month.contributions.length === 0 ? (
                        <div className="rounded-xl bg-slate-50/80 border border-dashed border-slate-200 px-3 py-2.5 text-[11px] text-slate-400">
                          All active pots already funded for {month.shortMonthLabel}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {month.contributions.map(c => {
                            const dotColor = c.goal.color || '#4558ff';
                            const afterPct =
                              c.targetBase > 0
                                ? Math.min(100, (c.projectedFundedAfterMonth / c.targetBase) * 100)
                                : 0;

                            return (
                              <div
                                key={c.goal.id}
                                className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-2.5 py-2 space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: dotColor }}
                                    />
                                    <span className="text-xs font-semibold text-slate-800 truncate">
                                      {c.goal.name}
                                    </span>
                                  </div>
                                  <span className="text-xs font-extrabold text-indigo-700 tabular-nums shrink-0">
                                    +{fmt(c.amount)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                  <span>
                                    {fmt(c.weeklyPaceInMonth)}/wk • {c.activeDays}d active in {format(month.monthDate, 'MMM')}
                                  </span>
                                  <span className="font-semibold text-slate-700">
                                    Reaches {fmt(c.projectedFundedAfterMonth)} ({afterPct.toFixed(0)}%)
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Month Footer Capacity Check */}
                {monthlyPotCapacity > 0 && month.totalContribution > 0 && viewMode !== 'spending' && (
                  <div
                    className={`mt-4 pt-2.5 border-t text-[11px] flex items-center justify-between ${
                      isOverCapacity
                        ? 'border-amber-200 text-amber-800'
                        : 'border-slate-100 text-emerald-700'
                    }`}
                  >
                    <span className="font-medium flex items-center gap-1">
                      {isOverCapacity ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          Tight month (+{fmt(month.totalContribution - monthlyPotCapacity)} over avg pot budget)
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          Fits monthly pot capacity ({fmt(monthlyPotCapacity)}/mo)
                        </>
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
