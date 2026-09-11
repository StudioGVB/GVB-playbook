import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Wallet,
  Shield,
  Gauge,
  Lock,
  PartyPopper,
  DollarSign,
  TrendingUp,
  Activity,
  Calendar,
  ChevronRight,
  PiggyBank,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import { MultiSegmentDonut } from '@/components/finance/MultiSegmentDonut';
import { startOfMonth, endOfMonth, getDaysInMonth, getDate, format } from 'date-fns';

export function FinanceDashboard() {
  const navigate = useNavigate();
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
  const { expenses: fixedExpenses, monthlyTotal: fixedExpensesMonthlyAll, monthlyTotalInternal: fixedExpensesMonthly, activeExpenses } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap: wtMap } = useWeekTypes();

  // Status checks states
  const [upStatus, setUpStatus] = useState<{ connected: boolean; error?: string; accountsCount?: number } | null>(null);
  const [wiseStatus, setWiseStatus] = useState<{ connected: boolean; error?: string; accountsCount?: number } | null>(null);
  const [monzoStatus, setMonzoStatus] = useState<{ connected: boolean; error?: string; accountsCount?: number } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [daysRange, setDaysRange] = useState<number>(90);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Fetch status on mount
  useEffect(() => {
    async function checkStatuses() {
      try {
        const [up, wise, monzo] = await Promise.all([
          finance.checkUpStatus ? finance.checkUpStatus() : Promise.resolve({ connected: false }),
          finance.checkWiseStatus ? finance.checkWiseStatus() : Promise.resolve({ connected: false }),
          finance.checkMonzoStatus ? finance.checkMonzoStatus() : Promise.resolve({ connected: false })
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
      assumptions, finance.accounts, finance.transactions,
      finance.categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, totalBoostThisWeek, wtMap(), [], fixedExpensesMonthlyAll
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, totalBoostThisWeek, wtMap]);

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fxRates = (finance.settings?.fx_rates || {}) as Record<string, number>;
  const audToGbp = fxRates['AUD_GBP'] || 0.52;
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Time & Month calculations
  const selectedMonth = new Date();
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  const daysInMonth = getDaysInMonth(monthStart);
  const daysElapsed = getDate(selectedMonth);
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  // Filters for current month transactions
  const monthTxns = useMemo(() => {
    return finance.transactions.filter(tx => {
      const d = new Date(tx.posted_at);
      return d >= monthStart && d <= monthEnd;
    });
  }, [finance.transactions, monthStart, monthEnd]);

  // Essential variable categories ids
  const essentialCatIds = useMemo(() => new Set(
    finance.categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)
  ), [finance.categories]);

  // Is transaction fixed expense?
  const isFixedTx = (tx: typeof finance.transactions[0]) => {
    if (tx.is_fixed) return true;
    if (tx.fixed_expense_id) return true;
    const cat = finance.categories.find(c => c.id === tx.category_id);
    return cat?.type === 'fixed';
  };

  // Monthly sums
  const { essentialSpent, funSpent, fixedSpent } = useMemo(() => {
    let essential = 0, fun = 0, fixed = 0;
    for (const tx of monthTxns) {
      if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) continue;
      if (tx.goal_id) continue;
      const cat = finance.categories.find(c => c.id === tx.category_id);
      if (cat?.exclude_from_reports) continue;
      const amt = Math.abs(baseAmt(tx));
      if (isFixedTx(tx)) { fixed += amt; continue; }
      if (essentialCatIds.has(tx.category_id || '')) {
        essential += amt;
      } else {
        fun += amt;
      }
    }
    return { essentialSpent: essential, funSpent: fun, fixedSpent: fixed };
  }, [monthTxns, finance.categories, essentialCatIds]);

  const fixedMonthly = fixedExpensesMonthlyAll;
  const totalSpent = essentialSpent + funSpent + fixedMonthly;

  const monthlyEssentialBudget = snapshot ? snapshot.weeklyEssentialBudget * 4.33 : 0;
  const monthlyFunBudget = snapshot ? snapshot.baseWeeklyFun * 4.33 : 0;
  const autoTotalBudget = monthlyEssentialBudget + monthlyFunBudget + fixedMonthly;
  const budgetOverride = (assumptions as any)?.monthly_budget_override;
  const monthlyTotalBudget = (budgetOverride != null && budgetOverride !== '') ? Number(budgetOverride) : autoTotalBudget;

  // Timeframe-based actuals calculations
  const averages = useMemo(() => {
    const rangeAgo = new Date();
    rangeAgo.setDate(rangeAgo.getDate() - daysRange);
    const recentTxns = finance.transactions.filter(tx => {
      const d = new Date(tx.posted_at);
      return d >= rangeAgo && d <= new Date();
    });

    let totalIncome = 0;
    let totalEssentials = 0;
    let totalFun = 0;
    let totalFixed = 0;

    for (const tx of recentTxns) {
      const amt = Math.abs(baseAmt(tx));
      const cat = finance.categories.find(c => c.id === tx.category_id);
      
      if (tx.amount > 0 && !tx.is_transfer) {
        totalIncome += tx.amount;
        continue;
      }
      
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if (tx.goal_id) continue;
      if (cat?.exclude_from_reports) continue;

      if (isFixedTx(tx)) {
        totalFixed += amt;
      } else if (essentialCatIds.has(tx.category_id || '')) {
        totalEssentials += amt;
      } else {
        totalFun += amt;
      }
    }

    const months = daysRange / 30;
    const weeks = daysRange / 7;

    return {
      avgMonthlyIncome: totalIncome / months,
      avgMonthlyEssentials: totalEssentials / months,
      avgMonthlyFun: totalFun / months,
      avgMonthlyFixed: totalFixed / months,
      avgWeeklyVariableBurn: (totalEssentials + totalFun) / weeks,
      actualSavingsRate: totalIncome > 0 ? ((totalIncome - (totalEssentials + totalFun + totalFixed)) / totalIncome) * 100 : 0,
    };
  }, [finance.transactions, finance.categories, essentialCatIds, daysRange]);

  const poolsSum = useMemo(() => {
    return finance.goals.reduce((sum, g) => sum + (g.assigned_amount || 0), 0);
  }, [finance.goals]);

  const unassignedCash = useMemo(() => {
    if (!snapshot) return 0;
    return Math.max(0, finance.totalCashBase() - snapshot.emergencyFloor - poolsSum);
  }, [finance.totalCashBase, snapshot, poolsSum]);

  const totalPoolsWeeklyPace = useMemo(() => {
    let sum = 0;
    const today = new Date();
    for (const goal of finance.goals) {
      if (goal.target_amount > 0 && goal.deadline && goal.assigned_amount < goal.target_amount) {
        const d = new Date(goal.deadline);
        const diffTime = d.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          const weeks = diffDays / 7;
          sum += (goal.target_amount - goal.assigned_amount) / weeks;
        }
      }
    }
    return sum;
  }, [finance.goals]);

  // Advanced dashboard calculations
  const advancedMetrics = useMemo(() => {
    const totalCash = finance.totalCashBase();
    
    // 1. Runways
    const emergencySurvivalMonthly = snapshot?.emergencySurvivalMonthly || (fixedMonthly + (assumptions?.estimated_essential_variable || 300) * 4.33);
    const survivalRunwayMonths = emergencySurvivalMonthly > 0 ? totalCash / emergencySurvivalMonthly : 0;
    
    const activeBurnMonthly = fixedMonthly + averages.avgMonthlyEssentials + averages.avgMonthlyFun;
    const activeBurnRunwayMonths = activeBurnMonthly > 0 ? totalCash / activeBurnMonthly : 0;

    // 2. Projections
    const today = new Date();
    const yearEnd = new Date(today.getFullYear(), 11, 31);
    const daysRemaining = (yearEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    const monthsRemaining = daysRemaining / 30.4;

    const monthlyNetSurplus = averages.avgMonthlyIncome - activeBurnMonthly;
    const configuredMonthlyIncome = snapshot?.weeklyGross ? snapshot.weeklyGross * 4.33 : 0;
    const configuredMonthlyExpenses = monthlyEssentialBudget + monthlyFunBudget + fixedMonthly;
    const configuredMonthlySurplus = configuredMonthlyIncome - configuredMonthlyExpenses;
    
    const surplusToUse = (averages.avgMonthlyIncome > 100) ? monthlyNetSurplus : configuredMonthlySurplus;
    const projectedYearEndCash = totalCash + (surplusToUse * monthsRemaining);

    const goalsTargetTotal = finance.goals.reduce((sum, g) => sum + g.target_amount, 0);
    const totalSurvivalTarget = emergencySurvivalMonthly * 6; // 6-month buffer
    const totalFreedomRequired = goalsTargetTotal + totalSurvivalTarget;
    const freedomProgress = totalFreedomRequired > 0 ? (totalCash / totalFreedomRequired) * 100 : 0;

    // 3. Efficiency
    const totalOutgoings = averages.avgMonthlyEssentials + averages.avgMonthlyFun + averages.avgMonthlyFixed;
    const survivalOutgoings = averages.avgMonthlyEssentials + averages.avgMonthlyFixed;
    const survivalRatio = totalOutgoings > 0 ? (survivalOutgoings / totalOutgoings) * 100 : 0;
    const discretionaryRatio = Math.max(0, 100 - survivalRatio);

    const emergencyFloorVal = snapshot?.emergencyFloor || 0;
    const savingsEfficiency = (totalCash - emergencyFloorVal) > 0 ? (poolsSum / (totalCash - emergencyFloorVal)) * 100 : 0;

    // 4. Spend Velocity & Category Drag
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const last7DaysSpent = finance.transactions
      .filter(tx => {
        const d = new Date(tx.posted_at);
        return d >= sevenDaysAgo && !tx.is_transfer && !tx.is_reimbursable && tx.amount < 0 && !isFixedTx(tx) && !tx.goal_id;
      })
      .reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);

    const prior7DaysSpent = finance.transactions
      .filter(tx => {
        const d = new Date(tx.posted_at);
        return d >= fourteenDaysAgo && d < sevenDaysAgo && !tx.is_transfer && !tx.is_reimbursable && tx.amount < 0 && !isFixedTx(tx) && !tx.goal_id;
      })
      .reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);

    const spendVelocityPct = prior7DaysSpent > 0 ? ((last7DaysSpent - prior7DaysSpent) / prior7DaysSpent) * 100 : 0;

    // Category drag
    const catSums = new Map<string, number>();
    for (const tx of monthTxns) {
      if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable || tx.goal_id) continue;
      const cat = finance.categories.find(c => c.id === tx.category_id);
      if (cat?.exclude_from_reports) continue;
      const amt = Math.abs(baseAmt(tx));
      if (isFixedTx(tx)) continue;
      const name = cat?.name || 'Uncategorised';
      catSums.set(name, (catSums.get(name) || 0) + amt);
    }
    let topCatName = 'None';
    let topCatAmt = 0;
    for (const [name, amt] of catSums.entries()) {
      if (amt > topCatAmt) {
        topCatAmt = amt;
        topCatName = name;
      }
    }

    return {
      survivalRunwayMonths,
      activeBurnRunwayMonths,
      projectedYearEndCash,
      freedomProgress,
      survivalRatio,
      discretionaryRatio,
      savingsEfficiency,
      spendVelocityPct,
      topCatName,
      topCatAmt,
    };
  }, [finance.transactions, finance.categories, finance.totalCashBase, finance.goals, snapshot, averages, fixedMonthly, assumptions, isFixedTx, baseAmt, monthTxns, monthlyEssentialBudget, monthlyFunBudget, poolsSum]);

  // Etsy & Back Pocket Games Income Calculations
  const etsyIncome = useMemo(() => {
    return finance.transactions
      .filter(tx => {
        if (tx.amount <= 0 || tx.is_transfer) return false;
        const desc = `${(tx.merchant || '').toLowerCase()} ${(tx.description || '').toLowerCase()}`;
        return desc.includes('etsy');
      })
      .reduce((sum, tx) => sum + baseAmt(tx), 0);
  }, [finance.transactions]);

  const backPocketIncome = useMemo(() => {
    return finance.transactions
      .filter(tx => {
        if (tx.amount <= 0 || tx.is_transfer) return false;
        const desc = `${(tx.merchant || '').toLowerCase()} ${(tx.description || '').toLowerCase()}`;
        return desc.includes('back pocket') || desc.includes('bpg') || desc.includes('games');
      })
      .reduce((sum, tx) => sum + baseAmt(tx), 0);
  }, [finance.transactions]);

  const baseContractWeekly = 37000 / 52;
  const baseContractMonthly = baseContractWeekly * 4.33; // standard monthly equivalent of weekly contract
  const secondaryJobAudMonthly = 35 * 4 * 4.25; // 35 AUD/h * 4 hours/wk * 4.25 wks/mo
  const secondaryJobMonthly = finance.convertToBase(secondaryJobAudMonthly, 'AUD');
  
  const realTimeTotalIncome = baseContractMonthly + secondaryJobMonthly + etsyIncome + backPocketIncome;
  const realTimeNetBalance = realTimeTotalIncome - (fixedMonthly + monthlyEssentialBudget + monthlyFunBudget);

  // Breakdown of where net balance goes (which pools)
  const poolAllocations = useMemo(() => {
    const allocations: Array<{ name: string; amount: number; type: string; color: string }> = [];
    let remaining = realTimeNetBalance;

    // First pass: percent allocations
    for (const goal of finance.goals) {
      if (goal.target_amount > 0 && (goal as any).percent_allocation > 0) {
        const amt = ((goal as any).percent_allocation / 100) * realTimeTotalIncome;
        allocations.push({
          name: goal.name,
          amount: amt,
          type: `${(goal as any).percent_allocation}% split`,
          color: goal.color || '#A855F7',
        });
        remaining -= amt;
      }
    }

    // Second pass: required paces (if deadline exists)
    for (const goal of finance.goals) {
      if (goal.target_amount > 0 && !(goal as any).percent_allocation && goal.deadline && goal.assigned_amount < goal.target_amount) {
        const today = new Date();
        const d = new Date(goal.deadline);
        const diffTime = d.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          const weeks = diffDays / 7;
          const weeklyNeeded = (goal.target_amount - goal.assigned_amount) / weeks;
          const monthlyNeeded = weeklyNeeded * 4.33;
          allocations.push({
            name: goal.name,
            amount: monthlyNeeded,
            type: 'required pace',
            color: goal.color || '#A855F7',
          });
          remaining -= monthlyNeeded;
        }
      }
    }

    return {
      allocations,
      unassignedBuffer: Math.max(0, remaining),
    };
  }, [finance.goals, realTimeTotalIncome, realTimeNetBalance]);

  // Pace math
  const variableSpent = essentialSpent + funSpent;
  const dailyVariablePace = daysElapsed > 0 ? variableSpent / daysElapsed : 0;
  const projectedVariableSpend = dailyVariablePace * daysInMonth;
  const projectedSpend = projectedVariableSpend + fixedMonthly;
  const projectedDiff = projectedSpend - monthlyTotalBudget;
  const spendPct = monthlyTotalBudget > 0 ? (totalSpent / monthlyTotalBudget) * 100 : 0;
  
  const expectedPct = monthlyTotalBudget > 0 
    ? ((fixedMonthly + (monthlyEssentialBudget + monthlyFunBudget) * (daysElapsed / daysInMonth)) / monthlyTotalBudget) * 100 
    : 0;

  // Greeting based on current hours
  const greeting = useMemo(() => {
    const hrs = new Date().getHours();
    if (hrs < 12) return 'Good morning';
    if (hrs < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Bank accounts checks
  const monzoAccount = finance.accounts.find(a => a.provider === 'monzo');
  const wiseAccount = finance.accounts.find(a => a.provider === 'wise');
  const upAccount = finance.accounts.find(a => a.provider === 'up');

  const isUpConnected = !!upAccount || upStatus?.connected === true;
  const isWiseConnected = !!wiseAccount || wiseStatus?.connected === true;
  const isMonzoConnected = !!monzoAccount || monzoStatus?.connected === true;

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto pb-12">
      {/* Header and status indicators */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">
            {greeting}, Gabriella
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Here is your financial control overview for {format(selectedMonth, 'MMMM yyyy')}.</p>
        </div>

        {/* Bank connections bar */}
        <div className="flex flex-wrap items-center gap-2 bg-white/70 backdrop-blur-md rounded-2xl p-1.5 shadow-sm border border-[#FF7AD1]/20">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2">Banks:</span>
          
          {/* Up Bank Indicator */}
          <button
            onClick={() => navigate('/finance/accounts')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all ${
              isUpConnected
                ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/15'
                : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isUpConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            Up Bank
          </button>

          {/* Wise Indicator */}
          <button
            onClick={() => navigate('/finance/accounts')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all ${
              isWiseConnected
                ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/15'
                : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isWiseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            Wise
          </button>

          {/* Monzo Indicator */}
          <button
            onClick={() => navigate('/finance/accounts')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all ${
              isMonzoConnected
                ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/15'
                : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isMonzoConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            Monzo
          </button>
        </div>
      </div>

      {/* Real-Time Cash Flow Blueprint Card */}
      <div className="bg-white border border-border/80 rounded-[2.2rem] p-6 shadow-sm mb-6 relative overflow-hidden text-slate-800">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full filter blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full filter blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-50 border border-blue-100">
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-sm tracking-wide text-slate-900">Real-Time Monthly Cash Flow</h3>
              <p className="text-[10px] text-slate-500">Direct breakdown of income formula, outgoings, and pool allocations</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Col 1: Total Monthly Income */}
            <div className="space-y-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Total Monthly Income</span>
                <span className="text-2xl font-display font-black text-blue-600 block tabular-nums leading-none">
                  {fmt(realTimeTotalIncome)}
                </span>
                <span className="text-[9px] text-slate-400 font-mono mt-1 block">
                  ((37000/52)*4.33) + Convert(35 AUD * 4 * 4.25) + Etsy + Back Pocket
                </span>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Base Contract (37k/52 * 4.33):</span>
                  <span className="font-bold tabular-nums text-slate-800">{fmt(baseContractMonthly)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Secondary Job (35 AUD/h * 4 * 4.25):</span>
                  <span className="font-bold tabular-nums text-slate-800">{fmt(secondaryJobMonthly)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Etsy Shop (Actual):</span>
                  <span className="font-bold tabular-nums text-blue-600">{fmt(etsyIncome)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Back Pocket Games (Actual):</span>
                  <span className="font-bold tabular-nums text-blue-600">{fmt(backPocketIncome)}</span>
                </div>
              </div>
            </div>

            {/* Col 2: Total Monthly Outgoings */}
            <div className="space-y-4 lg:border-l lg:border-slate-100 lg:pl-6">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Monthly Outgoings</span>
                <span className="text-2xl font-display font-black text-rose-600 block tabular-nums leading-none">
                  {fmt(totalSpent)}
                </span>
                <span className="text-[9px] text-slate-400 mt-1 block">
                  Actual spent so far vs. {fmt(fixedMonthly + monthlyEssentialBudget + monthlyFunBudget)} budgeted
                </span>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Total Monthly Fixed:</span>
                  <span className="font-bold tabular-nums text-rose-600">
                    {fmt(fixedSpent)} <span className="text-[10px] font-normal text-slate-400">/ {fmt(fixedMonthly)}</span>
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Total Monthly Variable:</span>
                  <span className="font-bold tabular-nums text-slate-700">
                    {fmt(essentialSpent)} <span className="text-[10px] font-normal text-slate-400">/ {fmt(monthlyEssentialBudget)}</span>
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-550">Total Monthly Fun:</span>
                  <span className="font-bold tabular-nums text-slate-700">
                    {fmt(funSpent)} <span className="text-[10px] font-normal text-slate-400">/ {fmt(monthlyFunBudget)}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Col 3: Net Balance & Pools */}
            <div className="space-y-4 lg:border-l lg:border-slate-100 lg:pl-6">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Total Net Balance</span>
                <span className="text-2xl font-display font-black text-emerald-600 block tabular-nums leading-none">
                  {fmt(realTimeTotalIncome - totalSpent)}
                </span>
                <span className="text-[9px] text-slate-400 mt-1 block">
                  Actual remaining surplus after spend
                </span>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3 max-h-[110px] overflow-y-auto pr-1">
                {poolAllocations.allocations.map((alloc, idx) => (
                  <div key={idx} className="flex justify-between text-xs items-center">
                    <span className="text-slate-500 truncate max-w-[150px] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: alloc.color }} />
                      {alloc.name}
                    </span>
                    <span className="font-bold tabular-nums text-emerald-600">{fmt(alloc.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs border-t border-slate-100 pt-1.5">
                  <span className="text-slate-500 font-semibold">Unassigned Everyday Buffer:</span>
                  <span className="font-bold tabular-nums text-emerald-600">{fmt(poolAllocations.unassignedBuffer)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Net Worth & Cash */}
        <div
          onClick={() => navigate('/finance/balance-sheet')}
          className="cursor-pointer rounded-[2rem] p-6 flex flex-col justify-between min-h-[200px] transition-all hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-br from-[#FF2EB8] to-[#E6008D] text-white border-0 shadow-lg shadow-[#FF2EB8]/20 relative overflow-hidden"
        >
          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-white/20">
                <Wallet className="w-4 h-4 text-white" />
              </div>
              <p className="text-[10px] font-display font-bold uppercase tracking-[0.16em] text-pink-100">
                Total Liquid Cash
              </p>
            </div>
            <div className="font-display font-black tabular-nums text-3xl sm:text-4xl leading-none tracking-tight">
              {fmt(finance.totalCashBase())}
            </div>
          </div>

          <div className="relative z-10 mt-6">
            <p className="text-[10px] font-semibold text-pink-200">
              Across {finance.accounts.filter(a => !a.exclude_from_totals).length} active wallets
            </p>
            <div className="text-[10px] text-pink-100/90 mt-2 border-t border-white/10 pt-2 flex flex-wrap gap-x-2 gap-y-0.5">
              {finance.accounts.filter(a => !a.exclude_from_totals).map(a => (
                <span key={a.id} className="tabular-nums font-semibold whitespace-nowrap">
                  {a.account_name.split(' ')[0]}: {formatCurrency(a.balance, a.currency)}
                </span>
              ))}
            </div>
          </div>
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/10 rounded-full" />
        </div>

        {/* Weekly Runway Burn */}
        <div
          onClick={() => navigate('/finance/budget')}
          className="cursor-pointer rounded-[2rem] p-6 flex flex-col justify-between min-h-[200px] transition-all hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-br from-[#10B981] to-[#047857] text-white border-0 shadow-lg shadow-emerald-500/20 relative overflow-hidden"
        >
          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-white/20">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <p className="text-[10px] font-display font-bold uppercase tracking-[0.16em] text-emerald-100">
                Weekly Runway Left
              </p>
            </div>

            {snapshot ? (
              <div className="space-y-3.5 mt-2">
                {/* Essentials progress */}
                <div>
                  <div className="flex justify-between items-baseline text-emerald-100">
                    <span className="text-xs font-semibold opacity-90">Essentials</span>
                    <span className="tabular-nums text-lg font-display font-black leading-none">
                      {fmt(snapshot.remainingEssentials)} <span className="text-[10px] font-bold opacity-75">left</span>
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-white/20 overflow-hidden mt-1.5">
                    <div
                      className="h-full rounded-full bg-white shadow-sm"
                      style={{ width: `${Math.max(0, Math.min(100, (snapshot.remainingEssentials / snapshot.weeklyEssentialBudget) * 100))}%` }}
                    />
                  </div>
                </div>

                {/* Fun Money progress */}
                <div>
                  <div className="flex justify-between items-baseline text-emerald-100">
                    <span className="text-xs font-semibold opacity-90">Fun Money</span>
                    <span className="tabular-nums text-lg font-display font-black leading-none">
                      {fmt(snapshot.remainingWeeklyFun)} <span className="text-[10px] font-bold opacity-75">left</span>
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-white/20 overflow-hidden mt-1.5">
                    <div
                      className="h-full rounded-full bg-white shadow-sm"
                      style={{ width: `${Math.max(0, Math.min(100, (snapshot.remainingWeeklyFun / (snapshot.baseWeeklyFun + snapshot.rollover)) * 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-emerald-100/70 animate-pulse">Loading runways...</div>
            )}
          </div>

          {snapshot && snapshot.rollover > 0 && (
            <p className="relative z-10 text-[9px] font-bold text-emerald-100/90 text-right mt-3">
              + {fmt(snapshot.rollover)} rollover added
            </p>
          )}
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/10 rounded-full" />
        </div>

        {/* Emergency buffer progress */}
        <div
          onClick={() => navigate('/finance/accounts')}
          className="cursor-pointer rounded-[2rem] p-6 flex flex-col justify-between min-h-[200px] transition-all hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-br from-[#8B5CF6] to-[#4F46E5] text-white border-0 shadow-lg shadow-purple-500/20 relative overflow-hidden"
        >
          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-white/20">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <p className="text-[10px] font-display font-bold uppercase tracking-[0.16em] text-purple-100">
                Emergency Buffer
              </p>
            </div>
            
            {snapshot ? (
              <div className="space-y-1">
                <div className="font-display font-black text-3xl tabular-nums leading-none">
                  {snapshot.currentBufferMonths.toFixed(1)} mos
                </div>
                <p className="text-[10px] font-semibold text-purple-100 mt-1">
                  Target: {snapshot.bufferMonths} months
                </p>
                <div className="h-2 rounded-full bg-white/20 overflow-hidden mt-3">
                  <div
                    className="h-full rounded-full bg-white shadow-sm"
                    style={{ width: `${Math.min(100, (snapshot.currentBufferMonths / snapshot.bufferMonths) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-sm text-purple-100/70 animate-pulse">Loading buffer...</div>
            )}
          </div>
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/10 rounded-full" />
        </div>

        {/* Fixed committed expenses radar */}
        <div
          onClick={() => navigate('/finance/budget')}
          className="cursor-pointer rounded-[2rem] p-6 flex flex-col justify-between min-h-[200px] transition-all hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-br from-[#FF7AD1] to-[#FF2EB8] text-white border-0 shadow-lg shadow-pink-500/20 relative overflow-hidden"
        >
          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-white/20">
                <Lock className="w-4 h-4 text-white" />
              </div>
              <p className="text-[10px] font-display font-bold uppercase tracking-[0.16em] text-pink-100">
                Fixed Bills
              </p>
            </div>
            <div>
              <div className="font-display font-black text-3xl tabular-nums leading-none">
                {fmt(fixedMonthly)}
              </div>
              <p className="text-[10px] font-semibold text-pink-100 mt-1">
                {fmt(fixedSpent)} paid · {fmt(Math.max(0, fixedMonthly - fixedSpent))} left
              </p>
            </div>
          </div>

          <div className="relative z-10 text-[9px] text-pink-100 mt-4 border-t border-white/10 pt-2.5 max-h-[45px] overflow-y-auto space-y-0.5">
            {activeExpenses.slice(0, 3).map((e) => (
              <div key={e.id} className="flex justify-between font-semibold">
                <span className="truncate pr-1">{e.name}</span>
                <span className="shrink-0">{formatCurrency(e.amount, e.currency)}</span>
              </div>
            ))}
            {activeExpenses.length > 3 && (
              <div className="text-right text-[8px] text-pink-200 font-bold">+ {activeExpenses.length - 3} more</div>
            )}
          </div>
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/10 rounded-full" />
        </div>
      </div>

      {/* Middle Row - Pace & Savings Goals Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Pace Bar Container */}
        <div
          onClick={() => navigate('/finance/monthly')}
          className="cursor-pointer lg:col-span-2 rounded-3xl border border-border bg-gradient-to-br from-white to-slate-50/50 p-5 shadow-sm transition-transform hover:-translate-y-0.5 flex flex-col justify-between min-h-[300px]"
        >
          {(() => {
            const overBudget = projectedDiff > 0;
            const paceBorder = overBudget ? '#DC2626' : '#22C55E';
            const paceTint = overBudget ? '#FEE2E2' : '#DCFCE7';
            const paceAccent = overBudget ? '#DC2626' : '#166534';
            return (
              <div className="h-full flex flex-col justify-between">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100">
                      <Gauge className="w-4 h-4 text-slate-700" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-sm text-slate-900">Current Month Pace</h3>
                      <p className="text-[10px] text-slate-500">Day {daysElapsed} of {daysInMonth} — {daysRemaining} left</p>
                    </div>
                  </div>
                  <Badge variant={overBudget ? 'destructive' : 'secondary'} className="text-[10px] py-0.5 px-2">
                    {overBudget ? 'Over Pace' : 'On Pace'}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
                  <div className="rounded-xl bg-slate-50 border p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Spent so far</p>
                    <p className="text-xl font-display font-black tabular-nums text-slate-900 mt-1">{fmt(totalSpent)}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{fmt(dailyVariablePace)}/day var pace</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 border p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Projected total</p>
                    <p className="text-xl font-display font-black tabular-nums text-slate-900 mt-1">{fmt(projectedSpend)}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Budget: {fmt(monthlyTotalBudget)}</p>
                  </div>
                  <div className="rounded-xl p-3 border" style={{ background: paceTint, borderColor: `${paceBorder}30` }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: paceAccent }}>
                      {overBudget ? 'Projected over by' : 'Projected under by'}
                    </p>
                    <p className="text-xl font-display font-black tabular-nums mt-1" style={{ color: paceAccent }}>
                      {fmt(Math.abs(projectedDiff))}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: paceAccent }}>
                      {overBudget
                        ? `Cut ${fmt(daysRemaining > 0 ? projectedDiff / daysRemaining : 0)}/day to save`
                        : `You've got ${fmt(daysRemaining > 0 ? Math.abs(projectedDiff) / daysRemaining : 0)}/day room`}
                    </p>
                  </div>
                </div>

                {/* Progress bars: expected pace vs actual spend */}
                <div className="space-y-3 pt-2">
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
                      <span>Pace target (incl. fixed bills)</span>
                      <span className="tabular-nums">{expectedPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-slate-400" style={{ width: `${Math.min(100, expectedPct)}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold mb-1" style={{ color: paceAccent }}>
                      <span>Budget used</span>
                      <span className="tabular-nums">{spendPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, spendPct)}%`, background: paceBorder }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Savings Goals / Money Pools card */}
        <div
          onClick={() => navigate('/finance/pools')}
          className="cursor-pointer rounded-3xl border border-border bg-white p-5 shadow-sm transition-transform hover:-translate-y-0.5 flex flex-col justify-between"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100">
              <PiggyBank className="w-4 h-4 text-slate-700" />
            </div>
            <div>
              <h3 className="font-display font-bold text-sm text-slate-900">Savings Pools</h3>
              <p className="text-[10px] text-slate-500">Active saving plans & deadlines</p>
            </div>
          </div>

          <div className="space-y-3 overflow-y-auto flex-1 pr-1 max-h-[220px]">
            {finance.goals.filter(g => g.target_amount > 0).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No active savings pools yet.</p>
            ) : (
              finance.goals.filter(g => g.target_amount > 0).slice(0, 4).map(goal => {
                const isComplete = goal.assigned_amount >= goal.target_amount;
                const progressPct = Math.min(100, (goal.assigned_amount / goal.target_amount) * 100);
                
                // Deadline pace logic
                let paceLabel = '';
                let isOverdue = false;
                if (goal.deadline) {
                  const d = new Date(goal.deadline);
                  const today = new Date();
                  const diffTime = d.getTime() - today.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  if (diffDays <= 0 && goal.assigned_amount < goal.target_amount) {
                    isOverdue = true;
                    paceLabel = 'Overdue';
                  } else if (diffDays > 0) {
                    const weeks = diffDays / 7;
                    const needed = (goal.target_amount - goal.assigned_amount) / weeks;
                    paceLabel = needed > 0 ? `${formatCurrency(needed, goal.currency)}/wk` : 'Done';
                  }
                } else if (goal.percent_allocation > 0) {
                  paceLabel = `${goal.percent_allocation}% split`;
                }

                return (
                  <div key={goal.id} className="border rounded-xl p-2.5 space-y-1.5 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: goal.color || '#A855F7' }} />
                        <span className="text-xs font-bold text-slate-800 truncate">{goal.name}</span>
                      </div>
                      {paceLabel && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          isOverdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {paceLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex items-end justify-between text-[10px] text-slate-500 tabular-nums">
                      <span>{formatCurrency(goal.assigned_amount, goal.currency)} saved</span>
                      <span>Target {formatCurrency(goal.target_amount, goal.currency)}</span>
                    </div>

                    <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${progressPct}%`,
                          backgroundColor: goal.color || '#A855F7'
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <div className="border-t border-border/60 pt-6 mt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between p-5 bg-white border border-border/80 rounded-[1.8rem] hover:bg-slate-50/80 transition-all text-left shadow-sm group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100 group-hover:bg-slate-200 transition-colors">
              <Activity className="w-4 h-4 text-slate-700" />
            </div>
            <div>
              <h3 className="font-display font-bold text-sm text-slate-900 flex items-center gap-2">
                Advanced Projections & Wealth Metrics
                <Badge variant="secondary" className="text-[9px] font-bold py-0.5 px-2 bg-slate-100 text-slate-600 border border-slate-200/50">
                  {daysRange === 7 ? '1 Week' : daysRange === 30 ? '30 Days' : daysRange === 90 ? '90 Days' : '6 Months'} Averages
                </Badge>
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Explore your behavioral averages, survival runways, and wealth forecasts</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-500 font-semibold text-xs pr-1">
            <span>{showAdvanced ? 'Hide Details' : 'Show Details'}</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>
        </button>

        {showAdvanced && (
          <div className="space-y-6 pt-6 animate-in fade-in slide-in-from-top-2 duration-300">
            {/* Header with pill toggles */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-display font-bold text-xs text-slate-400 uppercase tracking-[0.14em] flex items-center gap-1.5">
                  Financial Intelligence & Averages
                  <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" title="Averages calculated from transaction history over selected time window vs budget parameters" />
                </h4>
                <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">
                  Targets vs. {daysRange}-day averages
                </p>
              </div>

              <div className="flex items-center gap-1 bg-slate-100/80 backdrop-blur-sm rounded-xl p-1 border self-start sm:self-auto shadow-sm">
                {[7, 30, 90, 180].map(days => (
                  <button
                    key={days}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDaysRange(days);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      daysRange === days
                        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/40'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'
                    }`}
                  >
                    {days === 7 ? '1 Week' : days === 30 ? '30 Days' : days === 90 ? '90 Days' : '6 Months'}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid of 5 Conjoined Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {/* Card 1: Income Analysis (Blue) */}
              <div className="bg-white border border-blue-100/80 hover:border-blue-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500 block mb-3.5 flex items-center justify-between">
                    Income Analysis
                    <Info className="w-3.5 h-3.5 text-blue-400 cursor-help" title="Expected take-home salary vs actual transaction averages" />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Expected Net</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {fmt(snapshot?.weeklyGross ? snapshot.weeklyGross * 4.33 : 0)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-blue-500 block mb-1">{daysRange}-Day Avg</span>
                      <span className="text-xl font-display font-black text-blue-600 tabular-nums leading-none block">
                        {fmt(averages.avgMonthlyIncome)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-blue-600/85 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>Gross Contract:</span>
                  <span>{fmt(assumptions?.gross_annual_salary || 0)}/yr</span>
                </div>
              </div>

              {/* Card 2: Essentials Variable (Purple) */}
              <div className="bg-white border border-purple-100/80 hover:border-purple-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500 block mb-3.5 flex items-center justify-between">
                    Essentials Variable
                    <Info className="w-3.5 h-3.5 text-purple-400 cursor-help" title="Variable necessities (food, groceries, utility bills) vs actual transaction averages" />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Budget Limit</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {fmt(monthlyEssentialBudget)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-purple-500 block mb-1">{daysRange}-Day Avg</span>
                      <span className="text-xl font-display font-black text-purple-600 tabular-nums leading-none block">
                        {fmt(averages.avgMonthlyEssentials)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-purple-600/85 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>Survival Floor:</span>
                  <span>{fmt(snapshot?.emergencySurvivalMonthly || 0)}/mo</span>
                </div>
              </div>

              {/* Card 3: Fun Money Variable (Green) */}
              <div className="bg-white border border-emerald-100/80 hover:border-emerald-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block mb-3.5 flex items-center justify-between">
                    Fun Money Variable
                    <Info className="w-3.5 h-3.5 text-emerald-500 cursor-help" title="Discretionary lifestyle & fun allowance vs actual transaction averages" />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Budget Limit</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {fmt(monthlyFunBudget)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 block mb-1">{daysRange}-Day Avg</span>
                      <span className="text-xl font-display font-black text-emerald-600 tabular-nums leading-none block">
                        {fmt(averages.avgMonthlyFun)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-emerald-600/85 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>Weekly Burn Rate:</span>
                  <span>{fmt(averages.avgWeeklyVariableBurn)}/wk</span>
                </div>
              </div>

              {/* Card 4: Committed Fixed Bills (Pink) */}
              <div className="bg-white border border-pink-100/80 hover:border-pink-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-pink-500 block mb-3.5 flex items-center justify-between">
                    Committed Fixed Bills
                    <Info className="w-3.5 h-3.5 text-pink-400 cursor-help" title="Fixed committed rent & bill expenses vs actual cleared history" />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Committed</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {fmt(fixedMonthly)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-pink-500 block mb-1">{daysRange}-Day Avg</span>
                      <span className="text-xl font-display font-black text-pink-600 tabular-nums leading-none block">
                        {fmt(averages.avgMonthlyFixed)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-pink-600/85 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>Remaining Due:</span>
                  <span>{fmt(Math.max(0, fixedMonthly - fixedSpent))} this month</span>
                </div>
              </div>

              {/* Card 5: Savings & Pools (Amber) */}
              <div className="bg-white border border-amber-100/80 hover:border-amber-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block mb-3.5 flex items-center justify-between">
                    Savings & Pools
                    <Info className="w-3.5 h-3.5 text-amber-500 cursor-help" title="Cash assigned to custom savings goals vs unassigned everyday buffer cash" />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Assigned</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {fmt(poolsSum)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 block mb-1">Unassigned</span>
                      <span className="text-xl font-display font-black text-amber-600 tabular-nums leading-none block">
                        {fmt(unassignedCash)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-amber-700 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between gap-1 flex-wrap">
                  <span>Savings Rate: {averages.actualSavingsRate.toFixed(1)}%</span>
                  <span>Pace: {fmt(totalPoolsWeeklyPace)}/wk</span>
                </div>
              </div>
            </div>

            {/* Financial Projections & Efficiency Header */}
            <div className="pt-6 border-t border-slate-100">
              <h4 className="font-display font-bold text-xs text-slate-400 uppercase tracking-[0.14em] flex items-center gap-1.5">
                Wealth Projections & Efficiency
                <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" title="Long-term projections, milestone progress, spending health and drag speed metric insights" />
              </h4>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">Advanced runways, forecasted surplus, and spend velocity indexes</p>
            </div>

            {/* Grid of 4 Advanced Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Runway Scenarios */}
              <div className="bg-white border border-purple-100/80 hover:border-purple-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500 block mb-3.5 flex items-center justify-between">
                    Runway Scenarios
                    <Info className="w-3.5 h-3.5 text-purple-400 cursor-help" title="Survival: Months cash lasts with 0 fun money. Active: Months cash lasts at current variable spend rate." />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Survival (Zero Fun)</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {advancedMetrics.survivalRunwayMonths.toFixed(1)} <span className="text-[10px] font-bold opacity-75">mos</span>
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-purple-500 block mb-1">Active Burn</span>
                      <span className="text-xl font-display font-black text-purple-600 tabular-nums leading-none block">
                        {advancedMetrics.activeBurnRunwayMonths.toFixed(1)} <span className="text-[10px] font-bold opacity-75">mos</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-purple-600/85 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>Liquid Cash Position:</span>
                  <span>{fmt(finance.totalCashBase())}</span>
                </div>
              </div>

              {/* Card 2: Projections & Milestones */}
              <div className="bg-white border border-emerald-100/80 hover:border-emerald-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block mb-3.5 flex items-center justify-between">
                    Year-End & Milestones
                    <Info className="w-3.5 h-3.5 text-emerald-500 cursor-help" title="Year-End: Cash forecast based on current monthly net surplus. Freedom: Progress towards 6-mo buffer + all goal targets." />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Year-End Forecast</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {fmt(advancedMetrics.projectedYearEndCash)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-550 block mb-1">Freedom Progress</span>
                      <span className="text-xl font-display font-black text-emerald-600 tabular-nums leading-none block">
                        {advancedMetrics.freedomProgress.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-emerald-600/85 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>Target:</span>
                  <span>6-mo survival buffer + money pools</span>
                </div>
              </div>

              {/* Card 3: Outgoings & Efficiency */}
              <div className="bg-white border border-amber-100/80 hover:border-amber-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block mb-3.5 flex items-center justify-between">
                    Outgoings & Efficiency
                    <Info className="w-3.5 h-3.5 text-amber-500 cursor-help" title="Survival vs Fun: Necessity vs lifestyle outgoings ratio. Surplus Assigned: Percentage of cash surplus moved to goals." />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Survival vs Fun</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {advancedMetrics.survivalRatio.toFixed(0)}% / {advancedMetrics.discretionaryRatio.toFixed(0)}%
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 block mb-1">Surplus Assigned</span>
                      <span className="text-xl font-display font-black text-amber-600 tabular-nums leading-none block">
                        {advancedMetrics.savingsEfficiency.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-amber-700 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>Efficiency Check:</span>
                  <span>Surplus cash to pools</span>
                </div>
              </div>

              {/* Card 4: Velocity & Category Drag */}
              <div className="bg-white border border-pink-100/80 hover:border-pink-200/80 rounded-[1.8rem] p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[200px]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-pink-500 block mb-3.5 flex items-center justify-between">
                    Velocity & Category Drag
                    <Info className="w-3.5 h-3.5 text-pink-400 cursor-help" title="Spend Velocity: Discretionary spend change this week vs last. Top Drag: The category drawing the highest variable cash." />
                  </span>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Spend Velocity</span>
                      <span className="text-xl font-display font-black text-slate-900 tabular-nums leading-none block">
                        {advancedMetrics.spendVelocityPct >= 0 ? '+' : ''}{advancedMetrics.spendVelocityPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-pink-500 block mb-1">Top Variable Category</span>
                      <span className="text-xl font-display font-black text-pink-600 tabular-nums leading-none block truncate max-w-[150px]">
                        {advancedMetrics.topCatName}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-pink-600/85 mt-4 border-t border-slate-100 pt-2 font-semibold flex justify-between">
                  <span>{advancedMetrics.topCatName} spent:</span>
                  <span>{fmt(advancedMetrics.topCatAmt)} this month</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
