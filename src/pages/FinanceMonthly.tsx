import { useMemo, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses, FREQ_TO_MONTHLY } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot, computeRequiredGoalSavingsMonthly } from '@/lib/policyEngine';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import { deduplicateTransactions } from '@/lib/deduplication';
import MonthlyCashFlowBreakdown from '@/components/finance/MonthlyCashFlowBreakdown';
import {
  startOfMonth, endOfMonth, subMonths, addMonths, format,
  getDaysInMonth, getDate, getDay,
} from 'date-fns';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ChevronLeft, ChevronRight, ShoppingCart, PartyPopper,
  Lock, TrendingUp, TrendingDown, Minus, DollarSign,
  Pencil, Gauge, LayoutGrid, Sparkles,
  Award, MapPin, BarChart3, PiggyBank, Percent, CheckCircle2, Clock,
  Flame, Calendar,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import FinancialReportExporterModal from '@/components/finance/FinancialReportExporterModal';

// UK, Manchester & Australia Monthly Benchmarks (ONS / ASHE & ABS statistics for FULL-TIME WORKING INDIVIDUALS)
const MONTHLY_PEER_BENCHMARKS = [
  {
    id: 'manchester_avg',
    label: 'Manchester 23yo Full-Time',
    monthlyIncome: 1950,
    monthlyExpenses: 1450,
    monthlySavings: 500,
    annualProfit: 6000,
    description: 'Full-time working 23yo young professional in Manchester',
  },
  {
    id: 'uk_22_29_median',
    label: 'UK 22–29 Full-Time Median',
    monthlyIncome: 2100,
    monthlyExpenses: 1550,
    monthlySavings: 550,
    annualProfit: 6600,
    description: 'UK national median full-time young adult worker',
  },
  {
    id: 'australia_23yo_ft',
    label: 'Australia 23yo FT ($72k AUD)',
    monthlyIncome: 2400,
    monthlyExpenses: 1750,
    monthlySavings: 650,
    annualProfit: 7800,
    description: 'ABS median full-time graduate worker in Australia',
  },
  {
    id: 'uk_top_10',
    label: 'UK Top 10% (Age 22–29)',
    monthlyIncome: 2850,
    monthlyExpenses: 1800,
    monthlySavings: 1050,
    annualProfit: 12600,
    description: '90th percentile full-time young adult earner in the UK',
  },
];


export default function FinanceMonthly() {
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading, update: updateAssumptions } = useFinanceAssumptions();
  const { expenses: fixedExpenses, monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll, reimbursementsOn } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap: wtMap } = useWeekTypes();

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions,
      finance.categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, totalBoostThisWeek, wtMap(), [], fixedExpensesMonthlyAll,
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, totalBoostThisWeek, wtMap]);

  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>('manchester_avg');
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  const monthLabel = format(monthStart, 'MMMM yyyy');

  const baseCurrency = finance.settings?.base_currency || 'GBP';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const catMap = useMemo(() => new Map(finance.categories.map(c => [c.id, c])), [finance.categories]);
  const essentialCatIds = useMemo(() => new Set(
    finance.categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)
  ), [finance.categories]);

  // Monthly overview shows every committed fixed bill, including external bills like rent
  const fixedMonthly = fixedExpensesMonthlyAll;

  // Monthly budgets
  const monthlyEssentialBudget = snapshot
    ? snapshot.weeklyEssentialBudget * 4.33
    : (assumptions?.estimated_essential_variable || 400);
  const monthlyFunBudget = snapshot
    ? snapshot.baseWeeklyFun * 4.33
    : (assumptions ? (assumptions.weekly_fun_budget || 100) * 4.33 : 0);
  const monthlyVariableBudget = monthlyEssentialBudget + monthlyFunBudget;
  const autoTotalBudget = monthlyVariableBudget + fixedMonthly;
  const budgetOverride = (assumptions as any)?.monthly_budget_override;
  const monthlyTotalBudget = (budgetOverride != null && budgetOverride !== '') ? Number(budgetOverride) : autoTotalBudget;
  const expectedIncomeVal = snapshot?.split.monthlyIncome ?? (assumptions?.expected_monthly_income || 0);

  // Filter transactions for selected month (with canonical deduplication)
  const monthTxns = useMemo(() => {
    const raw = finance.transactions.filter(tx => {
      if (tx.is_reimbursable) return false;
      const d = parseUkDate(tx.posted_at);
      return d >= monthStart && d <= monthEnd;
    });
    return deduplicateTransactions(raw).cleaned;
  }, [finance.transactions, monthStart, monthEnd]);

  // Previous month transactions for comparison
  const prevMonthStart = startOfMonth(subMonths(selectedMonth, 1));
  const prevMonthEnd = endOfMonth(subMonths(selectedMonth, 1));
  const prevMonthTxns = useMemo(() => {
    const raw = finance.transactions.filter(tx => {
      if (tx.is_reimbursable) return false;
      const d = parseUkDate(tx.posted_at);
      return d >= prevMonthStart && d <= prevMonthEnd;
    });
    return deduplicateTransactions(raw).cleaned;
  }, [finance.transactions, prevMonthStart, prevMonthEnd]);

  // Treat transaction as fixed bill if linked to fixed expense, has is_fixed flag, or belongs to fixed category
  const isFixedTx = useCallback((tx: any): boolean => {
    if (tx.is_fixed || tx.fixed_expense_id) return true;
    const cat = catMap.get(tx.category_id || '');
    return cat?.type === 'fixed';
  }, [catMap]);

  // Spending breakdown (strictly separating Fixed Bills from Variable Categories)
  const { essentialSpent, funSpent, fixedSpent, incomeTotal, variableCategoryBreakdown, paidFixedTxns, dailyData } = useMemo(() => {
    let essentialSpent = 0;
    let funSpent = 0;
    let fixedSpent = 0;
    let incomeTotal = 0;
    const catTotals = new Map<string, number>();
    const paidFixedTxns: Array<{ id: string; name: string; amount: number; date: Date; fixedExpenseId?: string | null }> = [];

    for (const tx of monthTxns) {
      const cat = catMap.get(tx.category_id || '');
      const rawText = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
      const isIncomeCategory = cat?.type === 'income';
      const isGabriellaIncome = rawText.includes('gabriella') && tx.amount > 0 && !tx.transfer_group_id && !tx.is_transfer;
      const isIncomeKeyword = rawText.includes('batchbase') || rawText.includes('batch base') || rawText.includes('payroll') || rawText.includes('salary') || rawText.includes('venture') || rawText.includes('etsy') || isGabriellaIncome;

      if (tx.amount > 0 && (!tx.is_transfer || isIncomeCategory || isIncomeKeyword)) {
        if (!tx.is_reimbursable && (cat?.type !== 'transfer' || isIncomeKeyword)) {
          incomeTotal += baseAmt(tx);
          continue;
        }
      }
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id) continue;
      if (cat?.exclude_from_reports) continue;

      const amt = Math.abs(baseAmt(tx));

      if (isFixedTx(tx)) {
        fixedSpent += amt;
        paidFixedTxns.push({
          id: tx.id,
          name: tx.merchant || tx.description || cat?.name || 'Fixed Bill',
          amount: amt,
          date: parseUkDate(tx.posted_at),
          fixedExpenseId: (tx as any).fixed_expense_id,
        });
        continue;
      }
      if (cat?.type === 'income' || cat?.type === 'transfer') continue;

      const catId = tx.category_id || '__uncategorised';
      catTotals.set(catId, (catTotals.get(catId) || 0) + amt);

      if (essentialCatIds.has(catId)) {
        essentialSpent += amt;
      } else {
        funSpent += amt;
      }
    }

    const variableCategoryBreakdown = Array.from(catTotals.entries()).map(([catId, total]) => {
      const cat = catMap.get(catId);
      return {
        catId,
        name: cat?.name || 'Uncategorised',
        color: cat?.color || '#888',
        total,
        isEssential: essentialCatIds.has(catId),
      };
    }).sort((a, b) => b.total - a.total);

    // Daily variable data
    const daysInMonth = getDaysInMonth(monthStart);
    const dailyData = Array.from({ length: daysInMonth }, () => ({ essential: 0, fun: 0 }));

    for (const tx of monthTxns) {
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id) continue;
      if (isFixedTx(tx)) continue;
      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports || cat?.type === 'income' || cat?.type === 'transfer') continue;
      const d = parseUkDate(tx.posted_at);
      const dayIdx = getDate(d) - 1;
      if (dayIdx >= 0 && dayIdx < daysInMonth) {
        const amt = Math.abs(baseAmt(tx));
        if (essentialCatIds.has(tx.category_id || '')) {
          dailyData[dayIdx].essential += amt;
        } else {
          dailyData[dayIdx].fun += amt;
        }
      }
    }

    // Add phantom reimbursements from externally-paid bills so income isn't understated
    const monthIso = format(monthStart, 'yyyy-MM-dd');
    for (const r of reimbursementsOn(monthIso)) incomeTotal += r.amount;

    return { essentialSpent, funSpent, fixedSpent, incomeTotal, variableCategoryBreakdown, paidFixedTxns, dailyData };
  }, [monthTxns, catMap, essentialCatIds, monthStart, isFixedTx, reimbursementsOn]);

  const variableSpent = essentialSpent + funSpent;
  const totalSpent = variableSpent + fixedSpent;
  const netProfit = incomeTotal - totalSpent;
  const savingsRate = incomeTotal > 0 ? (netProfit / incomeTotal) * 100 : 0;

  // Pool savings monthly target
  const poolSavingsMonthly = useMemo(() => {
    const directGoalSavings = computeRequiredGoalSavingsMonthly(
      finance.goals,
      finance.convertToBase,
      selectedMonth,
      incomeTotal || expectedIncomeVal
    );
    return (snapshot?.split.goalSavingsAmount && snapshot.split.goalSavingsAmount > 0)
      ? snapshot.split.goalSavingsAmount
      : directGoalSavings;
  }, [finance.goals, finance.convertToBase, selectedMonth, incomeTotal, expectedIncomeVal, snapshot]);

  // Savings Stash: shock absorber pool that absorbs weekly/monthly overspend
  const stashGoal = useMemo(() => finance.goals.find(g => (g as any).is_stash === true || g.name.toLowerCase().includes('stash')), [finance.goals]);
  const stashBalance = stashGoal ? finance.convertToBase(stashGoal.assigned_amount || 0, stashGoal.currency) : 0;

  // Pace projection (focused on Variable Spending: Essentials + Fun)
  const today = new Date();
  const isCurrentMonth = today >= monthStart && today <= monthEnd;
  const daysInMonth = getDaysInMonth(monthStart);
  const daysElapsed = isCurrentMonth ? getDate(today) : daysInMonth;
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  const dailyVariablePace = daysElapsed > 0 ? variableSpent / daysElapsed : 0;
  const targetDailyVariable = daysInMonth > 0 ? monthlyVariableBudget / daysInMonth : 0;
  const variableRemaining = Math.max(0, monthlyVariableBudget - variableSpent);
  const safeDailyRemaining = daysRemaining > 0 ? variableRemaining / daysRemaining : 0;

  const projectedVariableSpend = dailyVariablePace * daysInMonth;
  const projectedSpend = projectedVariableSpend + fixedMonthly;
  const projectedDiff = projectedSpend - monthlyTotalBudget; // positive => over

  const timePct = (daysElapsed / daysInMonth) * 100;
  const variableUsedPct = monthlyVariableBudget > 0 ? (variableSpent / monthlyVariableBudget) * 100 : 0;

  // Previous month totals for comparison
  const prevTotals = useMemo(() => {
    let essential = 0, fun = 0, fixed = 0, income = 0;
    const catTotals = new Map<string, number>();
    for (const tx of prevMonthTxns) {
      const cat = catMap.get(tx.category_id || '');
      const rawText = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
      const isIncomeCategory = cat?.type === 'income';
      const isGabriellaIncome = rawText.includes('gabriella') && tx.amount > 0 && !tx.transfer_group_id;
      const isIncomeKeyword = rawText.includes('batchbase') || rawText.includes('batch base') || rawText.includes('payroll') || rawText.includes('salary') || rawText.includes('venture') || rawText.includes('etsy') || isGabriellaIncome;
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
        continue;
      }
      if (cat?.type === 'income' || cat?.type === 'transfer') continue;

      const catId = tx.category_id || '__uncategorised';
      catTotals.set(catId, (catTotals.get(catId) || 0) + amt);

      if (essentialCatIds.has(tx.category_id || '')) {
        essential += amt;
      } else {
        fun += amt;
      }
    }
    const prevMonthIso = format(prevMonthStart, 'yyyy-MM-dd');
    for (const r of reimbursementsOn(prevMonthIso)) income += r.amount;

    return { essential, fun, fixed, income, total: essential + fun + fixed, catTotals };
  }, [prevMonthTxns, catMap, essentialCatIds, isFixedTx, prevMonthStart, reimbursementsOn]);

  // Pro-rated comparison scaling for month-to-date
  const daysInPrevMonth = useMemo(() => getDaysInMonth(prevMonthStart), [prevMonthStart]);
  const proRateFactor = useMemo(() => {
    return (isCurrentMonth && daysInPrevMonth > 0) ? (daysElapsed / daysInPrevMonth) : 1;
  }, [isCurrentMonth, daysElapsed, daysInPrevMonth]);

  const prevTotalsProrated = useMemo(() => {
    return {
      essential: prevTotals.essential * proRateFactor,
      fun: prevTotals.fun * proRateFactor,
      fixed: prevTotals.fixed * proRateFactor,
      total: prevTotals.total * proRateFactor,
      income: prevTotals.income * proRateFactor,
    };
  }, [prevTotals, proRateFactor]);

  // Multi-horizon historical comparison (Last Month, Last 3 Months, Last 6 Months, Last Year / 12 Months)
  const [comparisonBaselineMode, setComparisonBaselineMode] = useState<'projected' | 'budget'>('projected');
  const [selectedHorizonIdx, setSelectedHorizonIdx] = useState<number>(0);
  const [showFullComparisonTable, setShowFullComparisonTable] = useState<boolean>(false);

  const historicalHorizons = useMemo(() => {
    type MonthBucket = {
      label: string;
      essential: number;
      fun: number;
      fixed: number;
      total: number;
      income: number;
      net: number;
      hasActivity: boolean;
    };

    const buckets: MonthBucket[] = [];
    for (let m = 1; m <= 12; m++) {
      const mStart = startOfMonth(subMonths(selectedMonth, m));
      const mEnd = endOfMonth(subMonths(selectedMonth, m));
      let essential = 0;
      let fun = 0;
      let fixed = 0;
      let income = 0;

      for (const tx of finance.transactions) {
        if (tx.is_reimbursable) continue;
        const d = parseUkDate(tx.posted_at);
        if (d < mStart || d > mEnd) continue;

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
          if (cat?.type !== 'transfer' || isIncomeKeyword) {
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
          continue;
        }
        if (cat?.type === 'income' || cat?.type === 'transfer') continue;

        if (essentialCatIds.has(tx.category_id || '')) {
          essential += amt;
        } else {
          fun += amt;
        }
      }

      const mIso = format(mStart, 'yyyy-MM-dd');
      for (const r of reimbursementsOn(mIso)) income += r.amount;

      const total = fixed + essential + fun;
      const hasActivity = total > 0 || income > 0;
      buckets.push({
        label: format(mStart, 'MMM yyyy'),
        essential,
        fun,
        fixed,
        total,
        income,
        net: income - total,
        hasActivity,
      });
    }

    const aggregateWindow = (windowMonths: number, title: string, subtitle: string) => {
      const slice = buckets.slice(0, windowMonths);
      const active = slice.filter(b => b.hasActivity);
      const divisor = Math.max(1, active.length);
      const sum = (fn: (b: MonthBucket) => number) => active.reduce((s, b) => s + fn(b), 0);

      const avgFixed = sum(b => b.fixed) / divisor;
      const avgEssential = sum(b => b.essential) / divisor;
      const avgFun = sum(b => b.fun) / divisor;
      const avgTotal = sum(b => b.total) / divisor;
      const avgIncome = sum(b => b.income) / divisor;
      const avgNet = avgIncome - avgTotal;

      return {
        windowMonths,
        title,
        subtitle,
        activeMonthsCount: active.length,
        fixed: avgFixed,
        essential: avgEssential,
        fun: avgFun,
        total: avgTotal,
        income: avgIncome,
        net: avgNet,
        cumulativeTotal: sum(b => b.total),
        cumulativeIncome: sum(b => b.income),
      };
    };

    const last1Label = buckets[0]?.label || 'Previous month';
    return {
      lastMonth: aggregateWindow(1, 'Last Month', last1Label),
      last3Months: aggregateWindow(3, 'Last 3 Months', 'Monthly average'),
      last6Months: aggregateWindow(6, 'Last 6 Months', 'Monthly average'),
      lastYear: aggregateWindow(12, 'Last Year (12M)', 'Monthly average'),
    };
  }, [finance.transactions, selectedMonth, catMap, essentialCatIds, isFixedTx, reimbursementsOn]);

  const projectedEssentialSpend = isCurrentMonth && daysElapsed > 0
    ? (essentialSpent / daysElapsed) * daysInMonth
    : essentialSpent;
  const projectedFunSpend = isCurrentMonth && daysElapsed > 0
    ? (funSpent / daysElapsed) * daysInMonth
    : funSpent;

  const thisMonthComparisonTarget = useMemo(() => {
    const expIncome = Math.max(incomeTotal, expectedIncomeVal);
    if (!isCurrentMonth) {
      return {
        modeLabel: `${monthLabel} Actual`,
        fixed: fixedSpent,
        essential: essentialSpent,
        fun: funSpent,
        total: totalSpent,
        income: incomeTotal,
        net: incomeTotal - totalSpent,
      };
    }
    if (comparisonBaselineMode === 'budget') {
      return {
        modeLabel: 'Planned Budget',
        fixed: fixedMonthly,
        essential: monthlyEssentialBudget,
        fun: monthlyFunBudget,
        total: monthlyTotalBudget,
        income: expIncome,
        net: expIncome - monthlyTotalBudget,
      };
    }
    return {
      modeLabel: 'Projected Finish (Pace)',
      fixed: fixedMonthly,
      essential: projectedEssentialSpend,
      fun: projectedFunSpend,
      total: projectedSpend,
      income: expIncome,
      net: expIncome - projectedSpend,
    };
  }, [
    isCurrentMonth,
    comparisonBaselineMode,
    monthLabel,
    fixedSpent,
    essentialSpent,
    funSpent,
    totalSpent,
    incomeTotal,
    expectedIncomeVal,
    fixedMonthly,
    monthlyEssentialBudget,
    monthlyFunBudget,
    monthlyTotalBudget,
    projectedEssentialSpend,
    projectedFunSpend,
    projectedSpend,
  ]);

  // Effective spending for peer benchmark comparison
  const effectiveSpent = isCurrentMonth ? projectedSpend : totalSpent;
  const effectiveNetProfit = incomeTotal - effectiveSpent;

  const selectedBenchmark = useMemo(() => (
    MONTHLY_PEER_BENCHMARKS.find(b => b.id === selectedBenchmarkId) || MONTHLY_PEER_BENCHMARKS[0]
  ), [selectedBenchmarkId]);

  const annualizedNetProfit = netProfit * 12;
  const incomeDiffPct = selectedBenchmark.monthlyIncome > 0 ? ((incomeTotal - selectedBenchmark.monthlyIncome) / selectedBenchmark.monthlyIncome) * 100 : 0;
  const spendingDiffPct = selectedBenchmark.monthlyExpenses > 0 ? ((effectiveSpent - selectedBenchmark.monthlyExpenses) / selectedBenchmark.monthlyExpenses) * 100 : 0;
  const netProfitDiffPct = selectedBenchmark.monthlySavings > 0 ? ((effectiveNetProfit - selectedBenchmark.monthlySavings) / selectedBenchmark.monthlySavings) * 100 : 0;

  const { percentileLabel } = useMemo(() => {
    const p = netProfit;
    if (p >= 1500) return { percentileLabel: 'Top 2%', percentileRank: 98 };
    if (p >= 1050) return { percentileLabel: 'Top 5%', percentileRank: 95 };
    if (p >= 750) return { percentileLabel: 'Top 10%', percentileRank: 90 };
    if (p >= 550) return { percentileLabel: 'Top 25%', percentileRank: 75 };
    if (p >= 400) return { percentileLabel: 'Top 45%', percentileRank: 55 };
    if (p > 0) return { percentileLabel: 'Top 60%', percentileRank: 40 };
    return { percentileLabel: 'Building Surplus', percentileRank: 20 };
  }, [netProfit]);

  // Budget editor
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const openBudgetDialog = () => {
    setBudgetInput(budgetOverride != null && budgetOverride !== '' ? String(budgetOverride) : '');
    setBudgetDialogOpen(true);
  };
  const saveBudget = async () => {
    const v = budgetInput.trim();
    await updateAssumptions({ monthly_budget_override: v === '' ? null : Number(v) } as any);
    setBudgetDialogOpen(false);
    toast.success('Monthly budget updated');
  };

  const trendIcon = (current: number, previous: number, invert = false) => {
    if (invert) {
      if (current > previous * 1.05) return <TrendingUp className="w-3 h-3 text-emerald-500" />;
      if (current < previous * 0.95) return <TrendingDown className="w-3 h-3 text-destructive" />;
      return <Minus className="w-3 h-3 text-muted-foreground" />;
    }
    if (current > previous * 1.05) return <TrendingUp className="w-3 h-3 text-destructive" />;
    if (current < previous * 0.95) return <TrendingDown className="w-3 h-3 text-emerald-500" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  const trendPercent = (current: number, previous: number) => {
    if (previous === 0) return '';
    const pct = ((current - previous) / previous) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
  };

  const essentialCats = variableCategoryBreakdown.filter(c => c.isEssential);
  const funCats = variableCategoryBreakdown.filter(c => !c.isEssential);

  // Build Fixed Bills checklist (committed bills matched against paid fixed transactions this month)
  const fixedBillsStatusList = useMemo(() => {
    const activeExpenses = fixedExpenses.filter(e => (e as any).is_active !== false);
    const usedTxIds = new Set<string>();

    const items = activeExpenses.map(exp => {
      const monthlyAmt = finance.convertToBase(exp.amount, exp.currency) * (FREQ_TO_MONTHLY[exp.frequency] ?? 1);
      const expWords = exp.name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);

      const matchedTx = paidFixedTxns.find(tx => {
        if (usedTxIds.has(tx.id)) return false;
        if (tx.fixedExpenseId && tx.fixedExpenseId === exp.id) return true;
        const txLower = tx.name.toLowerCase();
        if (expWords.some(w => txLower.includes(w))) return true;
        return Math.abs(tx.amount - monthlyAmt) <= Math.max(2, monthlyAmt * 0.08);
      });

      if (matchedTx) usedTxIds.add(matchedTx.id);

      const isExternalPaid = Boolean(exp.paid_externally);
      const isPaid = Boolean(matchedTx) || (isExternalPaid && exp.due_day ? exp.due_day <= daysElapsed : isExternalPaid);

      return {
        id: exp.id,
        name: exp.name,
        committedAmount: monthlyAmt,
        paidAmount: matchedTx ? matchedTx.amount : (isPaid ? monthlyAmt : 0),
        isPaid,
        dueDay: exp.due_day,
        paidExternally: exp.paid_externally,
      };
    });

    // Include any extra fixed transactions that didn't match a template bill
    for (const tx of paidFixedTxns) {
      if (!usedTxIds.has(tx.id)) {
        items.push({
          id: tx.id,
          name: tx.name,
          committedAmount: tx.amount,
          paidAmount: tx.amount,
          isPaid: true,
          dueDay: getDate(tx.date),
          paidExternally: false,
        });
      }
    }

    return items.sort((a, b) => b.committedAmount - a.committedAmount);
  }, [fixedExpenses, paidFixedTxns, finance.convertToBase, daysElapsed]);

  // Category drill-down (for clicking any category row)
  const [selectedCategory, setSelectedCategory] = useState<{ catId: string; name: string; color: string } | null>(null);
  const [selectedDayNum, setSelectedDayNum] = useState<number | null>(null);
  const [dailyViewMode, setDailyViewMode] = useState<'heatmap' | 'timeline'>('heatmap');

  // Heatmap & Habit Trends calculation
  const heatmapData = useMemo(() => {
    const daysInMonth = getDaysInMonth(monthStart);
    // Find weekday index for 1st of month: Monday = 0, ..., Sunday = 6
    const firstDayWeekday = (getDay(monthStart) + 6) % 7;

    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const dayNum = i + 1;
      const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNum);
      const dayOfWeek = (getDay(dayDate) + 6) % 7; // 0 = Mon, 6 = Sun
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Sat or Sun

      const dayTxns = monthTxns.filter(tx => {
        if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) return false;
        if ((tx as any).goal_id || isFixedTx(tx)) return false;
        const cat = catMap.get(tx.category_id || '');
        if (cat?.exclude_from_reports || cat?.type === 'income' || cat?.type === 'transfer') return false;
        const txDate = parseUkDate(tx.posted_at);
        return getDate(txDate) === dayNum &&
               txDate.getMonth() === monthStart.getMonth() &&
               txDate.getFullYear() === monthStart.getFullYear();
      });

      let essential = 0;
      let fun = 0;
      let topMerchant = '';
      let topMerchantAmount = 0;

      for (const tx of dayTxns) {
        const amt = Math.abs(baseAmt(tx));
        if (essentialCatIds.has(tx.category_id || '')) {
          essential += amt;
        } else {
          fun += amt;
        }
        if (amt > topMerchantAmount) {
          topMerchantAmount = amt;
          topMerchant = tx.merchant || tx.description || 'Expense';
        }
      }

      const total = essential + fun;
      return {
        dayNum,
        date: dayDate,
        dayOfWeek,
        isWeekend,
        essential,
        fun,
        total,
        txCount: dayTxns.length,
        topMerchant,
        topMerchantAmount,
      };
    });

    const maxSpent = Math.max(...days.map(d => d.total), 1);
    const nonZeroDays = days.filter(d => d.total > 0);
    const avgDailySpent = nonZeroDays.length > 0
      ? nonZeroDays.reduce((sum, d) => sum + d.total, 0) / nonZeroDays.length
      : 0;

    // Heat Level (0 to 5)
    const getHeatLevel = (total: number): number => {
      if (total <= 0.01) return 0;
      const ratio = total / maxSpent;
      if (ratio > 0.85) return 5;
      if (ratio > 0.60) return 4;
      if (ratio > 0.35) return 3;
      if (ratio > 0.15) return 2;
      return 1;
    };

    // Trends & Habits
    // 1. Top 3 spending spikes
    const sortedBySpend = [...days].filter(d => d.total > 0).sort((a, b) => b.total - a.total);
    const topSpikes = sortedBySpend.slice(0, 3);
    const topSpikeDayNums = new Set(topSpikes.map(s => s.dayNum));

    // 2. Weekday vs Weekend spending
    const weekdayDays = days.filter(d => !d.isWeekend);
    const weekendDays = days.filter(d => d.isWeekend);
    const weekdayTotal = weekdayDays.reduce((s, d) => s + d.total, 0);
    const weekendTotal = weekendDays.reduce((s, d) => s + d.total, 0);
    const weekdayAvg = weekdayDays.length > 0 ? weekdayTotal / weekdayDays.length : 0;
    const weekendAvg = weekendDays.length > 0 ? weekendTotal / weekendDays.length : 0;
    const weekendMultiplier = weekdayAvg > 0 ? (weekendAvg / weekdayAvg) : 0;

    // 3. Day of week totals (Mon..Sun)
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayShortNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const byDayOfWeek = Array.from({ length: 7 }, (_, dow) => {
      const matchDays = days.filter(d => d.dayOfWeek === dow);
      const total = matchDays.reduce((s, d) => s + d.total, 0);
      const avg = matchDays.length > 0 ? total / matchDays.length : 0;
      return {
        dow,
        name: dayNames[dow],
        shortName: dayShortNames[dow],
        total,
        avg,
        count: matchDays.length,
      };
    });
    const peakDayOfWeek = [...byDayOfWeek].sort((a, b) => b.total - a.total)[0];

    // 4. No-spend days count
    const noSpendDaysCount = days.filter(d => d.total <= 0.01).length;
    const noSpendPct = Math.round((noSpendDaysCount / daysInMonth) * 100);

    return {
      days,
      firstDayWeekday,
      maxSpent,
      avgDailySpent,
      getHeatLevel,
      topSpikes,
      topSpikeDayNums,
      weekdayTotal,
      weekendTotal,
      weekdayAvg,
      weekendAvg,
      weekendMultiplier,
      byDayOfWeek,
      peakDayOfWeek,
      noSpendDaysCount,
      noSpendPct,
      totalVariableSpent: days.reduce((s, d) => s + d.total, 0),
    };
  }, [monthStart, monthTxns, catMap, isFixedTx, essentialCatIds]);

  const selectedMonthlyDayDate = useMemo(() => {
    if (selectedDayNum === null) return null;
    return new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), selectedDayNum);
  }, [selectedDayNum, selectedMonth]);

  const selectedMonthlyDayTxns = useMemo(() => {
    if (!selectedMonthlyDayDate) return [];
    const targetStr = format(selectedMonthlyDayDate, 'yyyy-MM-dd');
    return monthTxns.filter(tx => {
      if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) return false;
      if ((tx as any).goal_id || isFixedTx(tx)) return false;
      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports || cat?.type === 'income' || cat?.type === 'transfer') return false;
      const txUkDateStr = format(parseUkDate(tx.posted_at), 'yyyy-MM-dd');
      return txUkDateStr === targetStr;
    }).sort((a, b) => parseUkDate(b.posted_at).getTime() - parseUkDate(a.posted_at).getTime());
  }, [selectedMonthlyDayDate, monthTxns, catMap, isFixedTx]);

  const selectedMonthlyDayTotal = useMemo(() => {
    return selectedMonthlyDayTxns.reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);
  }, [selectedMonthlyDayTxns]);

  // Known-brand dictionary for clean merchant names
  const BRAND_MAP: Array<{ match: RegExp; name: string }> = [
    { match: /\bbolt(\.eu|\.com)?\b/i, name: 'Bolt' },
    { match: /\buber(?!\s*eats)\b/i, name: 'Uber' },
    { match: /\blyft\b/i, name: 'Lyft' },
    { match: /\btfl\b|transport for london/i, name: 'TfL' },
    { match: /\btfgm\b|beenetwork/i, name: 'TfGM (Manchester)' },
    { match: /national\s*rail|trainline|lner|avanti|northern rail/i, name: 'National Rail' },
    { match: /sainsbury/i, name: "Sainsbury's" },
    { match: /tesco/i, name: 'Tesco' },
    { match: /\basda\b/i, name: 'Asda' },
    { match: /\baldi\b/i, name: 'Aldi' },
    { match: /\blidl\b/i, name: 'Lidl' },
    { match: /waitrose/i, name: 'Waitrose' },
    { match: /\bco[- ]?op\b|cooperative/i, name: 'Co-op' },
    { match: /marks\s*&?\s*spencer|\bm&s\b/i, name: 'M&S' },
    { match: /morrisons/i, name: 'Morrisons' },
    { match: /iceland/i, name: 'Iceland' },
    { match: /\bboots\b/i, name: 'Boots' },
    { match: /super\s*drug/i, name: 'Superdrug' },
    { match: /lloyds\s*pharm/i, name: 'Lloyds Pharmacy' },
    { match: /well\s*pharmacy/i, name: 'Well Pharmacy' },
    { match: /day\s*lewis/i, name: 'Day Lewis' },
    { match: /rowlands/i, name: 'Rowlands' },
    { match: /deliveroo/i, name: 'Deliveroo' },
    { match: /just\s*eat/i, name: 'Just Eat' },
    { match: /uber\s*eats/i, name: 'Uber Eats' },
    { match: /gousto/i, name: 'Gousto' },
    { match: /hellofresh/i, name: 'HelloFresh' },
    { match: /wetherspoon/i, name: 'Wetherspoons' },
    { match: /pret\s*a\s*manger|\bpret\b/i, name: 'Pret A Manger' },
    { match: /greggs/i, name: 'Greggs' },
    { match: /mcdonald/i, name: "McDonald's" },
    { match: /starbucks/i, name: 'Starbucks' },
    { match: /costa\s*coffee|\bcosta\b/i, name: 'Costa' },
    { match: /caff[eè]?\s*nero|\bnero\b/i, name: 'Caffè Nero' },
    { match: /leno\s*ex\s*machina/i, name: 'Leno Ex Machina' },
    { match: /freemount/i, name: 'Freemount' },
    { match: /slemani/i, name: 'Slemani Restaurant' },
  ];

  const NOISE = /\b(london|manchester|manches|watford|leeds|birmingham|liverpool|glasgow|edinburgh|bristol|cardiff|nottingham|notting|uk|gbr|ltd|limited|plc|tickets?|purchase|payment|contactless|visa|mastercard|ref|txn|the)\b/gi;

  const canonicaliseMerchant = (rawInput: string): string => {
    const raw = (rawInput || '').trim();
    if (!raw) return 'Unknown';
    for (const b of BRAND_MAP) if (b.match.test(raw)) return b.name;
    let cleaned = raw
      .replace(/[.,/\\|*#]+/g, ' ')
      .replace(/\b\d{4,}\b/g, ' ')
      .replace(/\b[a-z]{2,4}\d+[a-z0-9]*/gi, ' ')
      .replace(NOISE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) cleaned = raw;
    const words = cleaned.split(' ').slice(0, 3).join(' ');
    return words.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  const categoryMerchantBreakdown = useMemo(() => {
    if (!selectedCategory) return [] as { name: string; total: number; count: number }[];
    const map = new Map<string, { total: number; count: number }>();
    for (const tx of monthTxns) {
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id || isFixedTx(tx)) continue;
      const catId = tx.category_id || '__uncategorised';
      if (catId !== selectedCategory.catId) continue;
      const key = canonicaliseMerchant(tx.merchant || tx.description || '');
      const prev = map.get(key) || { total: 0, count: 0 };
      map.set(key, { total: prev.total + Math.abs(baseAmt(tx)), count: prev.count + 1 });
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, total: data.total, count: data.count }))
      .sort((a, b) => b.total - a.total);
  }, [selectedCategory, monthTxns, isFixedTx]);

  const maxDaily = Math.max(...dailyData.map(d => d.essential + d.fun), targetDailyVariable * 1.2, 1);

  if (finance.loading || assumptionsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Monthly Overview</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full font-body pb-12">
      {/* Header with month selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Monthly Overview</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {isCurrentMonth
              ? `Day ${daysElapsed} of ${daysInMonth} (${daysRemaining} days remaining in ${monthLabel})`
              : `Full month summary for ${monthLabel} (${daysInMonth} days)`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <FinancialReportExporterModal />
          <div className="flex items-center gap-1 bg-white/80 backdrop-blur-sm p-1 rounded-2xl border border-pink-200/60 shadow-2xs">
            <Button variant="ghost" size="icon" onClick={() => setSelectedMonth(m => subMonths(m, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold min-w-[130px] text-center">{monthLabel}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedMonth(m => addMonths(m, 1))}
              disabled={monthEnd >= new Date()}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="overflow-x-auto touch-scroll max-w-full">
          <TabsList className="bg-white/90 backdrop-blur-md p-1 rounded-xl border border-slate-200/80 shadow-xs inline-flex h-auto items-center gap-1 min-w-max">
            <TabsTrigger
              value="overview"
              className="rounded-lg px-4 py-2 font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all flex items-center gap-1.5"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Monthly Tracker & Spend
            </TabsTrigger>
            <TabsTrigger
              value="breakdown"
              className="rounded-lg px-4 py-2 font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Cash Flow Engine & Peer Benchmarks
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ========================================================= */}
        {/* TAB 1: MONTHLY TRACKER & SPEND                            */}
        {/* ========================================================= */}
        <TabsContent value="overview" className="mt-5 space-y-6 focus-visible:outline-none">

          {/* BLOCK 1: THE MONTHLY EQUATION STRIP (Numbers strictly add up!) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* 1. Total Spent So Far */}
            <div className="rounded-2xl border-2 border-[#FF2EB8] bg-white p-4 shadow-[4px_4px_0_rgba(255,46,184,0.14)] flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#FFE0F1] flex items-center justify-center shrink-0">
                    <DollarSign className="w-4 h-4 text-[#FF2EB8]" />
                  </div>
                  <p className="text-[11px] font-display font-bold uppercase tracking-wider text-[#FF2EB8]">
                    Total Spent So Far
                  </p>
                </div>
              </div>
              <div>
                <div className="font-display font-black tabular-nums text-2xl sm:text-[1.65rem] text-slate-900 leading-none">
                  {fmt(totalSpent)}
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-1.5">
                  of {fmt(monthlyTotalBudget)} monthly budget
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#FF2EB8]"
                    style={{ width: `${Math.min(100, monthlyTotalBudget > 0 ? (totalSpent / monthlyTotalBudget) * 100 : 0)}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-between">
                  <span>{fmt(fixedSpent)} bills + {fmt(variableSpent)} var</span>
                  <span className="flex items-center gap-0.5 font-medium">
                    {trendIcon(totalSpent, prevTotalsProrated.total)}
                    {trendPercent(totalSpent, prevTotalsProrated.total)}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Fixed Bills (Paid vs Committed) */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4 text-rose-600" />
                  </div>
                  <p className="text-[11px] font-display font-bold uppercase tracking-wider text-slate-700">
                    1. Fixed Bills Paid
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">
                  {fixedMonthly > 0 ? `${Math.min(100, Math.round((fixedSpent / fixedMonthly) * 100))}%` : '0%'}
                </span>
              </div>
              <div>
                <div className="font-display font-black tabular-nums text-2xl sm:text-[1.65rem] text-slate-900 leading-none">
                  {fmt(fixedSpent)}
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-1.5">
                  of {fmt(fixedMonthly)} committed
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-rose-500"
                    style={{ width: `${Math.min(100, fixedMonthly > 0 ? (fixedSpent / fixedMonthly) * 100 : 0)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {Math.max(0, fixedMonthly - fixedSpent) > 0.5
                    ? `${fmt(Math.max(0, fixedMonthly - fixedSpent))} still to clear`
                    : 'All monthly bills cleared ✓'}
                </p>
              </div>
            </div>

            {/* 3. Unified Variable Spending (Weekly Allowance Combined) */}
            <div className={cn(
              "rounded-2xl border bg-white p-4 shadow-2xs flex flex-col justify-between gap-2",
              variableSpent > monthlyVariableBudget ? "border-rose-300 bg-rose-50/20" : "border-slate-200/90"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                    <ShoppingCart className="w-4 h-4 text-purple-700" />
                  </div>
                  <div>
                    <p className="text-[11px] font-display font-bold uppercase tracking-wider text-purple-800">
                      2. Variable Spending
                    </p>
                  </div>
                </div>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full",
                  variableSpent > monthlyVariableBudget ? "bg-rose-50 text-rose-700" : "bg-purple-50 text-purple-700"
                )}>
                  {monthlyVariableBudget > 0 ? `${Math.round((variableSpent / monthlyVariableBudget) * 100)}%` : '0%'}
                </span>
              </div>
              <div>
                <div className="font-display font-black tabular-nums text-2xl sm:text-[1.65rem] text-purple-700 leading-none">
                  {fmt(variableSpent)}
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-1.5">
                  of {fmt(monthlyVariableBudget)} combined budget
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", variableSpent > monthlyVariableBudget ? "bg-rose-500" : "bg-purple-600")}
                    style={{ width: `${Math.min(100, monthlyVariableBudget > 0 ? (variableSpent / monthlyVariableBudget) * 100 : 0)}%` }}
                  />
                </div>
                <div className="text-[10px] font-medium text-slate-500 mt-1.5 flex items-center justify-between">
                  <span>
                    Ess {fmt(essentialSpent)} · Fun {fmt(funSpent)}
                  </span>
                  <span className="tabular-nums">
                    {variableSpent <= monthlyVariableBudget
                      ? `${fmt(monthlyVariableBudget - variableSpent)} left`
                      : `${fmt(variableSpent - monthlyVariableBudget)} over`}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. Savings Stash & Shock Absorber */}
            <div className={cn(
              "rounded-2xl border bg-white p-4 shadow-2xs flex flex-col justify-between gap-2",
              variableSpent > monthlyVariableBudget
                ? "border-amber-300 bg-amber-50/20"
                : "border-slate-200/90"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                    <PiggyBank className="w-4 h-4 text-amber-700" />
                  </div>
                  <p className="text-[11px] font-display font-bold uppercase tracking-wider text-amber-800">
                    3. Savings Stash
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                  Shock Absorber
                </span>
              </div>
              <div>
                <div className="font-display font-black tabular-nums text-2xl sm:text-[1.65rem] text-amber-700 leading-none">
                  {fmt(stashBalance)}
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-1.5">
                  Available in Stash Pool
                </p>
                <div className="mt-2 p-1.5 rounded-lg bg-slate-50 border border-slate-200/60 text-[10px] text-slate-600 leading-tight">
                  {variableSpent > monthlyVariableBudget ? (
                    <span className="text-amber-800 font-medium">
                      Absorbing <strong>{fmt(variableSpent - monthlyVariableBudget)}</strong> monthly overspend so goals stay protected ✓
                    </span>
                  ) : (
                    <span className="text-emerald-800 font-medium">
                      Weekly underspend automatically sweeps here to protect goals ✓
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between">
                  <span>Weekly Overspend Shield</span>
                  <span className="font-medium text-slate-700">Auto-balanced</span>
                </div>
              </div>
            </div>

            {/* 5. Income & Goal Allocations */}
            <div className="rounded-2xl border border-sky-200/90 bg-gradient-to-br from-sky-50/50 via-white to-white p-4 shadow-2xs flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4 text-sky-700" />
                  </div>
                  <p className="text-[11px] font-display font-bold uppercase tracking-wider text-sky-800">
                    4. Income &amp; Goals
                  </p>
                </div>
              </div>
              <div>
                <div className="font-display font-black tabular-nums text-2xl sm:text-[1.65rem] text-sky-700 leading-none">
                  {fmt(incomeTotal)}
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-1.5">
                  {expectedIncomeVal > 0 ? `Expected: ${fmt(expectedIncomeVal)}/mo` : 'Landed this month'}
                </p>
                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-medium">Pool Target:</span>
                  <span className="font-bold text-slate-800 tabular-nums">{fmt(poolSavingsMonthly)}/mo</span>
                </div>
              </div>
            </div>
          </div>

          {/* BLOCK 2: TRUE VARIABLE PACING WIDGET (Pacing Essentials + Fun Day-by-Day) */}
          {(() => {
            const isOverVariablePace = dailyVariablePace > targetDailyVariable * 1.05;
            const paceColor = isOverVariablePace ? '#DC2626' : '#16A34A';
            const paceBg = isOverVariablePace ? 'bg-rose-50/70 border-rose-200' : 'bg-emerald-50/70 border-emerald-200';

            return (
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        isOverVariablePace ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-700"
                      )}
                    >
                      <Gauge className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-display font-bold text-slate-900">
                          Daily Variable Spending Pace (Essentials + Fun)
                        </h2>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full",
                            isOverVariablePace
                              ? "border-rose-300 bg-rose-50 text-rose-700"
                              : "border-emerald-300 bg-emerald-50 text-emerald-700"
                          )}
                        >
                          {isOverVariablePace ? 'Pacing Above Target' : 'On Track'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Fixed bills ({fmt(fixedMonthly)}/mo) are separated so your daily pace only tracks controllable spending ({fmt(monthlyVariableBudget)}/mo budget).
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openBudgetDialog}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl px-3 py-1.5 hover:bg-slate-50 self-start sm:self-auto shrink-0"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit budget
                  </button>
                </div>

                {/* 4 Clear Pacing Pillars */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Pillar 1: Variable Spent So Far */}
                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/60 p-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Variable Spent ({daysElapsed}d elapsed)
                    </p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-display font-black tabular-nums text-slate-900">
                        {fmt(variableSpent)}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        of {fmt(monthlyVariableBudget)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 font-medium">
                      Averaging <strong className="text-slate-900">{fmt(dailyVariablePace)}/day</strong> (target: {fmt(targetDailyVariable)}/day)
                    </p>
                  </div>

                  {/* Pillar 2: Safe Daily Spend for Remaining Days */}
                  <div className={cn("rounded-xl border p-3.5", paceBg)}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: paceColor }}>
                      {isCurrentMonth ? `Safe to Spend (${daysRemaining}d left)` : 'Variable Remaining'}
                    </p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-display font-black tabular-nums" style={{ color: paceColor }}>
                        {isCurrentMonth && daysRemaining > 0 ? `${fmt(safeDailyRemaining)}/day` : fmt(variableRemaining)}
                      </span>
                    </div>
                    <p className="text-[11px] font-medium mt-1" style={{ color: paceColor }}>
                      {fmt(variableRemaining)} variable budget left ({fmt(Math.max(0, monthlyEssentialBudget - essentialSpent))} Ess · {fmt(Math.max(0, monthlyFunBudget - funSpent))} Fun)
                    </p>
                  </div>

                  {/* Pillar 3: Full-Month Projection (including Fixed Bills) */}
                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/60 p-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Projected Month-End Total
                    </p>
                    <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                      <span className="text-2xl font-display font-black tabular-nums text-slate-900">
                        {fmt(projectedSpend)}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        / {fmt(monthlyTotalBudget)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 font-medium">
                      {fmt(fixedMonthly)} fixed + {fmt(projectedVariableSpend)} est. variable
                    </p>
                  </div>

                  {/* Pillar 4: Expected Over / Under Budget */}
                  {(() => {
                    const overBudget = projectedDiff > 0;
                    const diffColor = overBudget ? '#DC2626' : '#16A34A';
                    const diffBg = overBudget ? 'bg-rose-50/70 border-rose-200' : 'bg-emerald-50/70 border-emerald-200';
                    return (
                      <div className={cn("rounded-xl border p-3.5", diffBg)}>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: diffColor }}>
                          {overBudget ? 'Projected Over By' : 'Projected Under By'}
                        </p>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-2xl font-display font-black tabular-nums" style={{ color: diffColor }}>
                            {fmt(Math.abs(projectedDiff))}
                          </span>
                          <span className="text-xs font-bold" style={{ color: diffColor }}>
                            {overBudget ? 'over' : 'saved'}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium mt-1" style={{ color: diffColor }}>
                          {overBudget
                            ? (daysRemaining > 0
                                ? `Cut ${fmt(projectedDiff / daysRemaining)}/day to stay on budget`
                                : `Finished ${fmt(projectedDiff)} over budget`)
                            : (daysRemaining > 0
                                ? `Saving ${fmt(Math.abs(projectedDiff))} (${fmt(Math.abs(projectedDiff) / daysRemaining)}/d buffer)`
                                : `Saved ${fmt(Math.abs(projectedDiff))} under budget`)}
                        </p>
                      </div>
                    );
                  })()}
                </div>

                {/* Single Unified Bar: Variable Budget Used vs. Calendar Time Elapsed */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">
                      Variable Budget Used: <strong className="tabular-nums">{variableUsedPct.toFixed(0)}%</strong> ({fmt(variableSpent)} of {fmt(monthlyVariableBudget)})
                    </span>
                    <span className="text-slate-500 font-medium tabular-nums">
                      Month Elapsed: <strong>{timePct.toFixed(0)}%</strong> (Day {daysElapsed}/{daysInMonth})
                    </span>
                  </div>
                  <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        isOverVariablePace ? "bg-rose-500" : "bg-emerald-500"
                      )}
                      style={{ width: `${Math.min(100, variableUsedPct)}%` }}
                    />
                    {/* Calendar marker line */}
                    {isCurrentMonth && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-900 z-10"
                        style={{ left: `${Math.min(99, timePct)}%` }}
                        title={`Today: Day ${daysElapsed} (${timePct.toFixed(0)}% of month elapsed)`}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* BLOCK 2.5: CLEAN FOCUSED HISTORICAL COMPARISON */}
          {(() => {
            const horizons = [
              historicalHorizons.lastMonth,
              historicalHorizons.last3Months,
              historicalHorizons.last6Months,
              historicalHorizons.lastYear,
            ];
            const activeH = horizons[selectedHorizonIdx] || horizons[0];

            const totalDiff = thisMonthComparisonTarget.total - activeH.total;
            const totalPct = activeH.total > 0 ? (totalDiff / activeH.total) * 100 : 0;
            const isSpendingLess = totalDiff <= 0;

            const maxBar = Math.max(thisMonthComparisonTarget.total, activeH.total, 1);
            const thisBarPct = (thisMonthComparisonTarget.total / maxBar) * 100;
            const histBarPct = (activeH.total / maxBar) * 100;

            const pillars = [
              {
                label: 'Fixed Bills',
                dot: 'bg-rose-500',
                current: thisMonthComparisonTarget.fixed,
                hist: activeH.fixed,
              },
              {
                label: 'Essentials',
                dot: 'bg-purple-600',
                current: thisMonthComparisonTarget.essential,
                hist: activeH.essential,
              },
              {
                label: 'Fun & Lifestyle',
                dot: 'bg-emerald-500',
                current: thisMonthComparisonTarget.fun,
                hist: activeH.fun,
              },
            ];

            return (
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
                {/* Header + Horizon Pill Selector */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-base font-display font-bold text-slate-900">
                      How This Month Compares to History
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Select a timeframe below to compare your {thisMonthComparisonTarget.modeLabel.toLowerCase()} ({fmt(thisMonthComparisonTarget.total)})
                    </p>
                  </div>

                  {/* 4 Clean Selectable Timeframe Pills */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-100/90 p-1 rounded-xl">
                    {horizons.map((h, idx) => {
                      const diff = thisMonthComparisonTarget.total - h.total;
                      const pct = h.total > 0 ? (diff / h.total) * 100 : 0;
                      const isSelected = selectedHorizonIdx === idx;
                      const isBetter = diff <= 0;
                      return (
                        <button
                          key={h.title}
                          type="button"
                          onClick={() => setSelectedHorizonIdx(idx)}
                          className={cn(
                            "px-3 py-2 rounded-lg text-left transition-all flex items-center justify-between gap-2",
                            isSelected
                              ? "bg-white text-slate-900 shadow-xs ring-1 ring-slate-200"
                              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                          )}
                        >
                          <span className="text-xs font-display font-bold whitespace-nowrap">
                            {h.title}
                          </span>
                          {h.total > 0 && (
                            <span
                              className={cn(
                                "text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums",
                                isBetter
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700"
                              )}
                            >
                              {pct > 0 ? `+${pct.toFixed(0)}%` : `${pct.toFixed(0)}%`}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Single Focused 2-Column Comparison View */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center pt-1">
                  {/* Left Focal Summary (5 cols) */}
                  <div className="lg:col-span-5 rounded-xl bg-slate-50/80 border border-slate-200/70 p-4 space-y-3.5">
                    <div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full",
                          isSpendingLess
                            ? "bg-emerald-100/80 text-emerald-800"
                            : "bg-rose-100/80 text-rose-800"
                        )}
                      >
                        {isSpendingLess ? '↓ Spending Less' : '↑ Spending More'} vs. {activeH.title}
                      </span>
                      <p className="text-xl sm:text-2xl font-display font-black text-slate-900 mt-2 leading-tight">
                        {fmt(Math.abs(totalDiff))} {isSpendingLess ? 'less' : 'more'}{' '}
                        <span className="text-sm font-semibold text-slate-500">
                          ({totalPct > 0 ? `+${totalPct.toFixed(0)}%` : `${totalPct.toFixed(0)}%`})
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {activeH.windowMonths === 1
                          ? `Compared to ${activeH.subtitle} actuals`
                          : `Compared to your ${activeH.title.toLowerCase()} monthly average (${activeH.activeMonthsCount} mo recorded)`}
                      </p>
                    </div>

                    {/* Clean 2-bar visual */}
                    <div className="space-y-2.5 pt-1">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-bold text-slate-800">This Month Expected</span>
                          <span className="font-display font-black tabular-nums text-[#FF2EB8]">
                            {fmt(thisMonthComparisonTarget.total)}
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-200/70 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#FF2EB8] transition-all duration-300"
                            style={{ width: `${thisBarPct}%` }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-slate-500">
                            {activeH.title} ({activeH.windowMonths === 1 ? activeH.subtitle : 'Monthly Avg'})
                          </span>
                          <span className="font-display font-bold tabular-nums text-slate-700">
                            {fmt(activeH.total)}
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-200/70 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-slate-400 transition-all duration-300"
                            style={{ width: `${histBarPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right 3 Pillar Breakdown Rows (7 cols) */}
                  <div className="lg:col-span-7 space-y-2.5">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                      <span>Where the difference comes from</span>
                      <span>This Month vs. {activeH.title}</span>
                    </div>

                    {pillars.map((p) => {
                      const diff = p.current - p.hist;
                      const pct = p.hist > 0 ? (diff / p.hist) * 100 : 0;
                      const isLess = diff <= 0;
                      return (
                        <div
                          key={p.label}
                          className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 bg-white hover:border-slate-300 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", p.dot)} />
                            <div>
                              <p className="text-xs font-bold text-slate-800">{p.label}</p>
                              <p className="text-[11px] text-slate-400 tabular-nums">
                                Was {fmt(p.hist)}/mo
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-sm font-display font-black tabular-nums text-slate-900">
                                {fmt(p.current)}
                              </span>
                            </div>
                            <span
                              className={cn(
                                "min-w-[88px] text-center text-[11px] font-bold px-2 py-1 rounded-lg tabular-nums",
                                Math.abs(pct) < 1
                                  ? "bg-slate-100 text-slate-600"
                                  : isLess
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700"
                              )}
                            >
                              {Math.abs(pct) < 1
                                ? 'Same'
                                : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} (${pct > 0 ? `+${pct.toFixed(0)}%` : `${pct.toFixed(0)}%`})`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Subtle Footer Toggle for Full All-Timeframes Table */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowFullComparisonTable(v => !v)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                  >
                    {showFullComparisonTable ? 'Hide full all-timeframes table ▴' : 'View full table across all timeframes ▾'}
                  </button>

                  {isCurrentMonth && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span>Baseline:</span>
                      <button
                        type="button"
                        onClick={() => setComparisonBaselineMode(m => m === 'projected' ? 'budget' : 'projected')}
                        className="font-semibold text-[#FF2EB8] hover:underline"
                      >
                        {comparisonBaselineMode === 'projected' ? 'Projected Pace (Switch to Budget)' : 'Planned Budget (Switch to Projected)'}
                      </button>
                    </div>
                  )}
                </div>

                {showFullComparisonTable && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200/80 mt-2">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200/80 text-[10px] font-display font-bold uppercase tracking-wider text-slate-500">
                          <th className="py-2.5 px-3.5">Pillar</th>
                          <th className="py-2.5 px-3 text-right text-[#FF2EB8] bg-pink-50/40">This Month</th>
                          <th className="py-2.5 px-3 text-right">Last Month</th>
                          <th className="py-2.5 px-3 text-right">3M Avg</th>
                          <th className="py-2.5 px-3 text-right">6M Avg</th>
                          <th className="py-2.5 px-3.5 text-right">Last Year Avg</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {[
                          { label: 'Total Spend', cur: thisMonthComparisonTarget.total, fn: (h: typeof activeH) => h.total, bold: true },
                          { label: 'Fixed Bills', cur: thisMonthComparisonTarget.fixed, fn: (h: typeof activeH) => h.fixed, bold: false },
                          { label: 'Essentials', cur: thisMonthComparisonTarget.essential, fn: (h: typeof activeH) => h.essential, bold: false },
                          { label: 'Fun & Lifestyle', cur: thisMonthComparisonTarget.fun, fn: (h: typeof activeH) => h.fun, bold: false },
                        ].map((r) => (
                          <tr key={r.label} className={r.bold ? "bg-slate-50/40 font-bold text-slate-900" : "text-slate-700"}>
                            <td className="py-2 px-3.5">{r.label}</td>
                            <td className="py-2 px-3 text-right font-bold bg-pink-50/20">{fmt(r.cur)}</td>
                            {horizons.map((h) => (
                              <td key={h.title} className="py-2 px-3 text-right">{fmt(r.fn(h))}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* BLOCK 3: UNIFIED 3-COLUMN "WHERE YOUR MONEY WENT" */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div>
                <h2 className="text-base font-display font-bold text-slate-900">
                  Where Your Money Went ({monthLabel})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Organized by your 3 spending pillars · Click any Essential or Fun category to inspect merchants
                </p>
              </div>
              {/* Proportional visual split pill */}
              {totalSpent > 0 && (
                <div className="flex items-center gap-3 text-xs font-semibold text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    Bills {Math.round((fixedSpent / totalSpent) * 100)}%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-600" />
                    Essentials {Math.round((essentialSpent / totalSpent) * 100)}%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    Fun {Math.round((funSpent / totalSpent) * 100)}%
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* COLUMN 1: FIXED BILLS CHECKLIST */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/60">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-rose-600" />
                      <span className="text-xs font-display font-bold uppercase tracking-wider text-slate-800">
                        Fixed Bills
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-display font-black tabular-nums text-slate-900">
                        {fmt(fixedSpent)}
                      </span>
                      <span className="text-[11px] text-slate-500 font-medium"> / {fmt(fixedMonthly)}</span>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {fixedBillsStatusList.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No fixed bills configured</p>
                    ) : (
                      fixedBillsStatusList.map((bill) => (
                        <div
                          key={bill.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200/60 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            {bill.isPaid ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 truncate">{bill.name}</p>
                              <p className="text-[10px] text-slate-400">
                                {bill.isPaid
                                  ? (bill.paidExternally ? 'Paid (External)' : 'Paid this month')
                                  : (bill.dueDay ? `Due day ${bill.dueDay}` : 'Upcoming this month')}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold tabular-nums text-slate-900">
                              {fmt(bill.isPaid ? bill.paidAmount : bill.committedAmount)}
                            </span>
                            <span
                              className={cn(
                                "block text-[9px] font-bold uppercase",
                                bill.isPaid ? "text-emerald-600" : "text-amber-600"
                              )}
                            >
                              {bill.isPaid ? 'Cleared' : 'Pending'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* COLUMN 2: ESSENTIALS CATEGORIES */}
              <div className="rounded-xl border border-purple-200/70 bg-purple-50/20 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-purple-200/50">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4 text-purple-700" />
                      <span className="text-xs font-display font-bold uppercase tracking-wider text-purple-900">
                        Essentials
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-display font-black tabular-nums text-purple-700">
                        {fmt(essentialSpent)}
                      </span>
                      <span className="text-[11px] text-slate-500 font-medium"> / {fmt(monthlyEssentialBudget)}</span>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {essentialCats.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No essential spending yet this month</p>
                    ) : (
                      essentialCats.map((c) => {
                        const prevCatProrated = (prevTotals.catTotals.get(c.catId) || 0) * proRateFactor;
                        const shareOfEss = monthlyEssentialBudget > 0 ? (c.total / monthlyEssentialBudget) * 100 : 0;
                        return (
                          <button
                            key={c.catId}
                            type="button"
                            onClick={() => setSelectedCategory({ catId: c.catId, name: c.name, color: c.color })}
                            className="w-full text-left p-2.5 rounded-xl bg-white border border-purple-200/60 hover:border-purple-400 hover:shadow-2xs transition-all"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                                <span className="font-semibold text-slate-800 truncate">{c.name}</span>
                              </div>
                              <span className="font-black tabular-nums text-slate-900">{fmt(c.total)}</span>
                            </div>
                            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-purple-600"
                                style={{ width: `${Math.min(100, shareOfEss)}%` }}
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                              <span>{shareOfEss.toFixed(0)}% of Essentials budget</span>
                              {prevCatProrated > 0 ? (
                                <span className="font-semibold">
                                  {trendPercent(c.total, prevCatProrated)} vs last mo
                                </span>
                              ) : (
                                <span>Tap for merchants →</span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* COLUMN 3: FUN & LIFESTYLE CATEGORIES */}
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/20 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-emerald-200/50">
                    <div className="flex items-center gap-2">
                      <PartyPopper className="w-4 h-4 text-emerald-700" />
                      <span className="text-xs font-display font-bold uppercase tracking-wider text-emerald-900">
                        Fun &amp; Lifestyle
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-display font-black tabular-nums text-emerald-700">
                        {fmt(funSpent)}
                      </span>
                      <span className="text-[11px] text-slate-500 font-medium"> / {fmt(monthlyFunBudget)}</span>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {funCats.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No fun spending yet this month</p>
                    ) : (
                      funCats.map((c) => {
                        const prevCatProrated = (prevTotals.catTotals.get(c.catId) || 0) * proRateFactor;
                        const shareOfFun = monthlyFunBudget > 0 ? (c.total / monthlyFunBudget) * 100 : 0;
                        return (
                          <button
                            key={c.catId}
                            type="button"
                            onClick={() => setSelectedCategory({ catId: c.catId, name: c.name, color: c.color })}
                            className="w-full text-left p-2.5 rounded-xl bg-white border border-emerald-200/60 hover:border-emerald-400 hover:shadow-2xs transition-all"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                                <span className="font-semibold text-slate-800 truncate">{c.name}</span>
                              </div>
                              <span className="font-black tabular-nums text-slate-900">{fmt(c.total)}</span>
                            </div>
                            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{ width: `${Math.min(100, shareOfFun)}%` }}
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                              <span>{shareOfFun.toFixed(0)}% of Fun budget</span>
                              {prevCatProrated > 0 ? (
                                <span className="font-semibold">
                                  {trendPercent(c.total, prevCatProrated)} vs last mo
                                </span>
                              ) : (
                                <span>Tap for merchants →</span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* BLOCK 4: MONTHLY SPENDING HEATMAP & HABIT TRENDS */}
          <Card className="rounded-2xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
            <CardContent className="p-5 sm:p-6 space-y-5">
              {/* Header with Title and View Switcher */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border transition-colors",
                    dailyViewMode === 'heatmap'
                      ? "bg-rose-50 border-rose-200/70 text-rose-600"
                      : "bg-purple-50 border-purple-200/70 text-purple-600"
                  )}>
                    {dailyViewMode === 'heatmap' ? (
                      <Flame className="w-5 h-5 fill-rose-500/20 text-rose-600" />
                    ) : (
                      <BarChart3 className="w-5 h-5 text-purple-600" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-display font-bold text-slate-900 flex items-center gap-2">
                      {dailyViewMode === 'heatmap' ? 'Monthly Spending Heatmap' : 'Daily Variable Spending Timeline'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {dailyViewMode === 'heatmap'
                        ? `Red intensity reflects heavier spending days · Click any day to inspect · Target: ${fmt(targetDailyVariable)}/day`
                        : `Daily variable burn by category · Click any day to inspect · Target: ${fmt(targetDailyVariable)}/day`}
                    </p>
                  </div>
                </div>

                {/* View Switcher: Heatmap vs Timeline */}
                <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-50 text-xs shrink-0 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setDailyViewMode('heatmap')}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display font-semibold transition-all",
                      dailyViewMode === 'heatmap'
                        ? "bg-white shadow-xs text-rose-600 font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    Heatmap
                  </button>
                  <button
                    type="button"
                    onClick={() => setDailyViewMode('timeline')}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display font-semibold transition-all",
                      dailyViewMode === 'timeline'
                        ? "bg-white shadow-xs text-slate-900 font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Timeline
                  </button>
                </div>
              </div>

              {dailyViewMode === 'heatmap' ? (
                /* --- VIEW 1: CALENDAR HEATMAP --- */
                <div className="space-y-4">
                  {/* Day of Week Headers (Mon - Sun) */}
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, idx) => {
                      const isWeekendCol = idx === 5 || idx === 6;
                      return (
                        <div
                          key={d}
                          className={cn(
                            "text-xs font-display font-bold py-1 rounded-md",
                            isWeekendCol ? "text-rose-600 bg-rose-50/60" : "text-slate-500"
                          )}
                        >
                          {d}
                        </div>
                      );
                    })}
                  </div>

                  {/* Calendar Matrix with Red Heat Intensity */}
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                    {/* Empty padding cells for days prior to 1st of month */}
                    {Array.from({ length: heatmapData.firstDayWeekday }).map((_, idx) => (
                      <div
                        key={`empty-${idx}`}
                        className="rounded-xl sm:rounded-2xl min-h-[64px] sm:min-h-[80px] bg-slate-50/40 border border-dashed border-slate-200/50"
                      />
                    ))}

                    {/* Active Days */}
                    {heatmapData.days.map((day) => {
                      const heatLevel = heatmapData.getHeatLevel(day.total);
                      const isToday = monthStart.getMonth() === new Date().getMonth() &&
                        monthStart.getFullYear() === new Date().getFullYear() &&
                        day.dayNum === new Date().getDate();
                      const isSelected = selectedDayNum === day.dayNum;
                      const isTopSpike = heatmapData.topSpikeDayNums.has(day.dayNum) && day.total > 0;

                      return (
                        <div
                          key={day.dayNum}
                          onClick={() => setSelectedDayNum(day.dayNum)}
                          className={cn(
                            "relative rounded-xl sm:rounded-2xl p-2 sm:p-2.5 min-h-[66px] sm:min-h-[82px] flex flex-col justify-between transition-all cursor-pointer group border select-none",
                            // Heat Color Mapping
                            heatLevel === 0 && "bg-slate-50/80 border-slate-200/70 text-slate-500 hover:bg-slate-100 hover:border-slate-300",
                            heatLevel === 1 && "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100 hover:border-rose-300 shadow-2xs",
                            heatLevel === 2 && "bg-rose-100/90 border-rose-300 text-rose-950 hover:bg-rose-200 hover:border-rose-400 shadow-xs",
                            heatLevel === 3 && "bg-rose-300 border-rose-400 text-rose-950 font-medium hover:bg-rose-400 hover:border-rose-500 shadow-xs",
                            heatLevel === 4 && "bg-rose-500 border-rose-600 text-white font-bold hover:bg-rose-600 hover:border-rose-700 shadow-xs",
                            heatLevel === 5 && "bg-red-600 border-red-700 text-white font-black hover:bg-red-700 shadow-sm ring-2 ring-red-400/70",
                            // Selected or Today Highlights
                            isSelected && "ring-2 ring-[#FF2EB8] shadow-md scale-[1.02] z-10",
                            isToday && !isSelected && "ring-2 ring-purple-500/80"
                          )}
                          title={`${format(day.date, 'EEEE, d MMMM')}: ${fmt(day.total)}${day.txCount > 0 ? ` (${day.txCount} txs)` : ''}${day.topMerchant ? ` · Largest: ${day.topMerchant}` : ''}`}
                        >
                          {/* Day Header */}
                          <div className="flex items-center justify-between">
                            <span className={cn(
                              "text-xs sm:text-sm font-display font-bold leading-none",
                              heatLevel >= 4 ? "text-white" : heatLevel >= 2 ? "text-rose-950" : "text-slate-700",
                              isToday && "text-purple-600 font-black"
                            )}>
                              {day.dayNum}
                            </span>
                            <div className="flex items-center gap-0.5">
                              {isTopSpike && (
                                <span
                                  className={cn(
                                    "text-[9px] font-bold px-1 py-0.2 rounded-sm flex items-center gap-0.5",
                                    heatLevel >= 4 ? "bg-white/20 text-white" : "bg-red-100 text-red-700"
                                  )}
                                  title="Top 3 spending spike this month"
                                >
                                  <Flame className="w-2.5 h-2.5 fill-current" />
                                </span>
                              )}
                              {isToday && (
                                <span className="text-[8px] uppercase tracking-wider font-extrabold px-1 rounded bg-[#FF2EB8] text-white">
                                  Today
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Day Spend & Count */}
                          <div className="mt-1">
                            <div className={cn(
                              "text-xs sm:text-sm font-display font-black tabular-nums leading-tight truncate",
                              heatLevel >= 4 ? "text-white" : heatLevel >= 1 ? "text-rose-950" : "text-slate-400 font-medium"
                            )}>
                              {day.total > 0 ? fmt(day.total) : '£0'}
                            </div>
                            <div className={cn(
                              "text-[9px] sm:text-[10px] truncate leading-none mt-0.5",
                              heatLevel >= 4 ? "text-rose-100" : "text-slate-500"
                            )}>
                              {day.txCount > 0 ? `${day.txCount} tx${day.txCount > 1 ? 's' : ''}` : 'No spend'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Heat Scale Legend */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
                    <span className="text-slate-500 font-medium flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5 text-rose-500" />
                      Spending Heat Scale:
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1">
                        <div className="w-3.5 h-3.5 rounded bg-slate-50 border border-slate-200" />
                        <span className="text-[11px] text-slate-500">£0 No Spend</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3.5 h-3.5 rounded bg-rose-50 border border-rose-200" />
                        <span className="text-[11px] text-slate-600">Light</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3.5 h-3.5 rounded bg-rose-100 border border-rose-300" />
                        <span className="text-[11px] text-slate-600">Moderate</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3.5 h-3.5 rounded bg-rose-300 border border-rose-400" />
                        <span className="text-[11px] text-slate-700">High</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3.5 h-3.5 rounded bg-rose-500 border border-rose-600" />
                        <span className="text-[11px] text-rose-700 font-semibold">Heavy</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3.5 h-3.5 rounded bg-red-600 border border-red-700 text-white flex items-center justify-center text-[8px] font-black">🔥</div>
                        <span className="text-[11px] text-red-700 font-bold">Peak Spike</span>
                      </div>
                    </div>
                  </div>

                  {/* HABITS & TRENDS INSIGHT CARDS */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                    {/* 1. Top 3 Spikes */}
                    <div className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-200/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-display font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1">
                          <Flame className="w-3.5 h-3.5 text-red-500" />
                          Top Spending Spikes
                        </span>
                        <span className="text-[10px] text-rose-600 font-medium">Click to inspect</span>
                      </div>
                      <div className="space-y-1.5">
                        {heatmapData.topSpikes.length === 0 ? (
                          <p className="text-xs text-slate-500">No variable spending recorded.</p>
                        ) : (
                          heatmapData.topSpikes.map((spike, idx) => (
                            <button
                              key={spike.dayNum}
                              type="button"
                              onClick={() => setSelectedDayNum(spike.dayNum)}
                              className="w-full flex items-center justify-between text-left p-1.5 rounded-lg hover:bg-white/80 transition-colors text-xs"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="w-4 h-4 rounded-full bg-rose-200 text-rose-800 text-[10px] font-bold flex items-center justify-center shrink-0">
                                  {idx + 1}
                                </span>
                                <span className="font-semibold text-slate-800 truncate">
                                  {format(spike.date, 'EEE, d MMM')}
                                </span>
                                {spike.topMerchant && (
                                  <span className="text-[10px] text-slate-500 truncate max-w-[80px]">
                                    ({spike.topMerchant})
                                  </span>
                                )}
                              </div>
                              <span className="font-black text-rose-950 tabular-nums shrink-0 ml-1">
                                {fmt(spike.total)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    {/* 2. Weekend vs Weekday Habit */}
                    <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200/70 space-y-2">
                      <span className="text-[11px] font-display font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-amber-600" />
                        Weekend vs Weekday
                      </span>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-600">Weekend Avg:</span>
                          <span className="font-bold text-slate-900 tabular-nums">{fmt(heatmapData.weekendAvg)}/day</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-600">Weekday Avg:</span>
                          <span className="font-bold text-slate-900 tabular-nums">{fmt(heatmapData.weekdayAvg)}/day</span>
                        </div>
                      </div>
                      <div className="text-[11px] font-medium text-amber-900 bg-white/70 rounded-lg p-1.5 border border-amber-200/60 leading-tight">
                        {heatmapData.weekendMultiplier > 1.25 ? (
                          <>Weekends are <strong className="font-bold text-amber-950">{heatmapData.weekendMultiplier.toFixed(1)}× higher</strong> burn than weekdays.</>
                        ) : heatmapData.weekendMultiplier > 0.8 ? (
                          <>Spending is <strong className="font-bold text-amber-950">balanced</strong> evenly across the week.</>
                        ) : (
                          <>Weekdays are higher burn than weekends this month.</>
                        )}
                      </div>
                    </div>

                    {/* 3. Peak Day of Week */}
                    <div className="p-3.5 rounded-2xl bg-purple-50/60 border border-purple-200/70 space-y-2">
                      <span className="text-[11px] font-display font-bold uppercase tracking-wider text-purple-800 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                        Peak Day of Week
                      </span>
                      <div>
                        <p className="text-base font-display font-black text-purple-950">
                          {heatmapData.peakDayOfWeek?.name || 'None'}
                        </p>
                        <p className="text-xs text-purple-900/80 mt-0.5">
                          {heatmapData.peakDayOfWeek && heatmapData.peakDayOfWeek.total > 0 ? (
                            <>
                              <strong className="font-bold">{fmt(heatmapData.peakDayOfWeek.total)}</strong> total ({fmt(heatmapData.peakDayOfWeek.avg)}/day avg)
                            </>
                          ) : (
                            'No spend recorded yet'
                          )}
                        </p>
                      </div>
                      <p className="text-[10px] text-purple-700/80 pt-1 border-t border-purple-100">
                        {heatmapData.peakDayOfWeek && heatmapData.totalVariableSpent > 0 ? (
                          `${Math.round((heatmapData.peakDayOfWeek.total / heatmapData.totalVariableSpent) * 100)}% of your variable spending hits on ${heatmapData.peakDayOfWeek.shortName}s.`
                        ) : ''}
                      </p>
                    </div>

                    {/* 4. No-Spend Days Tracked */}
                    <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-200/70 space-y-2">
                      <span className="text-[11px] font-display font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        No-Spend Days
                      </span>
                      <div>
                        <p className="text-2xl font-display font-black text-emerald-950 tabular-nums">
                          {heatmapData.noSpendDaysCount} <span className="text-xs font-semibold text-emerald-700">days</span>
                        </p>
                        <p className="text-xs text-emerald-800 font-medium mt-0.5">
                          {heatmapData.noSpendPct}% of the month had £0 variable spend
                        </p>
                      </div>
                      <div className="h-1.5 rounded-full bg-emerald-200/60 overflow-hidden w-full">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, heatmapData.noSpendPct)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* --- VIEW 2: STACKED BAR TIMELINE --- */
                <div className="space-y-4">
                  {/* Legend & Target Indicator */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 text-slate-500">
                      <span>
                        Daily Target: <strong className="text-slate-800">{fmt(targetDailyVariable)}/day</strong>
                      </span>
                      <span className="text-[11px] text-slate-400 sm:hidden">· Swipe to view full month →</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-xs bg-purple-600 shadow-2xs" />
                        <span className="text-slate-700 font-medium">Essentials</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-xs bg-emerald-500 shadow-2xs" />
                        <span className="text-slate-700 font-medium">Fun Money</span>
                      </div>
                      {targetDailyVariable > 0 && (
                        <div className="flex items-center gap-1.5">
                          <div className="w-3.5 border-b-2 border-dashed border-amber-500" />
                          <span className="text-amber-800 font-medium">Target Avg</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Horizontal Scroll Wrapper - guarantees timeline never cuts off */}
                  <div className="relative pt-3 pb-1 overflow-x-auto touch-scroll">
                    <div className="min-w-[680px] w-full">
                      <TooltipProvider delayDuration={50}>
                        {/* Bars Area with Target Benchmark Line */}
                        <div className="relative h-40 flex items-end justify-between gap-1 px-1">
                          {/* Target guideline across chart */}
                          {targetDailyVariable > 0 && maxDaily > 0 && (
                            <div
                              className="absolute left-0 right-0 border-b border-dashed border-amber-400/90 pointer-events-none z-10 flex items-center"
                              style={{
                                bottom: `${Math.min(Math.max((targetDailyVariable / maxDaily) * 100, 4), 95)}%`,
                              }}
                            >
                              <span className="text-[9px] font-bold text-amber-800 bg-amber-50/95 border border-amber-300/80 px-1.5 py-0.2 rounded-sm ml-1 shadow-2xs">
                                Target {fmt(targetDailyVariable)}/d
                              </span>
                            </div>
                          )}

                          {dailyData.map((day, i) => {
                            const dayNum = i + 1;
                            const total = day.essential + day.fun;
                            const essH = total > 0 ? (day.essential / maxDaily) * 100 : 0;
                            const funH = total > 0 ? (day.fun / maxDaily) * 100 : 0;
                            const isToday = monthStart.getMonth() === new Date().getMonth() &&
                              monthStart.getFullYear() === new Date().getFullYear() &&
                              dayNum === new Date().getDate();
                            const isSelected = selectedDayNum === dayNum;
                            const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNum);
                            const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;

                            return (
                              <Tooltip key={dayNum}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedDayNum(dayNum)}
                                    className={cn(
                                      "flex-1 flex flex-col items-center justify-end h-full group relative focus:outline-none transition-all rounded-md py-1 cursor-pointer",
                                      isSelected
                                        ? "bg-pink-50 ring-1.5 ring-[#FF2EB8]"
                                        : "hover:bg-slate-50"
                                    )}
                                    aria-label={`View transactions for ${format(dayDate, 'MMM d')}`}
                                  >
                                    {/* Uniform fixed-width bar track (eliminates thickness differences) */}
                                    <div className="w-2.5 sm:w-3 h-full rounded-t-sm bg-slate-100/90 flex flex-col justify-end overflow-hidden group-hover:bg-slate-200/70 transition-colors">
                                      {funH > 0 && (
                                        <div
                                          className="w-full bg-emerald-500 transition-all duration-200 group-hover:brightness-110"
                                          style={{ height: `${funH}%`, minHeight: 2 }}
                                        />
                                      )}
                                      {essH > 0 && (
                                        <div
                                          className="w-full bg-purple-600 transition-all duration-200 group-hover:brightness-110"
                                          style={{ height: `${essH}%`, minHeight: 2 }}
                                        />
                                      )}
                                    </div>
                                  </button>
                                </TooltipTrigger>

                                <TooltipContent
                                  side="top"
                                  sideOffset={8}
                                  className="bg-slate-900 text-white text-xs p-3 shadow-xl border-slate-800 rounded-xl z-50 pointer-events-none min-w-[170px]"
                                >
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1.5">
                                      <span className="font-bold text-slate-200">{format(dayDate, 'EEE, d MMMM')}</span>
                                      {isToday && (
                                        <span className="text-[9px] font-black text-[#FF2EB8] uppercase tracking-wider bg-pink-950/60 px-1 py-0.5 rounded">
                                          Today
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-baseline justify-between pt-0.5">
                                      <span className="text-slate-400 text-[11px]">Total Spent:</span>
                                      <span className="text-base font-black text-white tabular-nums">
                                        {fmt(total)}
                                      </span>
                                    </div>

                                    <div className="text-[11px] space-y-1 text-slate-300 pt-1 border-t border-slate-800/80">
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-purple-300 flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-xs bg-purple-500 inline-block" />
                                          Essentials:
                                        </span>
                                        <span className="font-semibold tabular-nums">{fmt(day.essential)}</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-emerald-300 flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block" />
                                          Fun Money:
                                        </span>
                                        <span className="font-semibold tabular-nums">{fmt(day.fun)}</span>
                                      </div>
                                    </div>

                                    {targetDailyVariable > 0 && (
                                      <div className="text-[10px] pt-1.5 border-t border-slate-800 text-slate-400">
                                        {total > targetDailyVariable ? (
                                          <span className="text-rose-400 font-semibold flex items-center justify-between">
                                            <span>Above target:</span>
                                            <span className="tabular-nums">+{fmt(total - targetDailyVariable)}</span>
                                          </span>
                                        ) : total > 0 ? (
                                          <span className="text-emerald-400 font-semibold flex items-center justify-between">
                                            <span>Under target:</span>
                                            <span className="tabular-nums">-{fmt(targetDailyVariable - total)}</span>
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 italic">£0 spend · zero burn day</span>
                                        )}
                                      </div>
                                    )}

                                    <div className="text-[10px] text-slate-400/90 pt-1 text-center italic border-t border-slate-800/60">
                                      Click bar to open transaction list
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>

                        {/* Baseline Day Numbers Row */}
                        <div className="flex items-center justify-between gap-1 px-1 mt-1.5 border-t border-slate-100 pt-1.5">
                          {dailyData.map((_, i) => {
                            const dayNum = i + 1;
                            const isToday = monthStart.getMonth() === new Date().getMonth() &&
                              monthStart.getFullYear() === new Date().getFullYear() &&
                              dayNum === new Date().getDate();
                            const isSelected = selectedDayNum === dayNum;
                            const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNum);
                            const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;

                            return (
                              <button
                                key={dayNum}
                                type="button"
                                onClick={() => setSelectedDayNum(dayNum)}
                                className="flex-1 flex justify-center cursor-pointer py-0.5 focus:outline-none"
                                aria-label={`Select day ${dayNum}`}
                              >
                                <span className={cn(
                                  "text-[9px] sm:text-[10px] tabular-nums font-medium transition-colors leading-none py-1 px-1 rounded-sm",
                                  isSelected && "bg-[#FF2EB8] text-white font-bold shadow-2xs",
                                  isToday && !isSelected && "text-[#FF2EB8] font-black ring-1 ring-[#FF2EB8]/40",
                                  !isSelected && !isToday && (isWeekend ? "text-slate-600 font-semibold" : "text-slate-400")
                                )}>
                                  {dayNum}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 2: CASH FLOW ENGINE & PEER BENCHMARKS                 */}
        {/* ========================================================= */}
        <TabsContent value="breakdown" className="mt-5 space-y-6 focus-visible:outline-none">
          <MonthlyCashFlowBreakdown
            income={incomeTotal}
            expectedIncome={expectedIncomeVal}
            fixedBills={fixedMonthly}
            essentialBudget={monthlyEssentialBudget}
            essentialSpent={essentialSpent}
            poolSavings={poolSavingsMonthly}
            funSpent={funSpent}
            baseCurrency={baseCurrency}
            monthLabel={monthLabel}
            defaultViewMode="weekly"
          />

          {/* Monthly Financial Peer Benchmark Model Widget (Now cleanly inside Tab 2) */}
          <div className="bg-white rounded-[2rem] p-6 sm:p-7 border-2 border-[#FF7AD1]/40 shadow-sm relative overflow-hidden space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF2EB8] to-[#FF7AD1] flex items-center justify-center text-white shadow-md shrink-0">
                  <Award className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-black text-xl text-slate-900">23yo Monthly Financial Model</h3>
                    <Badge variant="outline" className="bg-[#FFF5FA] border-[#FF7AD1]/40 text-[#FF2EB8] font-display font-bold px-2.5 py-0.5 rounded-full text-[11px] flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#FF2EB8]" /> Manchester, UK · 🦘 Full-Time Workers (Excl. Students)
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Benchmarking your monthly spending ({fmt(totalSpent)}) and net profit ({fmt(netProfit)}) against UK &amp; Australian 23yo peers.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl shrink-0 overflow-x-auto">
                {MONTHLY_PEER_BENCHMARKS.map(b => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBenchmarkId(b.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-display font-bold whitespace-nowrap transition-all ${
                      selectedBenchmarkId === b.id
                        ? 'bg-[#FF2EB8] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white rounded-xl border border-emerald-100 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] font-display font-bold uppercase tracking-wider text-slate-400">Income Status</p>
                  <p className="text-xs font-display font-extrabold text-emerald-700">
                    {incomeDiffPct >= 0 ? `+${incomeDiffPct.toFixed(0)}% Above Average` : `${Math.abs(incomeDiffPct).toFixed(0)}% Below Average`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white rounded-xl border border-sky-100 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sky-700 font-bold shrink-0">
                  <TrendingDown className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] font-display font-bold uppercase tracking-wider text-slate-400">Spending Status</p>
                  <p className="text-xs font-display font-extrabold text-sky-800">
                    {spendingDiffPct <= 0
                      ? `${Math.abs(spendingDiffPct).toFixed(0)}% Leaner (Below Avg)`
                      : `+${spendingDiffPct.toFixed(0)}% Above Avg spending`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white rounded-xl border border-pink-100 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-pink-100 flex items-center justify-center text-[#FF2EB8] font-bold shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] font-display font-bold uppercase tracking-wider text-slate-400">Overall Peer Standing</p>
                  <p className="text-xs font-display font-extrabold text-[#FF2EB8]">
                    {percentileLabel} ({netProfitDiffPct >= 0 ? `+${netProfitDiffPct.toFixed(0)}%` : `${netProfitDiffPct.toFixed(0)}%`} Surplus)
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-[#FFF5FA] to-white rounded-2xl p-5 border border-[#FF7AD1]/30 flex flex-col justify-between">
                <div className="flex items-center justify-between text-[#FF2EB8] text-xs font-display font-bold uppercase tracking-wider mb-2">
                  <span>Net Monthly Profit</span>
                  <PiggyBank className="w-4 h-4 text-[#FF2EB8]" />
                </div>
                <div>
                  <div className={`text-3xl sm:text-4xl font-display font-black tabular-nums ${netProfit >= 0 ? 'text-slate-900' : 'text-rose-600'}`}>
                    {netProfit >= 0 ? '+' : ''}{fmt(netProfit)}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-semibold flex items-center gap-1">
                    <Percent className="w-3 h-3 text-[#FF2EB8]" /> {savingsRate.toFixed(0)}% Savings Rate · {netProfitDiffPct >= 0 ? `+${netProfitDiffPct.toFixed(0)}%` : `${netProfitDiffPct.toFixed(0)}%`} vs peer avg
                  </p>
                </div>
              </div>

              <div className="bg-emerald-50/60 rounded-2xl p-5 border border-emerald-200/80 flex flex-col justify-between">
                <div className="flex items-center justify-between text-[#166534] text-xs font-display font-bold uppercase tracking-wider mb-2">
                  <span>Monthly Expenses</span>
                  <TrendingDown className="w-4 h-4 text-[#22C55E]" />
                </div>
                <div>
                  <div className="text-3xl sm:text-4xl font-display font-black text-[#166534] tabular-nums">
                    {fmt(totalSpent)}
                  </div>
                  <p className="text-xs text-[#166534]/80 mt-1 font-semibold">
                    {spendingDiffPct <= 0
                      ? `${Math.abs(spendingDiffPct).toFixed(0)}% lower spending than`
                      : `${spendingDiffPct.toFixed(0)}% higher than`} {selectedBenchmark.label} ({fmt(selectedBenchmark.monthlyExpenses)}/mo)
                  </p>
                </div>
              </div>

              <div className="bg-sky-50/60 rounded-2xl p-5 border border-sky-200/80 flex flex-col justify-between">
                <div className="flex items-center justify-between text-sky-800 text-xs font-display font-bold uppercase tracking-wider mb-2">
                  <span>Annual Wealth Pacing</span>
                  <BarChart3 className="w-4 h-4 text-[#0284C7]" />
                </div>
                <div>
                  <div className="text-3xl sm:text-4xl font-display font-black text-slate-900 tabular-nums">
                    {fmt(annualizedNetProfit)}<span className="text-sm font-normal text-slate-500">/yr net</span>
                  </div>
                  <p className="text-xs text-sky-900/80 mt-1 font-semibold">
                    vs {fmt(selectedBenchmark.annualProfit)}/yr avg peer net savings pacing
                  </p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Budget Dialog */}
      <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Monthly budget</DialogTitle>
            <DialogDescription className="space-y-2">
              <span>Your auto monthly budget of <strong>{fmt(autoTotalBudget)}</strong> is calculated from:</span>
              <span className="block text-xs space-y-1 text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="block">• Fixed Bills: <strong>{fmt(fixedMonthly)}</strong>/mo</span>
                <span className="block">• Essentials Variable: <strong>{fmt(monthlyEssentialBudget)}</strong>/mo ({fmt(snapshot?.weeklyEssentialBudget || 0)}/wk × 4.33)</span>
                <span className="block">• Fun Money: <strong>{fmt(monthlyFunBudget)}</strong>/mo ({fmt(snapshot?.baseWeeklyFun || 0)}/wk × 4.33)</span>
              </span>
              <span>Enter a custom amount to override this, or click "Reset to auto".</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number"
              inputMode="decimal"
              placeholder={`e.g. ${Math.round(autoTotalBudget)}`}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="text-lg font-semibold"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setBudgetInput(''); }}>Reset to auto</Button>
              <Button onClick={saveBudget}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Category Merchant Breakdown Dialog */}
      <Dialog open={!!selectedCategory} onOpenChange={() => setSelectedCategory(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCategory && (
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedCategory.color }} />
              )}
              {selectedCategory?.name} · Merchants
            </DialogTitle>
            <DialogDescription>
              Total spent in {monthLabel}: {selectedCategory ? fmt(variableCategoryBreakdown.find(c => c.catId === selectedCategory.catId)?.total || 0) : fmt(0)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] -mr-4 pr-4">
            <div className="space-y-1.5">
              {categoryMerchantBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching transactions this month.</p>
              ) : (
                categoryMerchantBreakdown.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-slate-50 border border-slate-100"
                  >
                    <div className="min-w-0 pr-4">
                      <span className="text-sm font-semibold text-slate-900 truncate block">{item.name}</span>
                      <span className="text-[10px] text-slate-400">{item.count} {item.count === 1 ? 'transaction' : 'transactions'}</span>
                    </div>
                    <span className="text-sm font-black tabular-nums whitespace-nowrap text-slate-900">{fmt(item.total)}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Monthly Day Transactions Dialog */}
      <Dialog open={selectedDayNum !== null} onOpenChange={(open) => { if (!open) setSelectedDayNum(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-4">
              <span className="flex items-center gap-2 text-base font-bold">
                {selectedMonthlyDayDate && format(selectedMonthlyDayDate, 'EEEE, d MMMM yyyy')}
              </span>
              <Badge variant="secondary" className="font-bold font-mono text-xs px-2.5 py-0.5">
                {fmt(selectedMonthlyDayTotal)}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selectedMonthlyDayTxns.length === 0
                ? 'No variable spending transactions recorded on this day.'
                : `${selectedMonthlyDayTxns.length} transaction${selectedMonthlyDayTxns.length > 1 ? 's' : ''}`}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] -mr-4 pr-4">
            <div className="space-y-2 py-2">
              {selectedMonthlyDayTxns.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  No spending recorded for this day.
                </div>
              ) : (
                selectedMonthlyDayTxns.map((tx) => {
                  const cat = catMap.get(tx.category_id || '');
                  const isEssential = essentialCatIds.has(tx.category_id || '');
                  const amt = Math.abs(baseAmt(tx));
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-200 transition-colors"
                    >
                      <div className="flex flex-col gap-1 min-w-0 pr-3">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {tx.merchant || tx.description || 'Expense'}
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap text-[11px] mt-0.5">
                          <Select
                            value={tx.category_id || '__uncategorised'}
                            onValueChange={async (newCatId) => {
                              const targetCatId = newCatId === '__uncategorised' ? null : newCatId;
                              await finance.updateTransaction(tx.id, { category_id: targetCatId } as any);
                              toast.success('Category updated');
                            }}
                          >
                            <SelectTrigger className="h-6.5 text-[11px] border border-slate-200 bg-white shadow-none px-2 rounded-lg gap-1 focus:ring-1">
                              <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                                {cat ? (
                                  <>
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color || '#888' }} />
                                    <span className="truncate font-medium text-slate-700">{cat.name}</span>
                                  </>
                                ) : (
                                  <span className="text-slate-400 font-medium">Uncategorised</span>
                                )}
                              </div>
                            </SelectTrigger>
                            <SelectContent className="max-h-56 z-[100]">
                              <SelectItem value="__uncategorised">
                                <span className="text-slate-400 font-medium">Uncategorised</span>
                              </SelectItem>
                              {finance.categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || '#888' }} />
                                    <span className="font-medium">{c.name}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full font-bold text-[10px] uppercase ${
                              isEssential ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {isEssential ? 'Essential' : 'Fun'}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold tabular-nums text-slate-900">
                          {fmt(amt)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
