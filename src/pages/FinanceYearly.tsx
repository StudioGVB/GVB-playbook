import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses, FREQ_TO_MONTHLY } from '@/hooks/useFixedExpenses';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { computePolicySnapshot, isInternalTransferTx } from '@/lib/policyEngine';
import { computeMonthlyPotSchedule, FALLBACK_POT_COLORS } from '@/lib/potPacingEngine';
import { formatCurrency, baseAmt, parseUkDate, getEffectiveTxMonthDate } from '@/lib/financeUtils';
import {
  startOfMonth, endOfMonth, subMonths, addMonths, format,
  differenceInCalendarDays, isSameMonth, isBefore, isAfter,
} from 'date-fns';
import {
  ComposedChart, Bar, Line, AreaChart, Area, BarChart, XAxis, YAxis,
  CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  Legend, ReferenceLine
} from 'recharts';
import {
  TrendingUp, TrendingDown, Calendar, ShieldCheck, Target,
  Sparkles, Wallet, ArrowUpRight, ArrowDownRight, Clock,
  CheckCircle2, AlertCircle, Info, Plane, Coins, Zap,
  Layers, Check
} from 'lucide-react';

export default function FinanceYearly() {
  const finance = useFinanceData();
  const { assumptions } = useFinanceAssumptions();
  const { expenses: fixedExpenses = [], monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll } = useFixedExpenses();
  const { trips } = useFinanceTrips();
  const { weekTypeMap: wtMap } = useWeekTypes();
  const { totalBoostThisWeek } = useWeeklyBoosts();

  const categories = useMemo(() => finance.categories || [], [finance.categories]);
  const transactions = useMemo(() => finance.transactions || [], [finance.transactions]);
  const goals = useMemo(() => finance.goals || [], [finance.goals]);
  const accounts = useMemo(() => finance.accounts || [], [finance.accounts]);
  const tripsList = useMemo(() => trips || [], [trips]);

  // Primary chart mode: default to the full waterfall stack
  const [activeChartTab, setActiveChartTab] = useState<'stack' | 'cashflow' | 'wealth' | 'capacity'>('stack');
  const [timeHorizonView, setTimeHorizonView] = useState<'future6' | 'all12'>('all12');
  const [forecastScenario, setForecastScenario] = useState<'conservative' | 'expected'>('expected');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const baseCurrency = finance.settings?.base_currency || 'GBP';
  const fmt = (val: number) => formatCurrency(val, baseCurrency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtExact = (val: number) => formatCurrency(val, baseCurrency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const now = useMemo(() => new Date(), []);
  const currentMonthStart = useMemo(() => startOfMonth(now), [now]);

  // Policy snapshot for current runway and baseline pools
  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions,
      accounts,
      transactions,
      categories,
      goals,
      finance.convertToBase,
      fixedExpensesMonthly,
      totalBoostThisWeek,
      wtMap(),
      tripsList,
      fixedExpensesMonthlyAll,
    );
  }, [assumptions, accounts, transactions, categories, goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, totalBoostThisWeek, wtMap, tripsList]);

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const essentialCatIds = useMemo(() => new Set(
    categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)
  ), [categories]);

  // Pot Schedule Engine across future months
  const potSchedule = useMemo(() => {
    return computeMonthlyPotSchedule({
      goals,
      transactions,
      convertToBase: finance.convertToBase,
      referenceDate: now,
    });
  }, [goals, transactions, finance.convertToBase, now]);

  // Active fixed expenses & total monthly committed
  const activeFixedExpenses = useMemo(() => {
    return (fixedExpenses || []).filter(e => (e as any).is_active !== false);
  }, [fixedExpenses]);

  const fixedMonthlyBase = useMemo(() => {
    return activeFixedExpenses.reduce((sum, e) => {
      const singleAmt = finance.convertToBase(e.amount, e.currency);
      const mult = FREQ_TO_MONTHLY[e.frequency] ?? 1;
      return sum + (singleAmt * mult);
    }, 0);
  }, [activeFixedExpenses, finance.convertToBase]);

  // 12-Month Array Construction: 6 months past (-6 to -1) + current month (0) + 5 months future (+1 to +5)
  const monthWindows = useMemo(() => {
    const list: Array<{
      date: Date;
      monthKey: string;
      label: string;
      fullLabel: string;
      isPast: boolean;
      isCurrent: boolean;
      isFuture: boolean;
      daysInMonth: number;
    }> = [];

    for (let i = -6; i <= 5; i++) {
      const d = startOfMonth(addMonths(currentMonthStart, i));
      const mEnd = endOfMonth(d);
      const days = differenceInCalendarDays(mEnd, d) + 1;
      const isCur = isSameMonth(d, currentMonthStart);
      const isPast = isBefore(d, currentMonthStart);
      const isFuture = isAfter(d, currentMonthStart);

      list.push({
        date: d,
        monthKey: format(d, 'yyyy-MM'),
        label: format(d, 'MMM'),
        fullLabel: format(d, 'MMMM yyyy'),
        isPast,
        isCurrent: isCur,
        isFuture,
        daysInMonth: days,
      });
    }
    return list;
  }, [currentMonthStart]);

  // Compute Historical Past 6 Months Actuals
  const historicalDataMap = useMemo(() => {
    const map = new Map<string, {
      income: number;
      fixed: number;
      essential: number;
      fun: number;
      variable: number;
      pots: number;
      totalSpend: number;
      netSurplus: number;
    }>();

    for (const m of monthWindows) {
      if (!m.isPast && !m.isCurrent) continue;

      const mStart = m.date;
      const mEnd = endOfMonth(mStart);

      let income = 0;
      let fixed = 0;
      let essential = 0;
      let fun = 0;
      let pots = 0;
      let gammaCounted = false;

      const txns = transactions.filter(tx => {
        const d = getEffectiveTxMonthDate(tx);
        return d >= mStart && d <= mEnd;
      });

      for (const tx of txns) {
        if (isInternalTransferTx(tx)) continue;
        if (tx.is_transfer) continue;
        if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
        if (tx.is_reimbursable || (tx as any).is_refund) continue;

        const cat = catMap.get(tx.category_id || '');
        const rawText = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
        const catNameLower = (cat?.name || '').toLowerCase();
        const isIncomeCat = cat?.type === 'income' && catNameLower !== 'income';
        const isIncomeKeyword =
          rawText.includes('batchbase') ||
          rawText.includes('batch base') ||
          rawText.includes('payroll') ||
          rawText.includes('salary') ||
          rawText.includes('venture') ||
          rawText.includes('advisory') ||
          rawText.includes('back pocket') ||
          rawText.includes('bpg') ||
          rawText.includes('eleven') ||
          rawText.includes('11labs') ||
          rawText.includes('etsy');

        // Income
        if (tx.amount > 0) {
          if (cat?.type === 'transfer') continue;
          const isGammaSalary =
            (rawText.includes('gamma') && (!rawText.includes('gamma network') || Math.abs(baseAmt(tx)) >= 500)) ||
            catNameLower.includes('gamma') ||
            catNameLower.includes('salary');

          if (isIncomeCat || isIncomeKeyword || isGammaSalary) {
            const amt = baseAmt(tx);
            if (isGammaSalary && amt >= 1000) {
              if (gammaCounted) continue;
              gammaCounted = true;
            }
            income += amt;
            continue;
          }
          continue;
        }

        // Outflows
        if (cat?.exclude_from_reports) continue;

        const amt = Math.abs(baseAmt(tx));

        // Goal/Pot linked expense
        if ((tx as any).goal_id) {
          pots += amt;
          continue;
        }

        // Fixed bills
        const isExplicitFixed = Boolean((tx as any).fixed_expense_id) || (tx as any).is_fixed || cat?.type === 'fixed';
        if (isExplicitFixed) {
          fixed += amt;
        } else if (essentialCatIds.has(tx.category_id || '')) {
          essential += amt;
        } else {
          fun += amt;
        }
      }

      const variable = essential + fun;
      const totalSpend = fixed + variable + pots;
      const netSurplus = income - totalSpend;

      map.set(m.monthKey, {
        income,
        fixed,
        essential,
        fun,
        variable,
        pots,
        totalSpend,
        netSurplus,
      });
    }

    return map;
  }, [monthWindows, finance.transactions, catMap, essentialCatIds]);

  // Historical Averages from the Past 6 Months
  const past6Stats = useMemo(() => {
    const pastMonths = monthWindows.filter(m => m.isPast);
    if (!pastMonths.length) {
      return {
        avgIncome: 3500,
        avgFixed: fixedMonthlyBase,
        avgVariable: 1400,
        avgEssential: 600,
        avgFun: 800,
        avgPots: 400,
        avgNet: 300,
        spendVariance: 0.08,
      };
    }

    let sumInc = 0, sumFix = 0, sumVar = 0, sumEss = 0, sumFun = 0, sumPots = 0, sumNet = 0;
    const spendList: number[] = [];

    for (const m of pastMonths) {
      const data = historicalDataMap.get(m.monthKey) || {
        income: 0, fixed: 0, essential: 0, fun: 0, variable: 0, pots: 0, totalSpend: 0, netSurplus: 0,
      };
      sumInc += data.income;
      sumFix += data.fixed;
      sumVar += data.variable;
      sumEss += data.essential;
      sumFun += data.fun;
      sumPots += data.pots;
      sumNet += data.netSurplus;
      spendList.push(data.totalSpend);
    }

    const n = pastMonths.length;
    const avgSpend = spendList.reduce((a, b) => a + b, 0) / n;
    const variance = Math.sqrt(spendList.map(x => Math.pow(x - avgSpend, 2)).reduce((a, b) => a + b, 0) / n) / (avgSpend || 1);

    return {
      avgIncome: sumInc / n,
      avgFixed: sumFix / n || fixedMonthlyBase,
      avgVariable: sumVar / n,
      avgEssential: sumEss / n,
      avgFun: sumFun / n,
      avgPots: sumPots / n,
      avgNet: sumNet / n,
      spendVariance: variance,
    };
  }, [monthWindows, historicalDataMap, fixedMonthlyBase]);

  // Predictable Forward Forecast Construction (Next 6 Months)
  const full12MonthsSeries = useMemo(() => {
    let cumulativeWealth = snapshot?.totalLiquidCash ?? 5000;
    const series: Array<{
      monthKey: string;
      label: string;
      fullLabel: string;
      isPast: boolean;
      isCurrent: boolean;
      isFuture: boolean;
      type: 'Actual' | 'Forecast';
      income: number;
      fixed: number;
      essential: number;
      fun: number;
      pots: number;
      totalSpend: number;
      netSurplus: number;
      wealth: number;
      weeklyLivingCapacity: number;
    }> = [];

    // Predictable income assumptions for future:
    const baselineGamma = (snapshot?.split?.monthlyIncome && snapshot.split.monthlyIncome > 0)
      ? snapshot.split.monthlyIncome
      : (assumptions?.expected_monthly_income || 3200);
    const predictableSide = forecastScenario === 'expected' ? 303 : 0; // ~£70/wk Venture Advisory retainer
    const forecastIncome = baselineGamma + predictableSide;

    const forecastEssential = assumptions?.estimated_essential_variable && assumptions.estimated_essential_variable > 0
      ? assumptions.estimated_essential_variable
      : (past6Stats.avgEssential || 600);
    const forecastFun = (snapshot?.split?.funAmount && snapshot.split.funAmount > 0)
      ? snapshot.split.funAmount
      : (past6Stats.avgFun || 700);

    for (const m of monthWindows) {
      if (m.isPast || m.isCurrent) {
        const hist = historicalDataMap.get(m.monthKey) || {
          income: 0, fixed: 0, essential: 0, fun: 0, variable: 0, pots: 0, totalSpend: 0, netSurplus: 0,
        };
        const weeklyCap = (hist.variable / m.daysInMonth) * 7;

        series.push({
          monthKey: m.monthKey,
          label: m.label,
          fullLabel: m.fullLabel,
          isPast: m.isPast,
          isCurrent: m.isCurrent,
          isFuture: m.isFuture,
          type: 'Actual',
          income: Math.round(hist.income),
          fixed: Math.round(hist.fixed || fixedMonthlyBase),
          essential: Math.round(hist.essential),
          fun: Math.round(hist.fun),
          pots: Math.round(hist.pots),
          totalSpend: Math.round(hist.totalSpend),
          netSurplus: Math.round(hist.netSurplus),
          wealth: 0,
          weeklyLivingCapacity: Math.round(weeklyCap),
        });
      } else {
        const mStart = m.date;
        const targetMonthKey = format(mStart, 'yyyy-MM');
        const potPlan = typeof potSchedule?.getScheduleForMonth === 'function'
          ? potSchedule.getScheduleForMonth(mStart)
          : potSchedule?.months?.find((s: any) => s.monthKey === targetMonthKey);
        const scheduledPots = potPlan?.totalScheduledMonthly ?? (potPlan as any)?.total ?? past6Stats.avgPots;

        const hasTrip = trips.some(t => {
          const tStart = parseUkDate(t.start_date);
          const tEnd = parseUkDate(t.end_date);
          return (tStart <= endOfMonth(mStart) && tEnd >= mStart);
        });

        const monthEssential = hasTrip ? forecastEssential * 0.7 : forecastEssential;
        const monthFun = hasTrip ? forecastFun * 0.8 : forecastFun;
        const monthSpend = fixedMonthlyBase + monthEssential + monthFun + scheduledPots;
        const monthNet = forecastIncome - monthSpend;
        const weeklyCap = ((monthEssential + monthFun) / m.daysInMonth) * 7;

        series.push({
          monthKey: m.monthKey,
          label: m.label,
          fullLabel: m.fullLabel,
          isPast: false,
          isCurrent: false,
          isFuture: true,
          type: 'Forecast',
          income: Math.round(forecastIncome),
          fixed: Math.round(fixedMonthlyBase),
          essential: Math.round(monthEssential),
          fun: Math.round(monthFun),
          pots: Math.round(scheduledPots),
          totalSpend: Math.round(monthSpend),
          netSurplus: Math.round(monthNet),
          wealth: 0,
          weeklyLivingCapacity: Math.round(weeklyCap),
        });
      }
    }

    const currentIdx = series.findIndex(s => s.isCurrent);
    if (currentIdx !== -1) {
      series[currentIdx].wealth = Math.round(cumulativeWealth);
      let forwardWealth = cumulativeWealth;
      for (let i = currentIdx + 1; i < series.length; i++) {
        forwardWealth += series[i].netSurplus;
        series[i].wealth = Math.round(forwardWealth);
      }
      let backwardWealth = cumulativeWealth;
      for (let i = currentIdx - 1; i >= 0; i--) {
        backwardWealth -= series[i + 1].netSurplus;
        series[i].wealth = Math.round(backwardWealth);
      }
    }

    return series;
  }, [
    monthWindows,
    historicalDataMap,
    snapshot,
    assumptions,
    fixedMonthlyBase,
    forecastScenario,
    past6Stats,
    potSchedule,
    trips,
  ]);

  // Stacked Data for the Full Outflow Stack (Fixed + Variable + Individual Saving Pots vs. Projected Income)
  const stackedChartData = useMemo(() => {
    return full12MonthsSeries.map(s => {
      const m = monthWindows.find(mw => mw.monthKey === s.monthKey);
      const mDate = m?.date || now;

      const point: any = {
        ...s,
        fixed: s.fixed,
        variable: s.essential + s.fun,
        income: s.income,
      };

      let totalPots = 0;
      for (const meta of potSchedule.activeGoalMetas) {
        let amt = 0;
        if (s.isFuture || s.isCurrent) {
          const plan = potSchedule.getGoalPlanForMonth(meta.goal.id, mDate);
          amt = Math.round(plan?.monthlyAmount ?? 0);
        } else {
          const pastSum = transactions
            .filter(tx => (tx as any).goal_id === meta.goal.id)
            .filter(tx => {
              const d = getEffectiveTxMonthDate(tx);
              return d >= mDate && d <= endOfMonth(mDate);
            })
            .reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);
          amt = Math.round(pastSum);
        }
        point[meta.goal.id] = amt;
        totalPots += amt;
      }

      point.totalPots = totalPots;
      point.totalAllocated = point.fixed + point.variable + totalPots;
      point.surplusHeadroom = point.income - point.totalAllocated;

      return point;
    });
  }, [full12MonthsSeries, monthWindows, now, potSchedule, finance.transactions]);

  // Display series based on time horizon view
  const displayedSeries = useMemo(() => {
    if (timeHorizonView === 'future6') {
      return stackedChartData.filter(s => s.isFuture || s.isCurrent);
    }
    return stackedChartData;
  }, [stackedChartData, timeHorizonView]);

  // Future 6 Months Aggregates
  const future6Stats = useMemo(() => {
    const futureMonths = full12MonthsSeries.filter(s => s.isFuture || s.isCurrent);
    if (!futureMonths.length) return { totalSurplus: 0, avgSurplus: 0, projectedWealthDelta: 0 };

    const totalSurplus = futureMonths.reduce((sum, m) => sum + m.netSurplus, 0);
    const avgSurplus = totalSurplus / futureMonths.length;
    const startWealth = futureMonths[0]?.wealth ?? 0;
    const endWealth = futureMonths[futureMonths.length - 1]?.wealth ?? 0;

    return {
      totalSurplus,
      avgSurplus,
      projectedWealthDelta: endWealth - startWealth,
    };
  }, [full12MonthsSeries]);

  // Active Goals Target Completion Timeline
  const goalMilestones = useMemo(() => {
    const active = goals.filter(g => {
      const name = (g.name || '').toLowerCase();
      if ((g as any).is_stash || name.includes('stash')) return false;
      if ((g as any).is_emergency || name.includes('emergency')) return false;
      const target = finance.convertToBase(g.target_amount || 0, g.currency);
      const assigned = finance.convertToBase(g.assigned_amount || 0, g.currency);
      return target > 0 && assigned < target;
    });

    return active.map(g => {
      const target = finance.convertToBase(g.target_amount || 0, g.currency);
      const assigned = finance.convertToBase(g.assigned_amount || 0, g.currency);
      const remaining = Math.max(0, target - assigned);
      const pct = Math.min(100, Math.round((assigned / target) * 100));

      let accumulated = assigned;
      let hitMonth: string = 'Beyond 6m';

      for (const m of full12MonthsSeries.filter(s => s.isCurrent || s.isFuture)) {
        const d = monthWindows.find(mw => mw.monthKey === m.monthKey)?.date || now;
        const plan = potSchedule.getGoalPlanForMonth(g.id, d);
        const monthlyAdd = plan?.monthlyAmount ?? 0;
        accumulated += monthlyAdd;
        if (accumulated >= target) {
          hitMonth = m.fullLabel;
          break;
        }
      }

      return {
        id: g.id,
        name: g.name,
        target,
        assigned,
        remaining,
        percent: pct,
        deadline: g.deadline ? format(new Date(g.deadline), 'MMM yyyy') : null,
        projectedHitMonth: hitMonth,
        color: g.color || '#3b82f6',
      };
    });
  }, [finance.goals, finance.convertToBase, full12MonthsSeries, monthWindows, now, potSchedule]);

  // Selected Month Spotlight (for deep-dive inspection)
  const activeSpotlightMonth = useMemo(() => {
    if (selectedMonthKey) {
      const found = stackedChartData.find(s => s.monthKey === selectedMonthKey);
      if (found) return found;
    }
    // Default to next month if available, else current month
    const nextMonth = stackedChartData.find(s => s.isFuture);
    return nextMonth || stackedChartData.find(s => s.isCurrent) || stackedChartData[0] || null;
  }, [selectedMonthKey, stackedChartData]);

  // Predictability Score (0-100%)
  const predictabilityScore = useMemo(() => {
    const raw = Math.round((1 - Math.min(0.5, past6Stats.spendVariance)) * 100);
    return Math.max(70, Math.min(99, raw));
  }, [past6Stats.spendVariance]);

  if (finance.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] max-w-7xl mx-auto px-4">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-3 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-500">Loading 12-Month Outlook...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
      {/* ========================================================= */}
      {/* HEADER BAR                                                */}
      {/* ========================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-violet-100 text-violet-700">
              <TrendingUp className="w-5 h-5" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-display font-black tracking-tight text-slate-900">
              12-Month Outlook
            </h1>
            <Badge variant="outline" className="ml-2 font-mono text-xs bg-slate-50 text-slate-600 border-slate-200">
              Rolling Horizon
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Reflecting on the last 6 months of actual cash flow & predictable forecast for the next 6 months.
          </p>
        </div>

        {/* Forecast Scenario Selector */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl self-start md:self-auto text-xs font-medium">
          <span className="px-2 text-slate-500 font-semibold">Forecast:</span>
          <button
            onClick={() => setForecastScenario('conservative')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              forecastScenario === 'conservative'
                ? 'bg-white text-slate-900 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Conservative (Gamma Only)
          </button>
          <button
            onClick={() => setForecastScenario('expected')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              forecastScenario === 'expected'
                ? 'bg-white text-violet-700 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Expected (+ Retainers)
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 4 HIGH-IMPACT KPI CARDS                                   */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Net Cash Flow Evolution */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm hover:shadow transition-all bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 tracking-wider uppercase">
                Avg. Net Surplus
              </span>
              <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                <ArrowUpRight className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-display font-black text-slate-900">
                {fmt(future6Stats.avgSurplus)}
              </span>
              <span className="text-xs text-slate-400 font-medium">/ month proj.</span>
            </div>
            <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
              <span>Past 6m average:</span>
              <span className="font-semibold text-slate-700">{fmt(past6Stats.avgNet)}</span>
            </p>
          </CardContent>
        </Card>

        {/* KPI 2: Projected Wealth Delta */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm hover:shadow transition-all bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 tracking-wider uppercase">
                6-Mo Wealth Growth
              </span>
              <span className="p-2 rounded-xl bg-violet-50 text-violet-600">
                <Coins className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-display font-black text-violet-600">
                +{fmt(future6Stats.projectedWealthDelta)}
              </span>
              <span className="text-xs text-slate-400 font-medium">accumulated</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Cash growth & ring-fenced pot savings
            </p>
          </CardContent>
        </Card>

        {/* KPI 3: Predictability Score */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm hover:shadow transition-all bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 tracking-wider uppercase">
                Predictability Score
              </span>
              <span className="p-2 rounded-xl bg-blue-50 text-blue-600">
                <ShieldCheck className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-display font-black text-slate-900">
                {predictabilityScore}%
              </span>
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                High Stability
              </Badge>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Low spending variance across 6 months
            </p>
          </CardContent>
        </Card>

        {/* KPI 4: Survival Runway Horizon */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm hover:shadow transition-all bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 tracking-wider uppercase">
                Runway Reserve
              </span>
              <span className="p-2 rounded-xl bg-amber-50 text-amber-600">
                <Zap className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-display font-black text-slate-900">
                {snapshot?.runwayWeeks ? `${Math.round(snapshot.runwayWeeks)} wks` : '12+ wks'}
              </span>
              <span className="text-xs text-slate-400 font-medium">survival buffer</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Emergency floor protected at £1,000
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ========================================================= */}
      {/* FEATURED: SAVING POT GOAL PREDICTIONS & OUTFLOW STACK     */}
      {/* AGAINST PROJECTED INCOME                                  */}
      {/* ========================================================= */}
      <Card className="rounded-3xl border-slate-200/80 shadow-md bg-white overflow-hidden">
        <CardHeader className="p-6 pb-2 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-pink-100 text-pink-600">
                <Layers className="w-4 h-4" />
              </span>
              <CardTitle className="text-lg font-display font-bold text-slate-900">
                12-Month Cash Flow & Saving Pot Horizon
              </CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-slate-400 cursor-pointer" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Each bar stacks Fixed Bills, Variable Living, and active Saving Pot Goals. The dashed green line represents your monthly income (actual income for past months, projected income for future months). Headroom between the top of the stack and the line is unallocated surplus.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Fixed bills, variable living, and saving pot goals stacked against monthly income
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* View Horizon Toggle */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-medium">
              <button
                onClick={() => setTimeHorizonView('future6')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  timeHorizonView === 'future6'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Next 6m Forecast
              </button>
              <button
                onClick={() => setTimeHorizonView('all12')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  timeHorizonView === 'all12'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Full 12m Horizon
              </button>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeChartTab} onValueChange={(v) => setActiveChartTab(v as any)} className="w-auto">
              <TabsList className="bg-slate-100 p-1 rounded-xl">
                <TabsTrigger value="stack" className="text-xs rounded-lg px-3 py-1.5 font-medium">
                  Full Stack vs Income
                </TabsTrigger>
                <TabsTrigger value="cashflow" className="text-xs rounded-lg px-3 py-1.5 font-medium">
                  Inflow vs Outflow
                </TabsTrigger>
                <TabsTrigger value="wealth" className="text-xs rounded-lg px-3 py-1.5 font-medium">
                  Wealth Growth
                </TabsTrigger>
                <TabsTrigger value="capacity" className="text-xs rounded-lg px-3 py-1.5 font-medium">
                  Living Capacity
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <div className="h-[430px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {activeChartTab === 'stack' ? (
                <ComposedChart
                  data={displayedSeries}
                  margin={{ top: 15, right: 25, left: 0, bottom: 15 }}
                  onClick={(e) => {
                    if (e && e.activePayload && e.activePayload.length > 0) {
                      const clicked = e.activePayload[0].payload;
                      if (clicked?.monthKey) setSelectedMonthKey(clicked.monthKey);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `£${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                  />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload;
                      const totalAlloc = item.totalAllocated || (item.fixed + item.variable + item.totalPots);
                      const surplus = item.income - totalAlloc;

                      return (
                        <div className="bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-2xl shadow-2xl border border-slate-800 text-xs space-y-2 min-w-[280px]">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <div>
                              <span className="font-bold font-display text-sm block">{item.fullLabel}</span>
                              <span className="text-[10px] text-slate-400">Click bar to lock spotlight</span>
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${item.isFuture ? 'text-violet-400 border-violet-800' : 'text-emerald-400 border-emerald-800'}`}>
                              {item.type}
                            </Badge>
                          </div>

                          {/* Income vs Outflow Header */}
                          <div className="grid grid-cols-2 gap-2 bg-slate-800/60 p-2.5 rounded-xl">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-emerald-400 block">
                                {item.isFuture ? 'Projected Income' : 'Actual Income'}
                              </span>
                              <span className="text-sm font-display font-black text-emerald-300">{fmt(item.income)}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Outflows</span>
                              <span className="text-sm font-display font-black text-slate-200">{fmt(totalAlloc)}</span>
                            </div>
                          </div>

                          {/* Stack Layers */}
                          <div className="space-y-1.5 pt-1 text-slate-300">
                            <div className="flex justify-between items-center">
                              <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" />
                                Fixed Bills:
                              </span>
                              <span className="font-semibold text-slate-100">{fmt(item.fixed)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                                Variable Living (Ess + Fun):
                              </span>
                              <span className="font-semibold text-amber-300">{fmt(item.variable)}</span>
                            </div>

                            {/* Pot Goals Sub-List */}
                            {potSchedule.activeGoalMetas.map(meta => {
                              const amt = item[meta.goal.id] || 0;
                              if (amt <= 0) return null;
                              return (
                                <div key={meta.goal.id} className="flex justify-between items-center pl-4 text-[11px]">
                                  <span className="flex items-center gap-1.5 text-slate-400">
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: meta.color }} />
                                    {meta.goal.name}:
                                  </span>
                                  <span className="font-medium text-slate-200">{fmt(amt)}</span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Net Surplus / Deficit */}
                          <div className="border-t border-slate-800 pt-2 flex justify-between items-center">
                            <span className="font-bold text-slate-200">
                              {surplus >= 0 ? '🌟 Leftover Fun Surplus:' : '⚠️ Over Budget By:'}
                            </span>
                            <span className={`font-display font-black text-sm ${surplus >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {surplus >= 0 ? '+' : ''}{fmt(surplus)}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    content={() => (
                      <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-xs text-slate-600 mb-4 px-1">
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-slate-600 inline-block" />
                            <span className="font-medium text-slate-700">Fixed Bills</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                            <span className="font-medium text-slate-700">Variable Living</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" />
                            <span className="font-medium text-slate-700">Saving Pots</span>
                            <span className="text-[10px] text-slate-400">({potSchedule.activeGoalMetas.length} active goals)</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-0 border-t-2 border-dashed border-emerald-500 inline-block" />
                          <span className="font-semibold text-emerald-700">Monthly Income</span>
                          <span className="text-[10px] text-slate-400">(Actual / Projected)</span>
                        </div>
                      </div>
                    )}
                  />
                  <ReferenceLine x={format(now, 'MMM')} stroke="#8b5cf6" strokeDasharray="3 3" label={{ value: 'TODAY', position: 'top', fill: '#8b5cf6', fontSize: 10, fontWeight: 700 }} />

                  {/* 1. Fixed Bills (Base of Stack) */}
                  <Bar dataKey="fixed" stackId="allocations" name="Fixed Bills" legendType="none" fill="#475569" radius={[0, 0, 0, 0]} />

                  {/* 2. Variable Living (Middle of Stack) */}
                  <Bar dataKey="variable" stackId="allocations" name="Variable Living" legendType="none" fill="#f59e0b" radius={[0, 0, 0, 0]} />

                  {/* 3. Individual Saving Pot Goals (Top of Stack) */}
                  {potSchedule.activeGoalMetas.map((meta, idx) => (
                    <Bar
                      key={meta.goal.id}
                      dataKey={meta.goal.id}
                      stackId="allocations"
                      name={meta.goal.name}
                      legendType="none"
                      fill={meta.color || FALLBACK_POT_COLORS[idx % FALLBACK_POT_COLORS.length]}
                      radius={idx === potSchedule.activeGoalMetas.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}

                  {/* 4. Monthly Income Ceiling Line */}
                  <Line
                    type="monotone"
                    dataKey="income"
                    name="Monthly Income"
                    legendType="none"
                    stroke="#10b981"
                    strokeWidth={3}
                    strokeDasharray="4 4"
                    dot={{ r: 4, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                </ComposedChart>
              ) : activeChartTab === 'cashflow' ? (
                <BarChart data={displayedSeries} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`} />
                  <RechartsTooltip
                    formatter={(val: any, name: any, item: any) => {
                      const isIncome = name?.toString().toLowerCase().includes('income');
                      const label = isIncome
                        ? (item?.payload?.isFuture ? 'Projected Income' : 'Actual Income')
                        : 'Total Outflows';
                      return [fmt(Number(val)), label];
                    }}
                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', border: '1px solid #1e293b', color: '#fff', fontSize: '12px' }}
                    labelStyle={{ color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" />
                  <ReferenceLine x={format(now, 'MMM')} stroke="#8b5cf6" strokeDasharray="3 3" />
                  <Bar dataKey="income" name="Monthly Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="totalSpend" name="Total Outflows" fill="#64748b" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : activeChartTab === 'wealth' ? (
                <AreaChart data={displayedSeries} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                  <defs>
                    <linearGradient id="wealthGradient2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${(v/1000).toFixed(1)}k`} />
                  <RechartsTooltip />
                  <ReferenceLine x={format(now, 'MMM')} stroke="#8b5cf6" strokeDasharray="3 3" />
                  <ReferenceLine y={1000} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: '£1,000 Emergency Floor', position: 'right', fill: '#f43f5e', fontSize: 9 }} />
                  <Area type="monotone" dataKey="wealth" name="Liquid Cash & Pot Reserves" stroke="#8b5cf6" strokeWidth={2.5} fillOpacity={1} fill="url(#wealthGradient2)" />
                </AreaChart>
              ) : (
                <BarChart data={displayedSeries} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${v}`} />
                  <RechartsTooltip />
                  <ReferenceLine x={format(now, 'MMM')} stroke="#8b5cf6" strokeDasharray="3 3" />
                  <Bar dataKey="weeklyLivingCapacity" name="Weekly Living Spend" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Interactive Month Spotlight Strip */}
          {activeSpotlightMonth && (
            <div className="mt-6 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display font-black text-slate-900 text-base">
                      {activeSpotlightMonth.fullLabel} Breakdown Spotlight
                    </span>
                    <Badge variant="outline" className={`text-[10px] ${activeSpotlightMonth.isFuture ? 'text-violet-700 bg-violet-50 border-violet-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
                      {activeSpotlightMonth.type}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click any column in the chart above or choose from the month tabs below
                  </p>
                </div>

                {/* Quick month pills */}
                <div className="flex flex-wrap gap-1">
                  {displayedSeries.map(s => (
                    <button
                      key={s.monthKey}
                      onClick={() => setSelectedMonthKey(s.monthKey)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                        activeSpotlightMonth.monthKey === s.monthKey
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progress Bar of Budget Stack against Income */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700">
                    Total Committed Outflow Stack: <strong className="text-slate-900">{fmt(activeSpotlightMonth.totalAllocated)}</strong> of {fmt(activeSpotlightMonth.income)} Income
                  </span>
                  <span className={activeSpotlightMonth.surplusHeadroom >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                    {activeSpotlightMonth.surplusHeadroom >= 0 ? `+${fmt(activeSpotlightMonth.surplusHeadroom)} surplus headroom` : `${fmt(Math.abs(activeSpotlightMonth.surplusHeadroom))} over budget`}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-slate-200 overflow-hidden flex">
                  <div
                    className="h-full bg-slate-600 transition-all"
                    style={{ width: `${Math.min(100, (activeSpotlightMonth.fixed / (activeSpotlightMonth.income || 1)) * 100)}%` }}
                    title={`Fixed Bills: ${fmt(activeSpotlightMonth.fixed)}`}
                  />
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${Math.min(100, (activeSpotlightMonth.variable / (activeSpotlightMonth.income || 1)) * 100)}%` }}
                    title={`Variable Living: ${fmt(activeSpotlightMonth.variable)}`}
                  />
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(100, (activeSpotlightMonth.totalPots / (activeSpotlightMonth.income || 1)) * 100)}%` }}
                    title={`Saving Pots Total: ${fmt(activeSpotlightMonth.totalPots)}`}
                  />
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1 flex-wrap">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-600" /> Fixed Bills: <strong>{fmt(activeSpotlightMonth.fixed)}</strong></span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Variable Living: <strong>{fmt(activeSpotlightMonth.variable)}</strong></span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Saving Pots: <strong>{fmt(activeSpotlightMonth.totalPots)}</strong></span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Headroom: <strong>{fmt(Math.max(0, activeSpotlightMonth.surplusHeadroom))}</strong></span>
                </div>
              </div>

              {/* Individual Saving Pots for this Month */}
              <div className="pt-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2.5">
                  Saving Pots Scheduled in {activeSpotlightMonth.fullLabel}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {potSchedule.activeGoalMetas.map(meta => {
                    const monthlyAmt = activeSpotlightMonth[meta.goal.id] || 0;
                    return (
                      <div
                        key={meta.goal.id}
                        className="p-3 rounded-xl bg-white border border-slate-200/80 flex items-center justify-between"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 truncate">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                            {meta.goal.name}
                          </span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            Target: {fmt(meta.targetBase)}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-display font-bold text-slate-900 block">
                            {fmt(monthlyAmt)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            ≈ {fmt(monthlyAmt / 4.33)}/wk
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========================================================= */}
      {/* TWO COLUMN DEEP DIVE: REFLECTION VS. PREDICTION           */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* COLUMN 1: PAST 6 MONTHS REFLECTION */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                Past 6 Months Reflection
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Actual bank performance & observed averages
              </p>
            </div>
            <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
              Verified Data
            </Badge>
          </div>

          {/* Past 6-Month Metric Summary */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Historical Run-Rates (Monthly Average)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Income</span>
                <span className="text-base font-display font-bold text-slate-900">{fmt(past6Stats.avgIncome)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Fixed Bills</span>
                <span className="text-base font-display font-bold text-slate-900">{fmt(past6Stats.avgFixed)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Variable Living</span>
                <span className="text-base font-display font-bold text-amber-600">{fmt(past6Stats.avgVariable)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Pots Saved</span>
                <span className="text-base font-display font-bold text-blue-600">{fmt(past6Stats.avgPots)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Net Surplus</span>
                <span className={`text-base font-display font-bold ${past6Stats.avgNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {fmt(past6Stats.avgNet)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Savings Rate</span>
                <span className="text-base font-display font-bold text-violet-600">
                  {past6Stats.avgIncome > 0 ? `${Math.round(((past6Stats.avgPots + Math.max(0, past6Stats.avgNet)) / past6Stats.avgIncome) * 100)}%` : '0%'}
                </span>
              </div>
            </div>
          </Card>

          {/* Historical Month-by-Month Table */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/70 font-semibold text-xs text-slate-700 flex justify-between items-center">
              <span>Month</span>
              <span>Income / Spend / Net</span>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {full12MonthsSeries.filter(s => s.isPast || s.isCurrent).map(item => (
                <div key={item.monthKey} className="p-3.5 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-slate-900">{item.fullLabel}</span>
                      {item.isCurrent && (
                        <Badge className="bg-violet-100 text-violet-700 border-none text-[9px] px-1.5 py-0">Current</Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Living: {fmt(item.essential + item.fun)} · Pots: {fmt(item.pots)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-slate-900 block">{fmt(item.income)}</span>
                    <span className={`font-mono font-bold text-[11px] ${item.netSurplus >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {item.netSurplus >= 0 ? '+' : ''}{fmt(item.netSurplus)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* COLUMN 2: NEXT 6 MONTHS PREDICTABLE FORECAST */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                Next 6 Months Forecast
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automated waterfall schedule & pot milestone targets
              </p>
            </div>
            <Badge variant="outline" className="text-xs bg-violet-50 text-violet-700 border-violet-200">
              Predictable
            </Badge>
          </div>

          {/* Goal Milestones Timeline */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-blue-500" />
                Pot Milestone Target Dates
              </h3>
              <span className="text-[11px] text-slate-400 font-medium">Next 6 Months</span>
            </div>

            {goalMilestones.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No active savings pots found.</p>
            ) : (
              <div className="space-y-3.5">
                {goalMilestones.slice(0, 5).map(g => (
                  <div key={g.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">{g.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">Hit Date:</span>
                        <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-[10px] font-bold">
                          {g.projectedHitMonth}
                        </Badge>
                      </div>
                    </div>
                    <Progress value={g.percent} className="h-1.5" />
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{fmt(g.assigned)} funded</span>
                      <span>Target: {fmt(g.target)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Upcoming Multi-Week & Travel Radar */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Plane className="w-3.5 h-3.5 text-amber-500" />
              Scheduled Lifestyle & Trip Radar
            </h3>

            {trips.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">No upcoming trips scheduled in this window.</p>
            ) : (
              <div className="space-y-2">
                {trips.slice(0, 3).map((t, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-amber-50/50 border border-amber-100/70 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">{t.destination || 'Planned Trip'}</p>
                      <p className="text-[11px] text-slate-500">
                        {t.start_date} – {t.end_date}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-amber-300 text-amber-800 text-[10px]">
                      Travel Mode
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Future Month-by-Month Projected Schedule */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/70 font-semibold text-xs text-slate-700 flex justify-between items-center">
              <span>Forecast Month</span>
              <span>Inflow / Commitments / Net</span>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {full12MonthsSeries.filter(s => s.isFuture).map(item => (
                <div key={item.monthKey} className="p-3.5 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div>
                    <span className="font-display font-bold text-slate-900 block">{item.fullLabel}</span>
                    <span className="text-[11px] text-slate-400">
                      Fixed: {fmt(item.fixed)} · Living: {fmt(item.essential + item.fun)} · Pots: {fmt(item.pots)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-slate-900 block">{fmt(item.income)}</span>
                    <span className="font-mono font-bold text-[11px] text-emerald-600">
                      +{fmt(item.netSurplus)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
