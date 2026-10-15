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
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses, FREQ_TO_MONTHLY } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot, computeRequiredGoalSavingsMonthly } from '@/lib/policyEngine';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import MonthlyCashFlowBreakdown from '@/components/finance/MonthlyCashFlowBreakdown';
import {
  startOfMonth, endOfMonth, subMonths, addMonths, format,
  getDaysInMonth, getDate,
} from 'date-fns';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ChevronLeft, ChevronRight, ShoppingCart, PartyPopper,
  Lock, TrendingUp, TrendingDown, Minus, DollarSign,
  Pencil, Gauge, LayoutGrid, Sparkles,
  Award, MapPin, BarChart3, PiggyBank, Percent, CheckCircle2, Clock,
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

  // Filter transactions for selected month
  const monthTxns = useMemo(() => {
    return finance.transactions.filter(tx => {
      if (tx.is_reimbursable) return false;
      const d = parseUkDate(tx.posted_at);
      return d >= monthStart && d <= monthEnd;
    });
  }, [finance.transactions, monthStart, monthEnd]);

  // Previous month transactions for comparison
  const prevMonthStart = startOfMonth(subMonths(selectedMonth, 1));
  const prevMonthEnd = endOfMonth(subMonths(selectedMonth, 1));
  const prevMonthTxns = useMemo(() => {
    return finance.transactions.filter(tx => {
      if (tx.is_reimbursable) return false;
      const d = parseUkDate(tx.posted_at);
      return d >= prevMonthStart && d <= prevMonthEnd;
    });
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
    <div className="space-y-6 w-full font-body -mx-4 sm:-mx-6 -mt-6 px-4 sm:px-6 pt-6 pb-24 min-h-screen bg-[#FFF5FA]">
      {/* Header with month selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Monthly Overview</h1>
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

            {/* 3. Essentials Variable */}
            <div className={cn(
              "rounded-2xl border bg-white p-4 shadow-2xs flex flex-col justify-between gap-2",
              essentialSpent > monthlyEssentialBudget ? "border-rose-300 bg-rose-50/20" : "border-slate-200/90"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                    <ShoppingCart className="w-4 h-4 text-purple-700" />
                  </div>
                  <p className="text-[11px] font-display font-bold uppercase tracking-wider text-purple-800">
                    2. Essentials
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                  {monthlyEssentialBudget > 0 ? `${Math.round((essentialSpent / monthlyEssentialBudget) * 100)}%` : '0%'}
                </span>
              </div>
              <div>
                <div className="font-display font-black tabular-nums text-2xl sm:text-[1.65rem] text-purple-700 leading-none">
                  {fmt(essentialSpent)}
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-1.5">
                  of {fmt(monthlyEssentialBudget)} budget
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", essentialSpent > monthlyEssentialBudget ? "bg-rose-500" : "bg-purple-600")}
                    style={{ width: `${Math.min(100, monthlyEssentialBudget > 0 ? (essentialSpent / monthlyEssentialBudget) * 100 : 0)}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-between">
                  <span>
                    {essentialSpent <= monthlyEssentialBudget
                      ? `${fmt(monthlyEssentialBudget - essentialSpent)} left`
                      : `${fmt(essentialSpent - monthlyEssentialBudget)} over`}
                  </span>
                  <span className="flex items-center gap-0.5">
                    {trendIcon(essentialSpent, prevTotalsProrated.essential)}
                    {trendPercent(essentialSpent, prevTotalsProrated.essential)}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. Fun & Lifestyle */}
            <div className={cn(
              "rounded-2xl border bg-white p-4 shadow-2xs flex flex-col justify-between gap-2",
              funSpent > monthlyFunBudget ? "border-rose-300 bg-rose-50/20" : "border-slate-200/90"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <PartyPopper className="w-4 h-4 text-emerald-700" />
                  </div>
                  <p className="text-[11px] font-display font-bold uppercase tracking-wider text-emerald-800">
                    3. Fun Money
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                  {monthlyFunBudget > 0 ? `${Math.round((funSpent / monthlyFunBudget) * 100)}%` : '0%'}
                </span>
              </div>
              <div>
                <div className="font-display font-black tabular-nums text-2xl sm:text-[1.65rem] text-emerald-600 leading-none">
                  {fmt(funSpent)}
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-1.5">
                  of {fmt(monthlyFunBudget)} budget
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", funSpent > monthlyFunBudget ? "bg-rose-500" : "bg-emerald-500")}
                    style={{ width: `${Math.min(100, monthlyFunBudget > 0 ? (funSpent / monthlyFunBudget) * 100 : 0)}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-between">
                  <span>
                    {funSpent <= monthlyFunBudget
                      ? `${fmt(monthlyFunBudget - funSpent)} left`
                      : `${fmt(funSpent - monthlyFunBudget)} over`}
                  </span>
                  <span className="flex items-center gap-0.5">
                    {trendIcon(funSpent, prevTotalsProrated.fun)}
                    {trendPercent(funSpent, prevTotalsProrated.fun)}
                  </span>
                </div>
              </div>
            </div>

            {/* 5. Income & Pool Savings */}
            <div className="rounded-2xl border border-sky-200/90 bg-gradient-to-br from-sky-50/50 via-white to-white p-4 shadow-2xs flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4 text-sky-700" />
                  </div>
                  <p className="text-[11px] font-display font-bold uppercase tracking-wider text-sky-800">
                    Income &amp; Savings
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

                {/* 3 Clear Pacing Pillars */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-display font-black tabular-nums text-slate-900">
                        {fmt(projectedSpend)}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        / {fmt(monthlyTotalBudget)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">
                      {projectedDiff > 1
                        ? `On pace to finish ${fmt(projectedDiff)} over budget`
                        : projectedDiff < -1
                          ? `On pace to finish ${fmt(Math.abs(projectedDiff))} under budget`
                          : `Right on your ${fmt(monthlyTotalBudget)} monthly budget`}
                    </p>
                  </div>
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

          {/* BLOCK 4: DAILY VARIABLE SPENDING TIMELINE */}
          <Card className="rounded-2xl border border-slate-200/90 bg-white shadow-xs">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <p className="text-sm font-display font-bold text-slate-900">Daily Variable Spending Timeline</p>
                  <p className="text-xs text-slate-500">
                    Click any day to inspect or recategorise transactions · Daily target average: <strong>{fmt(targetDailyVariable)}/day</strong>
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-purple-600" />
                    <span className="text-slate-600 font-medium">Essentials</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-slate-600 font-medium">Fun Money</span>
                  </div>
                </div>
              </div>

              <div className="flex items-end gap-px h-36 pt-4">
                {dailyData.map((day, i) => {
                  const total = day.essential + day.fun;
                  const essH = total > 0 ? (day.essential / maxDaily) * 100 : 0;
                  const funH = total > 0 ? (day.fun / maxDaily) * 100 : 0;
                  const isToday = monthStart.getMonth() === new Date().getMonth() &&
                    monthStart.getFullYear() === new Date().getFullYear() &&
                    i + 1 === new Date().getDate();
                  const isSelected = selectedDayNum === i + 1;
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedDayNum(i + 1)}
                      className={cn(
                        "flex-1 flex flex-col items-center justify-end h-full group relative cursor-pointer hover:bg-slate-100/80 rounded-sm p-0.5 transition-all",
                        isSelected && "bg-pink-50 ring-1 ring-[#FF2EB8]"
                      )}
                      title={`Click to view transactions for ${format(monthStart, 'MMM')} ${i + 1}`}
                    >
                      {total > 0 && (
                        <div className="absolute -top-7 bg-slate-900 text-white rounded px-1.5 py-0.5 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap shadow-xs">
                          {fmt(total)}
                        </div>
                      )}
                      <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                        {funH > 0 && (
                          <div
                            className="w-full rounded-t-sm bg-emerald-500 group-hover:brightness-110"
                            style={{ height: `${funH}%`, minHeight: funH > 0 ? 2 : 0 }}
                          />
                        )}
                        {essH > 0 && (
                          <div
                            className="w-full bg-purple-600 group-hover:brightness-110"
                            style={{
                              height: `${essH}%`,
                              minHeight: essH > 0 ? 2 : 0,
                              borderRadius: funH > 0 ? 0 : '2px 2px 0 0',
                            }}
                          />
                        )}
                      </div>
                      <span className={cn(
                        "text-[9px] mt-1 tabular-nums",
                        isToday ? "font-black text-[#FF2EB8]" : "text-slate-400"
                      )}>
                        {i + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
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
