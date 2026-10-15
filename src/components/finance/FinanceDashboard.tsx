import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import { MultiSegmentDonut } from '@/components/finance/MultiSegmentDonut';
import { MondayWeeklyReviewCard } from '@/components/finance/MondayWeeklyReviewCard';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  getDaysInMonth,
  getDate,
  differenceInDays,
  addWeeks,
  format,
} from 'date-fns';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function FinanceDashboard() {
  const navigate = useNavigate();
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
  const {
    monthlyTotal: fixedExpensesMonthlyAll,
    monthlyTotalInternal: fixedExpensesMonthly,
  } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap: wtMap } = useWeekTypes();
  const { trips } = useFinanceTrips();

  const [upStatus, setUpStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [wiseStatus, setWiseStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [monzoStatus, setMonzoStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [showMondayPreview, setShowMondayPreview] = useState(false);

  useEffect(() => {
    async function checkStatuses() {
      try {
        const [up, wise, monzo] = await Promise.all([
          finance.checkUpStatus ? finance.checkUpStatus() : Promise.resolve({ connected: false }),
          finance.checkWiseStatus ? finance.checkWiseStatus() : Promise.resolve({ connected: false }),
          finance.checkMonzoStatus ? finance.checkMonzoStatus() : Promise.resolve({ connected: false }),
        ]);
        setUpStatus(up || null);
        setWiseStatus(wise || null);
        setMonzoStatus(monzo || null);
      } catch (err) {
        console.error('Error checking bank statuses:', err);
      } finally {
        setLoadingStatus(false);
      }
    }
    checkStatuses();
  }, []);

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions,
      finance.accounts,
      finance.transactions,
      finance.categories,
      finance.goals,
      finance.convertToBase,
      fixedExpensesMonthly,
      totalBoostThisWeek,
      wtMap(),
      trips,
      fixedExpensesMonthlyAll
    );
  }, [
    assumptions,
    finance.accounts,
    finance.transactions,
    finance.categories,
    finance.goals,
    finance.convertToBase,
    fixedExpensesMonthly,
    fixedExpensesMonthlyAll,
    totalBoostThisWeek,
    wtMap,
    trips,
  ]);

  const baseCurrency = finance.settings?.base_currency || 'GBP';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const catMap = useMemo(
    () => new Map(finance.categories.map(c => [c.id, c])),
    [finance.categories]
  );
  const essentialCatIds = useMemo(
    () => new Set(finance.categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)),
    [finance.categories]
  );

  const isFixedTx = useCallback(
    (tx: typeof finance.transactions[0]): boolean => {
      if (tx.is_fixed || tx.fixed_expense_id) return true;
      const cat = catMap.get(tx.category_id || '');
      return cat?.type === 'fixed';
    },
    [catMap]
  );

  // Current week & month windows
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const dayOfWeek = Math.min(7, Math.max(1, differenceInDays(now, weekStart) + 1)); // 1=Mon..7=Sun
  const daysLeftInWeek = Math.max(1, 8 - dayOfWeek); // Inclusive of today

  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const daysInMonth = getDaysInMonth(monthStart);
  const daysElapsed = getDate(now);

  // Weekly spend + Mon-Sun daily bar chart data
  const { essentialSpentThisWeek, funSpentThisWeek, weekDailyBars } = useMemo(() => {
    let essential = 0;
    let fun = 0;
    const bars = DAY_LABELS.map(label => ({ label, essential: 0, fun: 0 }));

    for (const tx of finance.transactions) {
      if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) continue;
      if ((tx as any).goal_id || (tx as any).is_travel_spend) continue;
      const d = parseUkDate(tx.posted_at);
      if (d < weekStart || d > weekEnd) continue;

      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports || cat?.type === 'income' || cat?.type === 'transfer') continue;
      if (isFixedTx(tx)) continue;

      const amt = Math.abs(baseAmt(tx));
      const dayIdx = Math.min(6, Math.max(0, differenceInDays(d, weekStart)));

      if (essentialCatIds.has(tx.category_id || '')) {
        essential += amt;
        bars[dayIdx].essential += amt;
      } else {
        fun += amt;
        bars[dayIdx].fun += amt;
      }
    }

    return {
      essentialSpentThisWeek: essential,
      funSpentThisWeek: fun,
      weekDailyBars: bars,
    };
  }, [finance.transactions, weekStart, weekEnd, catMap, essentialCatIds, isFixedTx]);

  // Monthly spend
  const { essentialSpentMonth, funSpentMonth, fixedSpentMonth } = useMemo(() => {
    let essential = 0;
    let fun = 0;
    let fixed = 0;

    for (const tx of finance.transactions) {
      if (tx.is_reimbursable || tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id) continue;
      const d = parseUkDate(tx.posted_at);
      if (d < monthStart || d > monthEnd) continue;

      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports || cat?.type === 'income' || cat?.type === 'transfer') continue;

      const amt = Math.abs(baseAmt(tx));
      if (isFixedTx(tx)) {
        fixed += amt;
      } else if (essentialCatIds.has(tx.category_id || '')) {
        essential += amt;
      } else {
        fun += amt;
      }
    }

    return {
      essentialSpentMonth: essential,
      funSpentMonth: fun,
      fixedSpentMonth: fixed,
    };
  }, [finance.transactions, monthStart, monthEnd, catMap, essentialCatIds, isFixedTx]);

  if (assumptionsLoading || !snapshot) {
    return (
      <div className="space-y-6 animate-pulse max-w-5xl mx-auto">
        <div className="h-12 rounded-2xl bg-slate-100" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-100" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-64 rounded-2xl bg-slate-100" />
          <div className="h-64 rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  // 1. Weekly Safe-to-Spend
  const weeklyFunBudget = snapshot.weeklyFunBudget;
  const weeklyEssentialBudget = snapshot.weeklyEssentialBudget;
  const totalWeeklyBudget = weeklyFunBudget + weeklyEssentialBudget;
  const totalSpentThisWeek = essentialSpentThisWeek + funSpentThisWeek;
  const combinedSafeToSpend = totalWeeklyBudget - totalSpentThisWeek;
  const combinedDailyPace = daysLeftInWeek > 0 ? combinedSafeToSpend / daysLeftInWeek : combinedSafeToSpend;

  // 2. Monthly Spend & Projected Under/Over
  const fixedMonthly = fixedExpensesMonthlyAll;
  const monthlyVariableBudget = (snapshot.weeklyEssentialBudget + snapshot.baseWeeklyFun) * 4.33;
  const autoTotalBudget = monthlyVariableBudget + fixedMonthly;
  const budgetOverride = (assumptions as any)?.monthly_budget_override;
  const monthlyTotalBudget =
    budgetOverride != null && budgetOverride !== '' ? Number(budgetOverride) : autoTotalBudget;

  const variableSpentMonth = essentialSpentMonth + funSpentMonth;
  const totalSpentMonth = variableSpentMonth + fixedSpentMonth;
  const dailyVariablePace = daysElapsed > 0 ? variableSpentMonth / daysElapsed : 0;
  const projectedSpend = dailyVariablePace * daysInMonth + fixedMonthly;
  const projectedDiff = projectedSpend - monthlyTotalBudget; // <= 0 means under budget

  // 3. Runway
  const runwayMonths = Math.floor(snapshot.runwayWeeks / 4.33);
  const runwayRemainderWeeks = Math.round(snapshot.runwayWeeks % 4.33);
  const runwayEndDate = format(addWeeks(now, Math.floor(snapshot.runwayWeeks)), 'MMM d, yyyy');

  // 4. Liquid Cash & Pools
  const isEmergencyGoal = (g: any) => g.is_emergency === true || g.name.toLowerCase().includes('emergency');
  const isStashGoal = (g: any) => g.is_stash === true || g.name.toLowerCase().includes('stash');
  const totalCash = snapshot.totalLiquidCash;
  const emergencyFloor = snapshot.emergencyFloor;
  const nonEmergencyGoalsTotal = finance.goals
    .filter(g => !isEmergencyGoal(g) && !isStashGoal(g))
    .reduce((s, g) => s + finance.convertToBase(g.assigned_amount || 0, g.currency), 0);
  const emergencyGoal = finance.goals.find(isEmergencyGoal);
  const emergencyGoalAssigned = emergencyGoal
    ? finance.convertToBase(emergencyGoal.assigned_amount || 0, emergencyGoal.currency)
    : 0;
  const unassignedCash = Math.max(0, totalCash - nonEmergencyGoalsTotal);
  const currentEmergencyFunded = Math.min(emergencyFloor, Math.max(emergencyGoalAssigned, unassignedCash));
  const emergencyPct = emergencyFloor > 0 ? Math.min(100, (currentEmergencyFunded / emergencyFloor) * 100) : 100;

  // Bar chart scaling
  const dailyTargetLine = totalWeeklyBudget / 7;
  const maxBarVal = Math.max(
    dailyTargetLine * 1.3,
    ...weekDailyBars.map(b => b.essential + b.fun),
    30
  );

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-10">
      {/* ═══ MINIMAL HEADER ═══ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-black tracking-tight text-slate-900">
            {greeting}, Gabriella
          </h1>
          <span className="rounded-full bg-[#FF2EB8]/10 px-2.5 py-0.5 text-[11px] font-bold text-[#FF2EB8]">
            {format(now, 'EEE d MMM')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200/80 rounded-xl px-2.5 py-1">
            {[
              { label: 'Monzo', status: monzoStatus },
              { label: 'Wise', status: wiseStatus },
              { label: 'Up', status: upStatus },
            ].map(b => (
              <div key={b.label} className="flex items-center gap-1 px-1 text-[10px] font-semibold text-slate-500">
                {loadingStatus ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-slate-400" />
                ) : (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      b.status?.connected ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                )}
                <span>{b.label}</span>
              </div>
            ))}
          </div>

          {now.getDay() !== 1 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs rounded-xl border-slate-200 text-slate-600"
              onClick={() => setShowMondayPreview(v => !v)}
            >
              {showMondayPreview ? 'Hide Review' : 'Weekly Review'}
            </Button>
          )}
        </div>
      </div>

      {/* ═══ MONDAY WEEKLY REVIEW CARD ═══ */}
      <MondayWeeklyReviewCard
        finance={finance}
        assumptions={assumptions}
        trips={trips}
        snapshot={snapshot}
        forceShow={showMondayPreview}
      />

      {/* ═══ ROW 1: 4 COMPACT SINGLE-NUMBER WIDGETS ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Safe to Spend This Week */}
        <div
          onClick={() => navigate('/finance/budget')}
          className="rounded-2xl border-2 border-[#FF7AD1]/45 bg-white p-5 cursor-pointer transition-all hover:border-[#FF2EB8]"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Safe to Spend
          </span>
          <p
            className={`text-3xl font-black tabular-nums tracking-tight mt-1 ${
              combinedSafeToSpend >= 0 ? 'text-slate-900' : 'text-rose-600'
            }`}
          >
            {fmt(combinedSafeToSpend)}
          </p>
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full bg-[#FF2EB8]/10 px-2 py-0.5 text-[11px] font-bold text-[#FF2EB8]">
              {fmt(combinedDailyPace)}/day · {daysLeftInWeek}d left
            </span>
          </div>
        </div>

        {/* 2. Month Spend & Expected Under/Over */}
        <div
          onClick={() => navigate('/finance/monthly')}
          className="rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {format(now, 'MMMM')} Spend
          </span>
          <p className="text-3xl font-black tabular-nums tracking-tight text-slate-900 mt-1">
            {fmt(totalSpentMonth)}
          </p>
          <div className="mt-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                projectedDiff <= 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              {projectedDiff <= 0 ? (
                <>
                  <TrendingDown className="w-3 h-3" /> Under by {fmt(Math.abs(projectedDiff))}
                </>
              ) : (
                <>
                  <TrendingUp className="w-3 h-3" /> Over by {fmt(projectedDiff)}
                </>
              )}
            </span>
          </div>
        </div>

        {/* 3. Financial Runway */}
        <div
          onClick={() => navigate('/finance/budget')}
          className="rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Runway
          </span>
          <p className="text-3xl font-black tabular-nums tracking-tight text-slate-900 mt-1">
            {runwayMonths}mo {runwayRemainderWeeks}w
          </p>
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">
              Until {runwayEndDate}
            </span>
          </div>
        </div>

        {/* 4. Total Liquid Cash */}
        <div
          onClick={() => navigate('/finance/pools')}
          className="rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Liquid Cash
          </span>
          <p className="text-3xl font-black tabular-nums tracking-tight text-slate-900 mt-1">
            {fmt(totalCash)}
          </p>
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
              {fmt(nonEmergencyGoalsTotal)} in pots
            </span>
          </div>
        </div>
      </div>

      {/* ═══ ROW 2: 2 CLEAN VISUAL CHART WIDGETS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CHART WIDGET 1: THIS WEEK'S DAILY SPEND (MON-SUN BAR CHART) */}
        <div
          onClick={() => navigate('/finance/budget')}
          className="rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                This Week's Spend
              </h2>
              <p className="text-[11px] text-slate-400">
                {fmt(totalSpentThisWeek)} spent of {fmt(totalWeeklyBudget)} budget
              </p>
            </div>
            <span className="text-xs font-bold text-[#FF2EB8] inline-flex items-center gap-0.5">
              Budget <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>

          {/* 7-Day Stacked Bar Chart */}
          <div className="grid grid-cols-7 gap-2 items-end h-36 pt-4 px-1">
            {weekDailyBars.map((bar, idx) => {
              const totalDay = bar.essential + bar.fun;
              const essHeight = maxBarVal > 0 ? (bar.essential / maxBarVal) * 100 : 0;
              const funHeight = maxBarVal > 0 ? (bar.fun / maxBarVal) * 100 : 0;
              const isToday = idx === dayOfWeek - 1;

              return (
                <div key={bar.label} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[10px] font-bold tabular-nums text-slate-500">
                    {totalDay > 0 ? `£${Math.round(totalDay)}` : ''}
                  </span>
                  <div className="w-full max-w-[28px] h-24 rounded-lg bg-slate-100/90 flex flex-col justify-end overflow-hidden p-0.5">
                    {bar.fun > 0 && (
                      <div
                        className="w-full bg-[#FF2EB8] rounded-t-sm transition-all"
                        style={{ height: `${Math.max(6, funHeight)}%` }}
                      />
                    )}
                    {bar.essential > 0 && (
                      <div
                        className="w-full bg-sky-500 rounded-b-sm transition-all"
                        style={{ height: `${Math.max(6, essHeight)}%` }}
                      />
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-bold ${
                      isToday ? 'text-[#FF2EB8]' : 'text-slate-400'
                    }`}
                  >
                    {bar.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Compact Legend Footer */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              <span className="text-slate-500 font-medium">Essentials left:</span>
              <span className="font-black text-slate-900 tabular-nums">
                {fmt(Math.max(0, weeklyEssentialBudget - essentialSpentThisWeek))}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF2EB8]" />
              <span className="text-slate-500 font-medium">Fun left:</span>
              <span className="font-black text-slate-900 tabular-nums">
                {fmt(Math.max(0, weeklyFunBudget - funSpentThisWeek))}
              </span>
            </div>
          </div>
        </div>

        {/* CHART WIDGET 2: MONTHLY SPEND DONUT & EMERGENCY PROGRESS */}
        <div
          onClick={() => navigate('/finance/monthly')}
          className="rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                {format(now, 'MMMM')} Breakdown
              </h2>
              <p className="text-[11px] text-slate-400">
                Projected finish {fmt(projectedSpend)} vs {fmt(monthlyTotalBudget)} budget
              </p>
            </div>
            <span className="text-xs font-bold text-[#FF2EB8] inline-flex items-center gap-0.5">
              Monthly <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>

          <div className="flex items-center justify-around gap-6 my-auto py-2">
            <MultiSegmentDonut
              size={132}
              total={Math.max(monthlyTotalBudget, totalSpentMonth)}
              centerTop={fmt(totalSpentMonth)}
              centerBottom={`of ${fmt(monthlyTotalBudget)}`}
              segments={[
                { label: 'Fixed Bills', value: fixedSpentMonth, color: '#7c3aed' },
                { label: 'Essentials', value: essentialSpentMonth, color: '#0ea5e9' },
                { label: 'Fun Money', value: funSpentMonth, color: '#FF2EB8' },
              ]}
            />

            <div className="space-y-3 flex-1 max-w-[210px]">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-semibold text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-600" />
                  Fixed Bills
                </span>
                <span className="font-black tabular-nums text-slate-900">{fmt(fixedSpentMonth)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-semibold text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                  Essentials
                </span>
                <span className="font-black tabular-nums text-slate-900">{fmt(essentialSpentMonth)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-semibold text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF2EB8]" />
                  Fun Money
                </span>
                <span className="font-black tabular-nums text-slate-900">{fmt(funSpentMonth)}</span>
              </div>
            </div>
          </div>

          {/* Compact Emergency Buffer Bar at Bottom */}
          <div
            onClick={e => {
              e.stopPropagation();
              navigate('/finance/pools');
            }}
            className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-4 text-xs"
          >
            <span className="font-semibold text-slate-500 shrink-0">Emergency Floor</span>
            <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${emergencyPct}%` }}
              />
            </div>
            <span className="font-black tabular-nums text-slate-900 shrink-0">
              {fmt(currentEmergencyFunded)} / {fmt(emergencyFloor)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
