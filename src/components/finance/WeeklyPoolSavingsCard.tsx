import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, CheckCircle2, Layers } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';
import type { useFinanceData } from '@/hooks/useFinanceData';
import { format, differenceInCalendarDays } from 'date-fns';
import { computeMonthlyPotSchedule } from '@/lib/potPacingEngine';

import type { PolicySnapshot } from '@/lib/policyEngine';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  spendablePool?: number;
  funMoney?: number;
  snapshot?: PolicySnapshot | null;
}

export default function WeeklyPoolSavingsCard({ finance, spendablePool = 0, funMoney = 0, snapshot }: Props) {
  const baseCurrency = finance.settings?.base_currency || 'GBP';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Calculate required weekly contribution for each active pool
  const poolBreakdown = useMemo(() => {
    const potSchedule = computeMonthlyPotSchedule({
      goals: finance.goals,
      transactions: finance.transactions,
      categories: finance.categories,
      convertToBase: finance.convertToBase,
      referenceDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    });

    const eligibleGoals = finance.goals.filter((g) => {
      const lower = (g.name || '').trim().toLowerCase();
      if ((g as any).is_emergency || (g as any).is_stash) return false;
      if (lower.includes('emergency') || lower.includes('stash') || lower === 'savings' || lower === 'core savings') return false;
      return true;
    });

    return eligibleGoals.map((goal) => {
      const targetNative = goal.target_amount || 0;
      const assignedNative = goal.assigned_amount || 0;
      const targetBase = finance.convertToBase(targetNative, goal.currency);
      const assignedBase = finance.convertToBase(assignedNative, goal.currency);
      const spentBase = potSchedule.spentByGoalTotal.get(goal.id) || 0;
      const effectiveFundedBase = goal.refill_when_spent ? assignedBase : (assignedBase + spentBase);
      const remainingBase = Math.max(0, targetBase - effectiveFundedBase);

      let weeklyRequiredBase = 0;
      let monthlyRequiredBase = 0;
      let futureWeeklyPace = 0;
      let daysRemaining: number | null = null;
      let weeksRemaining: number | null = null;
      let status: 'completed' | 'on_track' | 'urgent' | 'no_deadline' | 'upcoming' = 'no_deadline';

      const now = new Date();
      const isFutureStart = !!goal.start_date && new Date(goal.start_date) > now;
      const isStash = (goal as any).is_stash || goal.name.toLowerCase().includes('stash');
      const scheduledPlan = potSchedule.getGoalPlanForMonth(goal.id, now);

      if (remainingBase <= 0.01) {
        status = 'completed';
      } else if (isStash) {
        status = 'no_deadline';
        weeklyRequiredBase = 0;
      } else if (isFutureStart) {
        status = 'upcoming';
        weeklyRequiredBase = 0;
        if (scheduledPlan) {
          futureWeeklyPace = scheduledPlan.weeklyPace;
        } else if (goal.deadline) {
          const dl = new Date(goal.deadline);
          const st = new Date(goal.start_date!);
          const totalDays = Math.max(1, differenceInCalendarDays(dl, st));
          const totalWeeks = Math.max(1, totalDays / 7);
          futureWeeklyPace = remainingBase / totalWeeks;
        } else if (goal.percent_allocation && goal.percent_allocation > 0) {
          futureWeeklyPace = (goal.percent_allocation / 100) * 100;
        }
      } else if (goal.deadline) {
        const dl = new Date(goal.deadline);
        daysRemaining = differenceInCalendarDays(dl, now);

        if (daysRemaining <= 0) {
          weeklyRequiredBase = remainingBase;
          monthlyRequiredBase = remainingBase;
          status = 'urgent';
          weeksRemaining = 1;
        } else {
          weeksRemaining = Math.max(1, daysRemaining / 7);
          weeklyRequiredBase = scheduledPlan ? scheduledPlan.weeklyPace : (remainingBase / weeksRemaining);
          monthlyRequiredBase = scheduledPlan
            ? Math.min(remainingBase, scheduledPlan.monthlyAmount)
            : Math.min(remainingBase, weeklyRequiredBase * 4.33);
          // Only flag urgent if overdue or if required pace exceeds weekly cashflow capacity
          const weeklyCapacity = snapshot?.baseWeeklyFun ?? 150;
          status = (weeklyRequiredBase > weeklyCapacity * 1.5) ? 'urgent' : 'on_track';
        }
      } else if (goal.percent_allocation && goal.percent_allocation > 0) {
        // Fallback proportional target
        weeklyRequiredBase = (goal.percent_allocation / 100) * 100;
        monthlyRequiredBase = Math.min(remainingBase, weeklyRequiredBase * 4.33);
        status = 'on_track';
      }

      return {
        goal,
        targetBase,
        assignedBase,
        remainingBase,
        weeklyRequiredBase,
        monthlyRequiredBase,
        futureWeeklyPace,
        daysRemaining,
        weeksRemaining,
        status,
        isFutureStart,
        isStash,
      };
    });
  }, [finance.goals, finance.transactions, finance.categories, finance.convertToBase, snapshot]);

  const sortedPoolBreakdown = useMemo(() => {
    return [...poolBreakdown].sort((a, b) => {
      const aIsComplete = a.remainingBase <= 0.01;
      const bIsComplete = b.remainingBase <= 0.01;

      // 1. Completed goals go to bottom
      if (aIsComplete !== bIsComplete) {
        return aIsComplete ? 1 : -1;
      }

      // 2. Deadlines: soonest due date first
      const aHasDeadline = !!a.goal.deadline;
      const bHasDeadline = !!b.goal.deadline;

      if (aHasDeadline && bHasDeadline) {
        const aDate = new Date(a.goal.deadline!).getTime();
        const bDate = new Date(b.goal.deadline!).getTime();
        return aDate - bDate;
      }

      if (aHasDeadline !== bHasDeadline) {
        return aHasDeadline ? -1 : 1;
      }

      return (a.goal.priority || 99) - (b.goal.priority || 99);
    });
  }, [poolBreakdown]);

  // Aggregate weekly totals
  const totalWeeklyRequired = poolBreakdown.reduce((sum, item) => sum + item.weeklyRequiredBase, 0);
  const totalMonthlyRequired = poolBreakdown.reduce((sum, item) => sum + item.monthlyRequiredBase, 0);

  // True Safe-to-Spend (Unified safe-to-spend allowance from live cashflow model)
  const trueWeeklySafeToSpend = snapshot
    ? (snapshot.weeklyFunBudget + snapshot.weeklyEssentialBudget)
    : Math.max(0, (funMoney > 0 ? funMoney / 4.33 : (spendablePool > 0 ? spendablePool / 4.33 : 0)) - totalWeeklyRequired);
  const activePoolsCount = poolBreakdown.filter(p => p.remainingBase > 0.01).length;

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[6px_6px_0px_0px_rgba(255,46,184,0.12)] overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0FDF4] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#FF2EB8] text-white p-1.5 rounded-xl">
                <Sparkles className="w-4 h-4" />
              </span>
              <span className="text-[#FF2EB8] font-display font-bold uppercase tracking-wider text-xs">
                Mindset Guardrail • Pool Savings Engine
              </span>
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900">
              Weekly Pool Commitments
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Automatically calculates your required weekly pace for every goal so you never overspend.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Auto-Calculated in Budget
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* KPI Hero Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Required Weekly Target */}
          <div className="bg-[#FFF5FA] rounded-2xl p-4 border-2 border-[#FF7AD1]/30">
            <span className="text-xs font-display font-bold text-[#FF2EB8] uppercase tracking-wider block mb-1">
              Weekly Pool Target
            </span>
            <div className="text-3xl font-display font-black text-slate-900 tabular-nums">
              {fmt(totalWeeklyRequired)}
              <span className="text-xs font-bold text-slate-500 font-normal"> / week</span>
            </div>
            <span className="text-[11px] text-slate-500 font-medium block mt-1">
              ≈ {fmt(totalMonthlyRequired)} / month total
            </span>
          </div>

          {/* Adjusted True Safe-To-Spend */}
          <div className="bg-[#F0FDF4] rounded-2xl p-4 border-2 border-[#22C55E]/30">
            <span className="text-xs font-display font-bold text-[#166534] uppercase tracking-wider block mb-1">
              True Safe-to-Spend
            </span>
            <div className="text-3xl font-display font-black text-[#166534] tabular-nums">
              {fmt(trueWeeklySafeToSpend)}
              <span className="text-xs font-bold text-[#166534]/70 font-normal"> / week</span>
            </div>
            <span className="text-[11px] text-[#166534]/80 font-medium block mt-1">
              Discretionary income AFTER pool savings
            </span>
          </div>

          {/* Budget Integration Status */}
          <div className="bg-[#F0FDF4] rounded-2xl p-4 border-2 border-emerald-200/80 flex flex-col justify-between">
            <span className="text-xs font-display font-bold text-emerald-800 uppercase tracking-wider block mb-1">
              Budget Integration
            </span>
            <div>
              <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Auto-Paced from Income</span>
              </div>
            </div>
            <span className="text-[11px] text-emerald-700/80 font-medium block mt-1">
              Deducted automatically from monthly income before weekly fun money.
            </span>
          </div>
        </div>

        {/* Per-Pool Breakdown Table / List */}
        <div>
          <h4 className="text-sm font-display font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#FF2EB8]" />
            Active Pools & Required Weekly Contributions
          </h4>

          {sortedPoolBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4">No active pools created yet.</p>
          ) : (
            <div className="space-y-2">
              {sortedPoolBreakdown.map(({ goal, remainingBase, weeklyRequiredBase, futureWeeklyPace, daysRemaining, status, isFutureStart, isStash }) => {
                const goalColor = goal.color || '#4558ff';
                const isComplete = remainingBase <= 0.01;

                return (
                  <div
                    key={goal.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl border border-slate-100 hover:border-[#FF7AD1]/40 bg-white transition-all gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: goalColor }}
                      />
                      <div className="min-w-0">
                        <span className="font-display font-bold text-slate-900 text-sm block truncate">
                          {goal.name}
                        </span>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium flex-wrap">
                          <span>Left to save: <strong>{fmt(remainingBase)}</strong></span>
                          {goal.start_date && (
                            <span>• Starts {format(new Date(goal.start_date), 'MMM d, yyyy')}</span>
                          )}
                          {goal.deadline && (
                            <span>• Due {format(new Date(goal.deadline), 'MMM d')} ({daysRemaining && daysRemaining > 0 ? `${daysRemaining}d` : 'Due'})</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="text-right">
                        <span className="text-sm font-display font-black text-[#FF2EB8] tabular-nums block">
                          {isComplete ? 'Fully Funded' : isStash ? '£0.00/wk (Surplus sweep)' : isFutureStart ? `£0.00/wk now` : `${fmt(weeklyRequiredBase)}/wk`}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium block">
                          {isComplete ? 'Goal reached 🎉' : isStash ? 'Receives week-end surplus' : isFutureStart ? `≈ ${fmt(futureWeeklyPace)}/wk from ${format(new Date(goal.start_date!), 'MMM d')}` : `≈ ${fmt(weeklyRequiredBase * 4.33)}/mo`}
                        </span>
                      </div>

                      {isComplete ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">Done</Badge>
                      ) : isStash ? (
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">Surplus Sweeper</Badge>
                      ) : isFutureStart ? (
                        <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">Starts {format(new Date(goal.start_date!), 'MMM d')}</Badge>
                      ) : status === 'urgent' ? (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                          {daysRemaining != null && daysRemaining <= 0 ? 'Overdue' : 'Pace up'}
                        </Badge>
                      ) : daysRemaining != null && daysRemaining <= 14 ? (
                        <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700 bg-blue-50/50">Due Soon</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-slate-200">On Track</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
