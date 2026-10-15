import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Wallet,
  Shield,
  Lock,
  PartyPopper,
  TrendingUp,
  TrendingDown,
  Activity,
  Calendar,
  ChevronRight,
  PiggyBank,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Receipt,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import {
  computePolicySnapshot,
  computeRequiredGoalSavingsMonthly,
  computeTripSpent,
} from '@/lib/policyEngine';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import { MondayWeeklyReviewCard } from '@/components/finance/MondayWeeklyReviewCard';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  getDaysInMonth,
  getDate,
  differenceInDays,
  differenceInWeeks,
  addWeeks,
  format,
} from 'date-fns';

export function FinanceDashboard() {
  const navigate = useNavigate();
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
  const {
    expenses: fixedExpenses,
    monthlyTotal: fixedExpensesMonthlyAll,
    monthlyTotalInternal: fixedExpensesMonthly,
    activeExpenses,
    reimbursementsOn,
  } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap: wtMap } = useWeekTypes();
  const { trips } = useFinanceTrips();

  // Bank status states
  const [upStatus, setUpStatus] = useState<{ connected: boolean; error?: string; accountsCount?: number } | null>(null);
  const [wiseStatus, setWiseStatus] = useState<{ connected: boolean; error?: string; accountsCount?: number } | null>(null);
  const [monzoStatus, setMonzoStatus] = useState<{ connected: boolean; error?: string; accountsCount?: number } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [showMondayPreview, setShowMondayPreview] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  // Category lookup
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

  // ── Time Windows (Current Week & Current Month) ──
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const dayOfWeek = Math.min(7, Math.max(1, differenceInDays(now, weekStart) + 1)); // 1=Mon..7=Sun
  const daysLeftInWeek = Math.max(1, 8 - dayOfWeek); // Inclusive of today

  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const daysInMonth = getDaysInMonth(monthStart);
  const daysElapsed = getDate(now);
  const daysRemainingInMonth = Math.max(0, daysInMonth - daysElapsed);

  // ── Weekly Spend (matching FinanceBudget.tsx) ──
  const { essentialSpentThisWeek, funSpentThisWeek, recentWeekTxns, uncategorisedCountThisWeek } = useMemo(() => {
    let essential = 0;
    let fun = 0;
    let uncatCount = 0;
    const recent: Array<{
      id: string;
      merchant: string;
      amount: number;
      postedAt: string;
      categoryName: string;
      categoryColor: string;
      isEssential: boolean;
      isFixed: boolean;
      isUncategorised: boolean;
    }> = [];

    const sorted = [...finance.transactions].sort(
      (a, b) => parseUkDate(b.posted_at).getTime() - parseUkDate(a.posted_at).getTime()
    );

    for (const tx of sorted) {
      if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) continue;
      if ((tx as any).goal_id || (tx as any).is_travel_spend) continue;
      const d = parseUkDate(tx.posted_at);
      if (d < weekStart || d > weekEnd) continue;

      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports || cat?.type === 'income' || cat?.type === 'transfer') continue;

      const amt = Math.abs(baseAmt(tx));
      const fixed = isFixedTx(tx);
      const isUncat = !tx.category_id && !fixed;
      if (isUncat) uncatCount++;

      if (!fixed) {
        if (essentialCatIds.has(tx.category_id || '')) {
          essential += amt;
        } else {
          fun += amt;
        }
      }

      if (recent.length < 6) {
        recent.push({
          id: tx.id,
          merchant: tx.merchant || tx.description || 'Transaction',
          amount: amt,
          postedAt: tx.posted_at,
          categoryName: fixed ? 'Fixed Bill' : cat?.name || 'Uncategorised',
          categoryColor: fixed ? '#64748b' : cat?.color || '#94a3b8',
          isEssential: essentialCatIds.has(tx.category_id || ''),
          isFixed: fixed,
          isUncategorised: isUncat,
        });
      }
    }

    return {
      essentialSpentThisWeek: essential,
      funSpentThisWeek: fun,
      recentWeekTxns: recent,
      uncategorisedCountThisWeek: uncatCount,
    };
  }, [finance.transactions, weekStart, weekEnd, catMap, essentialCatIds, isFixedTx]);

  // ── Monthly Spend & Projections (matching FinanceMonthly.tsx) ──
  const monthTxns = useMemo(() => {
    return finance.transactions.filter(tx => {
      if (tx.is_reimbursable) return false;
      const d = parseUkDate(tx.posted_at);
      return d >= monthStart && d <= monthEnd;
    });
  }, [finance.transactions, monthStart, monthEnd]);

  const { essentialSpentMonth, funSpentMonth, fixedSpentMonth, incomeMonth, paidFixedIds } = useMemo(() => {
    let essential = 0;
    let fun = 0;
    let fixed = 0;
    let income = 0;
    const paidIds = new Set<string>();
    const paidNames: string[] = [];

    for (const tx of monthTxns) {
      const cat = catMap.get(tx.category_id || '');
      const rawText = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
      const isIncomeCategory = cat?.type === 'income';
      const isGabriellaIncome = rawText.includes('gabriella') && tx.amount > 0 && !tx.transfer_group_id && !tx.is_transfer;
      const isIncomeKeyword =
        rawText.includes('batchbase') ||
        rawText.includes('batch base') ||
        rawText.includes('payroll') ||
        rawText.includes('salary') ||
        rawText.includes('venture') ||
        rawText.includes('etsy') ||
        isGabriellaIncome;

      if (tx.amount > 0 && (!tx.is_transfer || isIncomeCategory || isIncomeKeyword)) {
        if (!tx.is_reimbursable && (cat?.type !== 'transfer' || isIncomeKeyword)) {
          income += baseAmt(tx);
          continue;
        }
      }

      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id) continue;
      if (cat?.exclude_from_reports) continue;

      const amt = Math.abs(baseAmt(tx));
      if (isFixedTx(tx)) {
        fixed += amt;
        if ((tx as any).fixed_expense_id) paidIds.add((tx as any).fixed_expense_id);
        paidNames.push(rawText);
        continue;
      }
      if (cat?.type === 'income' || cat?.type === 'transfer') continue;

      if (essentialCatIds.has(tx.category_id || '')) {
        essential += amt;
      } else {
        fun += amt;
      }
    }

    const monthIso = format(monthStart, 'yyyy-MM-dd');
    for (const r of reimbursementsOn(monthIso)) income += r.amount;

    // Also match fixed expenses by name if not explicitly linked via fixed_expense_id
    for (const fe of activeExpenses) {
      const feKey = fe.name.toLowerCase().slice(0, 5);
      if (paidNames.some(n => n.includes(feKey))) {
        paidIds.add(fe.id);
      }
    }

    return {
      essentialSpentMonth: essential,
      funSpentMonth: fun,
      fixedSpentMonth: fixed,
      incomeMonth: income,
      paidFixedIds: paidIds,
    };
  }, [monthTxns, catMap, essentialCatIds, isFixedTx, monthStart, reimbursementsOn, activeExpenses]);

  // ── Emergency Fund & Money Pools (matching FinancePools.tsx) ──
  const isEmergencyGoal = (g: any) => g.is_emergency === true || g.name.toLowerCase().includes('emergency');
  const isStashGoal = (g: any) => g.is_stash === true || g.name.toLowerCase().includes('stash');

  const activeBanks = useMemo(
    () =>
      finance.accounts.filter(
        a =>
          a.is_active &&
          a.provider !== 'revolut' &&
          a.type !== 'credit' &&
          !a.name.toLowerCase().includes('revolut') &&
          !a.name.toLowerCase().includes('credit')
      ),
    [finance.accounts]
  );

  const totalCash = useMemo(
    () => activeBanks.reduce((s, a) => s + finance.convertToBase(a.balance, a.currency), 0),
    [activeBanks, finance.convertToBase]
  );

  // Loading state
  if (assumptionsLoading || !snapshot) {
    return (
      <div className="space-y-6 animate-pulse max-w-6xl mx-auto">
        <div className="h-14 rounded-2xl bg-slate-100" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-36 rounded-2xl bg-slate-100" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-80 rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  // ── Core Unified Metrics ──
  const weeklyFunBudget = snapshot.weeklyFunBudget;
  const weeklyEssentialBudget = snapshot.weeklyEssentialBudget;
  const totalWeeklyBudget = weeklyFunBudget + weeklyEssentialBudget;
  const totalSpentThisWeek = essentialSpentThisWeek + funSpentThisWeek;
  const combinedSafeToSpend = totalWeeklyBudget - totalSpentThisWeek;
  const combinedDailyPace = daysLeftInWeek > 0 ? combinedSafeToSpend / daysLeftInWeek : combinedSafeToSpend;
  const weeklyUsedPct = totalWeeklyBudget > 0 ? Math.min(100, (totalSpentThisWeek / totalWeeklyBudget) * 100) : 0;

  // Monthly budget & projection
  const fixedMonthly = fixedExpensesMonthlyAll;
  const monthlyEssentialBudget = snapshot.weeklyEssentialBudget * 4.33;
  const monthlyFunBudget = snapshot.baseWeeklyFun * 4.33;
  const monthlyVariableBudget = monthlyEssentialBudget + monthlyFunBudget;
  const autoTotalBudget = monthlyVariableBudget + fixedMonthly;
  const budgetOverride = (assumptions as any)?.monthly_budget_override;
  const monthlyTotalBudget =
    budgetOverride != null && budgetOverride !== '' ? Number(budgetOverride) : autoTotalBudget;

  const variableSpentMonth = essentialSpentMonth + funSpentMonth;
  const totalSpentMonth = variableSpentMonth + fixedSpentMonth;
  const dailyVariablePace = daysElapsed > 0 ? variableSpentMonth / daysElapsed : 0;
  const projectedVariableSpend = dailyVariablePace * daysInMonth;
  const projectedSpend = projectedVariableSpend + fixedMonthly;
  const projectedDiff = projectedSpend - monthlyTotalBudget; // < 0 means projected under budget
  const monthlyUsedPct = monthlyTotalBudget > 0 ? Math.min(100, (totalSpentMonth / monthlyTotalBudget) * 100) : 0;
  const timeElapsedPct = (daysElapsed / daysInMonth) * 100;

  // Runway & Emergency Floor
  const emergencyFloor = snapshot.emergencyFloor;
  const emergencyGoal = finance.goals.find(isEmergencyGoal);
  const emergencyGoalAssigned = emergencyGoal
    ? finance.convertToBase(emergencyGoal.assigned_amount || 0, emergencyGoal.currency)
    : 0;
  const nonEmergencyGoalsTotal = finance.goals
    .filter(g => !isEmergencyGoal(g))
    .reduce((s, g) => s + finance.convertToBase(g.assigned_amount || 0, g.currency), 0);
  const unassignedCash = Math.max(0, totalCash - nonEmergencyGoalsTotal);
  const currentEmergencyFunded = Math.min(emergencyFloor, Math.max(emergencyGoalAssigned, unassignedCash));
  const emergencyShortfallAmt = Math.max(0, emergencyFloor - currentEmergencyFunded);
  const emergencyProgressPct = emergencyFloor > 0 ? Math.min(100, (currentEmergencyFunded / emergencyFloor) * 100) : 100;

  const runwayMonths = Math.floor(snapshot.runwayWeeks / 4.33);
  const runwayRemainderWeeks = Math.round(snapshot.runwayWeeks % 4.33);
  const runwayEndDate = format(addWeeks(now, Math.floor(snapshot.runwayWeeks)), 'MMMM do, yyyy');

  // Active Money Pools (excluding Emergency Reserve and Savings Stash)
  const activeSavingGoals = finance.goals
    .filter(g => !isEmergencyGoal(g) && !isStashGoal(g))
    .map(g => {
      const targetBase = finance.convertToBase(g.target_amount, g.currency);
      const assignedBase = finance.convertToBase(g.assigned_amount || 0, g.currency);
      const linkedTrip = trips.find(t => t.goal_id === g.id);
      const tripSpent = linkedTrip
        ? computeTripSpent(linkedTrip.id, finance.transactions, finance.convertToBase)
        : 0;
      const effectiveSaved = assignedBase + tripSpent;
      const remaining = Math.max(0, targetBase - effectiveSaved);
      const pct = targetBase > 0 ? Math.min(100, (effectiveSaved / targetBase) * 100) : 0;
      const deadlineDate = g.deadline ? new Date(g.deadline) : null;
      const weeksLeft = deadlineDate ? Math.max(1, differenceInWeeks(deadlineDate, now)) : null;
      const reqWeekly = weeksLeft && remaining > 0 ? remaining / weeksLeft : 0;
      return {
        ...g,
        targetBase,
        assignedBase,
        tripSpent,
        effectiveSaved,
        remaining,
        pct,
        deadlineDate,
        weeksLeft,
        reqWeekly,
      };
    })
    .sort((a, b) => {
      const pA = a.priority ?? 999;
      const pB = b.priority ?? 999;
      if (pA !== pB) return pA - pB;
      if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

  const totalSavedInPots = activeSavingGoals.reduce((s, g) => s + g.assignedBase, 0);
  const totalTargetInPots = activeSavingGoals.reduce((s, g) => s + g.targetBase, 0);

  // Fixed Bills Checklist (this month)
  const billsList = activeExpenses
    .map(fe => {
      const monthlyAmt =
        fe.frequency === 'weekly'
          ? fe.amount * 4.33
          : fe.frequency === 'quarterly'
          ? fe.amount / 3
          : fe.frequency === 'yearly'
          ? fe.amount / 12
          : fe.amount;
      const isPaid = paidFixedIds.has(fe.id) || (fe.due_day ? fe.due_day <= daysElapsed && fixedSpentMonth >= monthlyAmt : false);
      return {
        id: fe.id,
        name: fe.name,
        monthlyAmt,
        dueDay: fe.due_day,
        isPaid: paidFixedIds.has(fe.id),
        paidExternally: Boolean(fe.paid_externally),
      };
    })
    .sort((a, b) => {
      if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1; // Show unpaid/upcoming first
      return (a.dueDay || 99) - (b.dueDay || 99);
    });

  const unpaidBillsTotal = Math.max(0, fixedMonthly - fixedSpentMonth);

  // Monthly Cash Flow Plan
  const actualMonthlyIncome = snapshot.split.monthlyIncome || incomeMonth || assumptions?.expected_monthly_income || 3350;
  const poolSavingsMonthly =
    snapshot.split.goalSavingsAmount > 0
      ? snapshot.split.goalSavingsAmount
      : computeRequiredGoalSavingsMonthly(finance.goals, finance.convertToBase, now, actualMonthlyIncome);
  const unallocatedMonthlySurplus = Math.max(
    0,
    actualMonthlyIncome - fixedMonthly - monthlyVariableBudget - poolSavingsMonthly
  );

  // Greeting
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* ═══ TOP HEADER BAR ═══ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              {greeting}, Gabriella
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FF2EB8]/10 border border-[#FF2EB8]/25 px-2.5 py-0.5 text-[11px] font-bold text-[#FF2EB8]">
              {format(now, 'EEE d MMM yyyy')} · Day {dayOfWeek}/7 of week
            </span>
            {uncategorisedCountThisWeek > 0 && (
              <button
                type="button"
                onClick={() => navigate('/finance/transactions')}
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-300/80 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-3 h-3 text-amber-600" />
                {uncategorisedCountThisWeek} uncategorised this week
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Live overview across your weekly safe-to-spend, monthly pace, money pools, and runway.
          </p>
        </div>

        {/* Right: Bank Status Pills + Weekly Review toggle + Summary Button */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200/90 rounded-xl px-2.5 py-1.5">
            {[
              { label: 'Monzo', status: monzoStatus },
              { label: 'Wise', status: wiseStatus },
              { label: 'Up', status: upStatus },
            ].map(b => (
              <div
                key={b.label}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-slate-600"
                title={b.status?.error || (b.status?.connected ? `${b.label} connected` : `${b.label} disconnected`)}
              >
                {loadingStatus ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-slate-400" />
                ) : b.status?.connected ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                )}
                <span>{b.label}</span>
              </div>
            ))}
          </div>

          {now.getDay() !== 1 && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50"
              onClick={() => setShowMondayPreview(v => !v)}
            >
              {showMondayPreview ? 'Hide Review' : 'Weekly Review'}
            </Button>
          )}
        </div>
      </div>

      {/* ═══ MONDAY WEEKLY REVIEW CARD (auto on Mondays or when toggled) ═══ */}
      <MondayWeeklyReviewCard forceShow={showMondayPreview} />

      {/* ═══ ROW 1: 4 HERO KPI CARDS ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Safe to Spend This Week */}
        <div
          onClick={() => navigate('/finance/budget')}
          className={`group rounded-2xl border-2 bg-white p-5 cursor-pointer transition-all hover:shadow-md ${
            combinedSafeToSpend >= 0
              ? 'border-[#FF7AD1]/45 hover:border-[#FF2EB8]'
              : 'border-rose-300 hover:border-rose-500'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Safe to Spend · Week
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                combinedSafeToSpend >= 0
                  ? 'bg-[#FF2EB8]/10 text-[#FF2EB8]'
                  : 'bg-rose-100 text-rose-700'
              }`}
            >
              {daysLeftInWeek} {daysLeftInWeek === 1 ? 'day' : 'days'} left
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl font-black tabular-nums tracking-tight ${
                combinedSafeToSpend >= 0 ? 'text-slate-900' : 'text-rose-600'
              }`}
            >
              {fmt(combinedSafeToSpend)}
            </span>
            <span className="text-xs font-semibold text-slate-400">
              / {fmt(totalWeeklyBudget)}
            </span>
          </div>

          <p className="text-xs font-semibold text-slate-700 mt-1">
            {combinedSafeToSpend >= 0
              ? `${fmt(combinedDailyPace)}/day pace incl. today`
              : `${fmt(Math.abs(combinedSafeToSpend))} over weekly cap`}
          </p>

          <div className="mt-3 space-y-1.5">
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
              <div
                className="h-full bg-sky-500 transition-all"
                style={{
                  width: `${totalWeeklyBudget > 0 ? Math.min(100, (essentialSpentThisWeek / totalWeeklyBudget) * 100) : 0}%`,
                }}
                title={`Essentials: ${fmt(essentialSpentThisWeek)}`}
              />
              <div
                className="h-full bg-[#FF2EB8] transition-all"
                style={{
                  width: `${totalWeeklyBudget > 0 ? Math.min(100, (funSpentThisWeek / totalWeeklyBudget) * 100) : 0}%`,
                }}
                title={`Fun: ${fmt(funSpentThisWeek)}`}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
              <span>Ess: {fmt(essentialSpentThisWeek)}/{fmt(weeklyEssentialBudget)}</span>
              <span>Fun: {fmt(funSpentThisWeek)}/{fmt(weeklyFunBudget)}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Monthly Pace & Projected Finish */}
        <div
          onClick={() => navigate('/finance/monthly')}
          className="group rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300 hover:shadow-md"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {format(now, 'MMMM')} Spend & Pace
            </span>
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                projectedDiff <= 0
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                  : 'bg-rose-50 text-rose-700 border border-rose-200/70'
              }`}
            >
              {projectedDiff <= 0 ? (
                <>
                  <TrendingDown className="w-2.5 h-2.5" /> Under by {fmt(Math.abs(projectedDiff))}
                </>
              ) : (
                <>
                  <TrendingUp className="w-2.5 h-2.5" /> Over by {fmt(projectedDiff)}
                </>
              )}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black tabular-nums tracking-tight text-slate-900">
              {fmt(totalSpentMonth)}
            </span>
            <span className="text-xs font-semibold text-slate-400">
              / {fmt(monthlyTotalBudget)}
            </span>
          </div>

          <p className="text-xs font-semibold text-slate-600 mt-1">
            Projected finish: <span className="text-slate-900 font-bold">{fmt(projectedSpend)}</span>
          </p>

          <div className="mt-3 space-y-1.5">
            <div className="relative h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  projectedDiff <= 0 ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                style={{ width: `${monthlyUsedPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
              <span>Day {daysElapsed} of {daysInMonth} ({timeElapsedPct.toFixed(0)}%)</span>
              <span>{daysRemainingInMonth}d left</span>
            </div>
          </div>
        </div>

        {/* Card 3: Financial Runway (Incl. Emergency, Ex. Savings Pots) */}
        <div
          onClick={() => navigate('/finance/budget')}
          className="group rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300 hover:shadow-md"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Financial Runway
            </span>
            <span className="inline-flex items-center rounded-full bg-violet-50 border border-violet-200/70 px-2 py-0.5 text-[10px] font-bold text-violet-700">
              {snapshot.runwayWeeks.toFixed(0)} weeks
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black tabular-nums tracking-tight text-slate-900">
              ~{runwayMonths}mo {runwayRemainderWeeks}w
            </span>
          </div>

          <p className="text-xs font-bold text-violet-700 mt-1">
            Until {runwayEndDate}
          </p>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-medium">
            <span>Incl. emergency · ex. saving pots</span>
            <span className="font-bold text-slate-700">{fmt(snapshot.runwayCashPool)} pool</span>
          </div>
        </div>

        {/* Card 4: Total Liquid Cash & Emergency Status */}
        <div
          onClick={() => navigate('/finance/pools')}
          className="group rounded-2xl border border-slate-200/90 bg-white p-5 cursor-pointer transition-all hover:border-slate-300 hover:shadow-md"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total Liquid Cash
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                emergencyShortfallAmt <= 0
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                  : 'bg-amber-50 text-amber-800 border border-amber-200/70'
              }`}
            >
              {emergencyShortfallAmt <= 0
                ? 'Emergency Full'
                : `Emergency -${fmt(emergencyShortfallAmt)}`}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black tabular-nums tracking-tight text-slate-900">
              {fmt(totalCash)}
            </span>
          </div>

          <p className="text-xs font-semibold text-slate-600 mt-1">
            {fmt(currentEmergencyFunded)} Emergency · {fmt(totalSavedInPots)} in {activeSavingGoals.length} pots
          </p>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[10px] text-slate-500 font-medium truncate">
            {activeBanks.slice(0, 3).map(acc => (
              <span key={acc.id} className="truncate">
                <strong className="text-slate-700">{acc.name.split(' ')[0]}:</strong>{' '}
                {fmt(finance.convertToBase(acc.balance, acc.currency))}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ ROW 2: 3 OPERATIONAL PANELS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* PANEL 1: THIS WEEK'S PULSE & RECENT TRANSACTIONS */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-[#FF2EB8]" />
                  This Week's Pulse
                </h2>
                <p className="text-[11px] text-slate-500">
                  {format(weekStart, 'd MMM')} – {format(weekEnd, 'd MMM')} · {daysLeftInWeek} days left
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/finance/budget')}
                className="text-xs font-bold text-[#FF2EB8] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
              >
                Weekly Budget <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Two compact budget bars: Essentials & Fun */}
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3 text-sky-600" /> Essentials
                  </span>
                  <span className="text-sky-700">
                    {fmt(Math.max(0, weeklyEssentialBudget - essentialSpentThisWeek))} left
                  </span>
                </div>
                <p className="text-base font-black tabular-nums text-slate-900 mt-1">
                  {fmt(essentialSpentThisWeek)}{' '}
                  <span className="text-xs font-semibold text-slate-400">/ {fmt(weeklyEssentialBudget)}</span>
                </p>
                <div className="h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden mt-2">
                  <div
                    className="h-full bg-sky-500 rounded-full"
                    style={{
                      width: `${weeklyEssentialBudget > 0 ? Math.min(100, (essentialSpentThisWeek / weeklyEssentialBudget) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1">
                    <PartyPopper className="w-3 h-3 text-[#FF2EB8]" /> Fun Money
                  </span>
                  <span className="text-[#FF2EB8]">
                    {fmt(Math.max(0, weeklyFunBudget - funSpentThisWeek))} left
                  </span>
                </div>
                <p className="text-base font-black tabular-nums text-slate-900 mt-1">
                  {fmt(funSpentThisWeek)}{' '}
                  <span className="text-xs font-semibold text-slate-400">/ {fmt(weeklyFunBudget)}</span>
                </p>
                <div className="h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden mt-2">
                  <div
                    className="h-full bg-[#FF2EB8] rounded-full"
                    style={{
                      width: `${weeklyFunBudget > 0 ? Math.min(100, (funSpentThisWeek / weeklyFunBudget) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Latest activity this week */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Recent Spend This Week
              </span>
              <button
                type="button"
                onClick={() => navigate('/finance/transactions')}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                All transactions →
              </button>
            </div>

            {recentWeekTxns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                No spending recorded yet this week.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentWeekTxns.map(tx => (
                  <div key={tx.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: tx.categoryColor }}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{tx.merchant}</p>
                        <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
                          <span>{format(parseUkDate(tx.postedAt), 'EEE d MMM')}</span>
                          <span>·</span>
                          <span className={tx.isUncategorised ? 'text-amber-600 font-semibold' : ''}>
                            {tx.categoryName}
                          </span>
                        </p>
                      </div>
                    </div>
                    <span className="font-bold tabular-nums text-slate-900 shrink-0">
                      -{fmt(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* PANEL 2: MONEY POOLS & EMERGENCY FUND */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <PiggyBank className="w-4 h-4 text-emerald-600" />
                  Money Pools & Buffer
                </h2>
                <p className="text-[11px] text-slate-500">
                  Emergency floor + {activeSavingGoals.length} active saving pots
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/finance/pools')}
                className="text-xs font-bold text-[#FF2EB8] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
              >
                Manage Pools <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Priority #0: Emergency Reserve Box */}
            <div
              className={`rounded-xl border p-3 mb-3.5 ${
                emergencyShortfallAmt > 0
                  ? 'border-amber-300/80 bg-amber-50/50'
                  : 'border-emerald-200/80 bg-emerald-50/40'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-amber-600" />
                  Emergency Reserve
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    emergencyShortfallAmt > 0
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {emergencyShortfallAmt > 0
                    ? `${fmt(emergencyShortfallAmt)} to full floor`
                    : '✓ Floor Protected'}
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-1.5">
                <span className="text-sm font-black tabular-nums text-slate-900">
                  {fmt(currentEmergencyFunded)}{' '}
                  <span className="text-xs font-semibold text-slate-500">/ {fmt(emergencyFloor)}</span>
                </span>
                <span className="text-[11px] font-bold tabular-nums text-slate-600">
                  {emergencyProgressPct.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/90 overflow-hidden mt-1.5 border border-slate-200/60">
                <div
                  className={`h-full rounded-full ${
                    emergencyShortfallAmt > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${emergencyProgressPct}%` }}
                />
              </div>
            </div>

            {/* Active Saving Pots List */}
            <div className="space-y-2.5">
              {activeSavingGoals.slice(0, 5).map(g => (
                <div
                  key={g.id}
                  onClick={() => navigate('/finance/pools')}
                  className="rounded-xl border border-slate-200/75 p-2.5 hover:border-slate-300 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold text-slate-800 truncate">{g.name}</span>
                      {g.deadlineDate && (
                        <span className="text-[10px] text-slate-400 shrink-0">
                          · {format(g.deadlineDate, 'MMM yy')}
                        </span>
                      )}
                    </div>
                    <span className="font-bold tabular-nums text-slate-900 shrink-0">
                      {fmt(g.effectiveSaved)}{' '}
                      <span className="text-slate-400 font-medium">/ {fmt(g.targetBase)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          g.pct >= 100 ? 'bg-emerald-500' : 'bg-[#FF2EB8]'
                        }`}
                        style={{ width: `${g.pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 tabular-nums w-16 text-right">
                      {g.remaining <= 0
                        ? '✓ Done'
                        : g.reqWeekly > 0
                        ? `${fmt(g.reqWeekly)}/wk`
                        : `${g.pct.toFixed(0)}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Total in saving pots</span>
            <span className="font-bold text-slate-800 tabular-nums">
              {fmt(totalSavedInPots)} / {fmt(totalTargetInPots)}
            </span>
          </div>
        </div>

        {/* PANEL 3: FIXED BILLS CHECKLIST (THIS MONTH) */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-violet-600" />
                  Fixed Bills · {format(now, 'MMM')}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {fmt(fixedSpentMonth)} cleared · {fmt(unpaidBillsTotal)} still to clear
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/finance/monthly')}
                className="text-xs font-bold text-[#FF2EB8] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
              >
                Monthly Report <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Progress bar of fixed bills cleared */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 mb-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-base font-black tabular-nums text-slate-900">
                  {fmt(fixedSpentMonth)}{' '}
                  <span className="text-xs font-semibold text-slate-400">
                    of {fmt(fixedMonthly)} committed
                  </span>
                </span>
                <span className="text-xs font-bold text-violet-700 tabular-nums">
                  {fixedMonthly > 0 ? Math.min(100, Math.round((fixedSpentMonth / fixedMonthly) * 100)) : 0}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden mt-2">
                <div
                  className="h-full bg-violet-600 rounded-full transition-all"
                  style={{
                    width: `${fixedMonthly > 0 ? Math.min(100, (fixedSpentMonth / fixedMonthly) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Upcoming & Paid bills list */}
            <div className="divide-y divide-slate-100 max-h-[270px] overflow-y-auto pr-1">
              {billsList.slice(0, 8).map(bill => (
                <div key={bill.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {bill.isPaid ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={`font-semibold truncate ${
                          bill.isPaid ? 'text-slate-500 line-through' : 'text-slate-800'
                        }`}
                      >
                        {bill.name}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {bill.isPaid
                          ? 'Paid this month'
                          : bill.dueDay
                          ? `Due day ${bill.dueDay}`
                          : 'Monthly commitment'}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`font-bold tabular-nums shrink-0 ${
                      bill.isPaid ? 'text-slate-400' : 'text-slate-900'
                    }`}
                  >
                    {fmt(bill.monthlyAmt)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>{billsList.filter(b => !b.isPaid).length} bills remaining this month</span>
            <span className="font-bold text-slate-800 tabular-nums">{fmt(unpaidBillsTotal)} left</span>
          </div>
        </div>
      </div>

      {/* ═══ ROW 3: MONTHLY CASH FLOW BLUEPRINT BAR ═══ */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">
              Monthly Cash Flow Allocation
            </h2>
            <p className="text-xs text-slate-500">
              How your {fmt(actualMonthlyIncome)} monthly income splits across Fixed Bills, Weekly Budgets, and Money Pools
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs rounded-xl border-slate-200"
            onClick={() => navigate('/finance/settings')}
          >
            Income & Assumptions <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        {/* Stacked proportional bar */}
        <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex mb-4">
          <div
            className="h-full bg-violet-600"
            style={{ width: `${Math.min(100, (fixedMonthly / actualMonthlyIncome) * 100)}%` }}
            title={`Fixed Bills: ${fmt(fixedMonthly)}`}
          />
          <div
            className="h-full bg-sky-500"
            style={{ width: `${Math.min(100, (monthlyEssentialBudget / actualMonthlyIncome) * 100)}%` }}
            title={`Essential Variable: ${fmt(monthlyEssentialBudget)}`}
          />
          <div
            className="h-full bg-[#FF2EB8]"
            style={{ width: `${Math.min(100, (monthlyFunBudget / actualMonthlyIncome) * 100)}%` }}
            title={`Fun Money: ${fmt(monthlyFunBudget)}`}
          />
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${Math.min(100, (poolSavingsMonthly / actualMonthlyIncome) * 100)}%` }}
            title={`Pool Savings: ${fmt(poolSavingsMonthly)}`}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Monthly Income
            </span>
            <p className="text-base font-black tabular-nums text-slate-900 mt-0.5">
              {fmt(actualMonthlyIncome)}
            </p>
            <span className="text-[10px] text-slate-500">100% baseline</span>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-violet-600" /> Fixed Bills
            </span>
            <p className="text-base font-black tabular-nums text-slate-900 mt-0.5">
              {fmt(fixedMonthly)}
            </p>
            <span className="text-[10px] text-slate-500">
              {((fixedMonthly / actualMonthlyIncome) * 100).toFixed(0)}% of income
            </span>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-500" /> Essentials (4.33w)
            </span>
            <p className="text-base font-black tabular-nums text-slate-900 mt-0.5">
              {fmt(monthlyEssentialBudget)}
            </p>
            <span className="text-[10px] text-slate-500">
              {fmt(weeklyEssentialBudget)}/wk cap
            </span>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF2EB8] flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#FF2EB8]" /> Fun Money (4.33w)
            </span>
            <p className="text-base font-black tabular-nums text-slate-900 mt-0.5">
              {fmt(monthlyFunBudget)}
            </p>
            <span className="text-[10px] text-slate-500">
              {fmt(weeklyFunBudget)}/wk cap
            </span>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Pool & Buffer Savings
            </span>
            <p className="text-base font-black tabular-nums text-slate-900 mt-0.5">
              {fmt(poolSavingsMonthly + unallocatedMonthlySurplus)}
            </p>
            <span className="text-[10px] text-slate-500">
              {fmt(poolSavingsMonthly)} goals + {fmt(unallocatedMonthlySurplus)} buffer
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
