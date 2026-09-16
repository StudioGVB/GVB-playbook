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
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import { MetricCard } from '@/components/finance/MetricCard';
import { MultiSegmentDonut } from '@/components/finance/MultiSegmentDonut';
import MonthlyCashFlowBreakdown from '@/components/finance/MonthlyCashFlowBreakdown';
import { calcTakeHome } from '@/lib/ukTakeHome';
import {
  startOfMonth, endOfMonth, subMonths, addMonths, format, addWeeks,
  getDaysInMonth, getDate,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, ShoppingCart, PartyPopper,
  Lock, TrendingUp, TrendingDown, Minus, DollarSign, Shield,
  ShoppingBasket, Pill, Bus, Utensils, Pencil, Gauge,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';



const FREQ_TO_MONTHLY: Record<string, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

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
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  const monthLabel = format(monthStart, 'MMMM yyyy');

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fxRates = (finance.settings?.fx_rates || {}) as Record<string, number>;
  const audToGbp = fxRates['AUD_GBP'] || 0.52;
  const fmt = (n: number) => formatCurrency(n, baseCurrency);
  const fmtGbp = (n: number) => formatCurrency(n * audToGbp, 'GBP');

  const catMap = useMemo(() => new Map(finance.categories.map(c => [c.id, c])), [finance.categories]);
  const essentialCatIds = useMemo(() => new Set(
    finance.categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)
  ), [finance.categories]);

  // Monthly overview should show every committed fixed bill, including bills
  // paid from external accounts like rent. Pool/runway logic still receives the
  // internal-only total separately via the policy snapshot above.
  const fixedMonthly = fixedExpensesMonthlyAll;


  // Monthly budgets
  const monthlyEssentialBudget = snapshot 
    ? snapshot.weeklyEssentialBudget * 4.33 
    : (assumptions ? (assumptions.estimated_essential_variable || 0) * 4.33 : 0);
  const monthlyFunBudget = snapshot 
    ? snapshot.baseWeeklyFun * 4.33 
    : (assumptions ? (assumptions.weekly_fun_budget || 100) * 4.33 : 0);
  const autoTotalBudget = monthlyEssentialBudget + monthlyFunBudget + fixedMonthly;
  const budgetOverride = (assumptions as any)?.monthly_budget_override;
  const monthlyTotalBudget = (budgetOverride != null && budgetOverride !== '') ? Number(budgetOverride) : autoTotalBudget;

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

  // Only treat as fixed when explicitly linked to a Cost-of-Living bill.
  // A generic "Bills" category is not enough: the user must choose which
  // bill it belongs to so Bolt/transport/etc. don't get counted as fixed.
  const isFixedTx = useCallback((tx: any): boolean => {
    return !!tx.fixed_expense_id;
  }, []);

  // Spending breakdown
  const { essentialSpent, funSpent, fixedSpent, categoryBreakdown, dailyData } = useMemo(() => {
    let essentialSpent = 0;
    let funSpent = 0;
    let fixedSpent = 0;
    let incomeTotal = 0;
    const catTotals = new Map<string, number>();

    for (const tx of monthTxns) {
      if (tx.amount > 0 && !tx.is_transfer) {
        incomeTotal += baseAmt(tx);
        continue;
      }
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id) continue;

      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports) continue;

      const amt = Math.abs(baseAmt(tx));

      if (isFixedTx(tx)) {
        fixedSpent += amt;
        const catId = tx.category_id || '__uncategorised';
        catTotals.set(catId, (catTotals.get(catId) || 0) + amt);
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


    const categoryBreakdown = Array.from(catTotals.entries()).map(([catId, total]) => {
      const cat = catMap.get(catId);
      return {
        catId,
        name: cat?.name || 'Uncategorised',
        color: cat?.color || '#888',
        total,
        isEssential: essentialCatIds.has(catId),
      };
    }).sort((a, b) => b.total - a.total);

    // Daily data
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

    // Add phantom reimbursements from externally-paid bills so income isn't understated.
    const monthIso = format(monthStart, 'yyyy-MM-dd');
    for (const r of reimbursementsOn(monthIso)) incomeTotal += r.amount;

    return { essentialSpent, funSpent, fixedSpent, incomeTotal, categoryBreakdown, dailyData };
  }, [monthTxns, catMap, essentialCatIds, monthStart, isFixedTx, reimbursementsOn]);

  // Previous month totals for comparison
  const prevTotals = useMemo(() => {
    let essential = 0, fun = 0, fixed = 0;
    const catTotals = new Map<string, number>();
    for (const tx of prevMonthTxns) {
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id) continue;
      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports) continue;
      const amt = Math.abs(baseAmt(tx));
      if (isFixedTx(tx)) { 
        fixed += amt; 
        const catId = tx.category_id || '__uncategorised';
        catTotals.set(catId, (catTotals.get(catId) || 0) + amt);
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
    return { essential, fun, fixed, total: essential + fun + fixed, catTotals };
  }, [prevMonthTxns, catMap, essentialCatIds, isFixedTx]);


  // Actual total spent in logged transactions this month (variable + paid fixed bills)
  const actualTotalSpent = essentialSpent + funSpent + fixedSpent;
  const totalSpent = actualTotalSpent;
  const netBudget = monthlyTotalBudget - totalSpent;

  // Pace projection (only meaningful for current month)
  const today = new Date();
  const isCurrentMonth = today >= monthStart && today <= monthEnd;
  const daysInMonth = getDaysInMonth(monthStart);
  const daysElapsed = isCurrentMonth ? getDate(today) : daysInMonth;
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  const variableSpent = essentialSpent + funSpent;
  const dailyVariablePace = daysElapsed > 0 ? variableSpent / daysElapsed : 0;
  const projectedVariableSpend = dailyVariablePace * daysInMonth;
  const projectedSpend = projectedVariableSpend + fixedMonthly;
  const projectedDiff = projectedSpend - monthlyTotalBudget; // positive => over
  const spendPct = monthlyTotalBudget > 0 ? (actualTotalSpent / monthlyTotalBudget) * 100 : 0;
  const timePct = (daysElapsed / daysInMonth) * 100;

  // Pro-rated comparison scaling for month-to-date (e.g. Day 11 of 30 vs Day 11 of 31)
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
    };
  }, [prevTotals, proRateFactor]);

  const expectedPct = monthlyTotalBudget > 0 
    ? ((fixedMonthly + (monthlyEssentialBudget + monthlyFunBudget) * (daysElapsed / daysInMonth)) / monthlyTotalBudget) * 100 
    : 0;

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
  };

  const trendIcon = (current: number, previous: number) => {
    if (current > previous * 1.05) return <TrendingUp className="w-3 h-3 text-destructive" />;
    if (current < previous * 0.95) return <TrendingDown className="w-3 h-3 text-emerald-500" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  const trendPercent = (current: number, previous: number) => {
    if (previous === 0) return '';
    const pct = ((current - previous) / previous) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
  };

  const essentialCats = categoryBreakdown.filter(c => c.isEssential);
  const funCats = categoryBreakdown.filter(c => !c.isEssential);

  // Category / merchant / description spotlight tiles
  const [selectedSpotlight, setSelectedSpotlight] = useState<{
    key: string;
    label: string;
    icon: typeof ShoppingBasket;
    kw: string[];
  } | null>(null);

  // Category drill-down (for "All categories" grid)
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


  // Known-brand dictionary: maps regex hits in raw txn text to a canonical merchant + spotlight bucket.
  const BRAND_MAP: Array<{ match: RegExp; name: string; category: string }> = [
    // Transport
    { match: /\bbolt(\.eu|\.com)?\b/i, name: 'Bolt', category: 'transport' },
    { match: /\buber(?!\s*eats)\b/i, name: 'Uber', category: 'transport' },
    { match: /\blyft\b/i, name: 'Lyft', category: 'transport' },
    { match: /\btfl\b|transport for london/i, name: 'TfL', category: 'transport' },
    { match: /\btfgm\b|beenetwork/i, name: 'TfGM (Manchester)', category: 'transport' },
    { match: /national\s*rail|trainline|lner|avanti|northern rail/i, name: 'National Rail', category: 'transport' },
    // Supermarkets
    { match: /sainsbury/i, name: "Sainsbury's", category: 'supermarkets' },
    { match: /tesco/i, name: 'Tesco', category: 'supermarkets' },
    { match: /\basda\b/i, name: 'Asda', category: 'supermarkets' },
    { match: /\baldi\b/i, name: 'Aldi', category: 'supermarkets' },
    { match: /\blidl\b/i, name: 'Lidl', category: 'supermarkets' },
    { match: /waitrose/i, name: 'Waitrose', category: 'supermarkets' },
    { match: /\bco[- ]?op\b|cooperative/i, name: 'Co-op', category: 'supermarkets' },
    { match: /marks\s*&?\s*spencer|\bm&s\b/i, name: 'M&S', category: 'supermarkets' },
    { match: /morrisons/i, name: 'Morrisons', category: 'supermarkets' },
    { match: /iceland/i, name: 'Iceland', category: 'supermarkets' },
    // Pharmacies
    { match: /\bboots\b/i, name: 'Boots', category: 'pharmacies' },
    { match: /super\s*drug/i, name: 'Superdrug', category: 'pharmacies' },
    { match: /lloyds\s*pharm/i, name: 'Lloyds Pharmacy', category: 'pharmacies' },
    { match: /well\s*pharmacy/i, name: 'Well Pharmacy', category: 'pharmacies' },
    { match: /day\s*lewis/i, name: 'Day Lewis', category: 'pharmacies' },
    { match: /rowlands/i, name: 'Rowlands', category: 'pharmacies' },
    // Eating out
    { match: /deliveroo/i, name: 'Deliveroo', category: 'eatingout' },
    { match: /just\s*eat/i, name: 'Just Eat', category: 'eatingout' },
    { match: /uber\s*eats/i, name: 'Uber Eats', category: 'eatingout' },
    { match: /gousto/i, name: 'Gousto', category: 'eatingout' },
    { match: /hellofresh/i, name: 'HelloFresh', category: 'eatingout' },
    { match: /wetherspoon/i, name: 'Wetherspoons', category: 'eatingout' },
    { match: /pret\s*a\s*manger|\bpret\b/i, name: 'Pret A Manger', category: 'eatingout' },
    { match: /greggs/i, name: 'Greggs', category: 'eatingout' },
    { match: /mcdonald/i, name: "McDonald's", category: 'eatingout' },
    { match: /starbucks/i, name: 'Starbucks', category: 'eatingout' },
    { match: /costa\s*coffee|\bcosta\b/i, name: 'Costa', category: 'eatingout' },
    { match: /caff[eè]?\s*nero|\bnero\b/i, name: 'Caffè Nero', category: 'eatingout' },
    { match: /leno\s*ex\s*machina/i, name: 'Leno Ex Machina', category: 'eatingout' },
    { match: /freemount/i, name: 'Freemount', category: 'eatingout' },
    { match: /slemani/i, name: 'Slemani Restaurant', category: 'eatingout' },
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
    if (!selectedCategory) return [] as { name: string; total: number }[];
    const map = new Map<string, number>();
    for (const tx of monthTxns) {
      if (tx.amount >= 0 || tx.is_transfer) continue;
      if ((tx as any).goal_id) continue;
      const catId = tx.category_id || '__uncategorised';
      if (catId !== selectedCategory.catId) continue;
      const key = canonicaliseMerchant(tx.merchant || tx.description || '');
      map.set(key, (map.get(key) || 0) + Math.abs(baseAmt(tx)));
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [selectedCategory, monthTxns]);

  const matchesSpotlightCategory = (tx: typeof monthTxns[0], keywords: string[]) => {
    if (tx.amount >= 0 || tx.is_transfer) return false;
    if ((tx as any).goal_id) return false;
    const cat = catMap.get(tx.category_id || '');
    if (cat?.exclude_from_reports) return false;
    if (isFixedTx(tx)) return false;
    const name = (cat?.name || '').toLowerCase();
    return keywords.some(k => name.includes(k));
  };

  const spotlight = useMemo(() => {
    return [
      { key: 'supermarkets', label: 'Supermarkets', icon: ShoppingBasket, kw: ['grocer', 'supermarket'] },
      { key: 'pharmacies', label: 'Pharmacies', icon: Pill, kw: ['pharma', 'pharmacy', 'chemist'] },
      { key: 'transport', label: 'Transport', icon: Bus, kw: ['transport', 'transit', 'train', 'tube', 'bus', 'taxi', 'fuel', 'petrol'] },
      { key: 'eatingout', label: 'Eating Out', icon: Utensils, kw: ['eating', 'restaurant', 'cafe', 'takeaway', 'coffee'] },
    ].map(s => {
      const current = categoryBreakdown
        .filter(c => {
          const name = (c.name || '').toLowerCase();
          return s.kw.some(k => name.includes(k));
        })
        .reduce((sum, c) => sum + c.total, 0);

      const previousFull = Array.from(prevTotals.catTotals.entries())
        .filter(([catId]) => {
          const cat = catMap.get(catId);
          const name = (cat?.name || '').toLowerCase();
          return s.kw.some(k => name.includes(k));
        })
        .reduce((sum, [, total]) => sum + total, 0);

      const previous = previousFull * proRateFactor;

      return {
        ...s,
        current,
        previous,
      };
    });
  }, [categoryBreakdown, prevTotals.catTotals, catMap, proRateFactor]);

  const spotlightBreakdown = useMemo(() => {
    if (!selectedSpotlight) return [];
    const map = new Map<string, number>();
    for (const tx of monthTxns) {
      if (!matchesSpotlightCategory(tx, selectedSpotlight.kw)) continue;
      const key = canonicaliseMerchant(tx.merchant || tx.description || '');
      map.set(key, (map.get(key) || 0) + Math.abs(baseAmt(tx)));
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [selectedSpotlight, monthTxns, catMap, isFixedTx]);



  // Donut segments
  const donutSegments = categoryBreakdown.slice(0, 8).map(c => ({
    color: c.color,
    value: c.total,
    label: c.name,
  }));

  const maxDaily = Math.max(...dailyData.map(d => d.essential + d.fun), 1);

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
      <div className="flex items-center justify-between">
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Monthly Overview</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setSelectedMonth(m => subMonths(m, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[140px] text-center">{monthLabel}</span>
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

      {/* Super Clear Cash Flow Breakdown Card */}
      {(() => {
        let poolSavingsMonthly = 0;
        const now = new Date();
        for (const g of (finance.goals || [])) {
          if ((g as any)?.is_stash) continue;
          const targetBase = finance.convertToBase ? finance.convertToBase(g.target_amount || 0, g.currency) : (g.target_amount || 0);
          const assignedBase = finance.convertToBase ? finance.convertToBase(g.assigned_amount || 0, g.currency) : (g.assigned_amount || 0);
          const remainingBase = Math.max(0, targetBase - assignedBase);
          if (remainingBase <= 0.01) continue;
          if (g.deadline) {
            const daysLeft = Math.max(1, Math.ceil((new Date(g.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
            const weeksLeft = Math.max(1, daysLeft / 7);
            const weeklyRequired = remainingBase / weeksLeft;
            poolSavingsMonthly += weeklyRequired * 4.33;
          } else if (g.percent_allocation && g.percent_allocation > 0) {
            poolSavingsMonthly += (g.percent_allocation / 100) * 400;
          }
        }
        const expectedIncomeVal = assumptions?.expected_monthly_income
          ? assumptions.expected_monthly_income
          : (assumptions?.gross_annual_salary
            ? (calcTakeHome({
                grossAnnual: assumptions.gross_annual_salary || 0,
                pensionPercent: assumptions.pension_percent || 0,
                studentLoanPlan: assumptions.student_loan_plan as any,
              })?.netMonthly || 0)
            : 0);

        return (
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
        );
      })()}

      {/* KPI Cards — candy bento style */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {([
          {
            label: 'Total Spent',
            value: fmt(totalSpent),
            icon: DollarSign,
            sub: <span className="flex items-center gap-1">{trendIcon(totalSpent, prevTotalsProrated.total)} {trendPercent(totalSpent, prevTotalsProrated.total)} vs last month {isCurrentMonth ? `(day ${daysElapsed})` : ''}</span>,
            meta: `Budget: ${fmt(monthlyTotalBudget)}`,
            border: '#FF2EB8',
            shadow: 'rgba(255,46,184,0.20)',
            iconBg: '#FFE0F1',
            iconColor: '#FF2EB8',
            valueColor: '#FF2EB8',
            over: false,
          },
          {
            label: 'Essentials',
            value: fmt(essentialSpent),
            icon: ShoppingCart,
            sub: <span className="flex items-center gap-1">{trendIcon(essentialSpent, prevTotalsProrated.essential)} {trendPercent(essentialSpent, prevTotalsProrated.essential)} vs last month {isCurrentMonth ? `(day ${daysElapsed})` : ''}</span>,
            meta: `Budget: ${fmt(monthlyEssentialBudget)}`,
            border: '#A855F7',
            shadow: 'rgba(168,85,247,0.20)',
            iconBg: '#F3E8FF',
            iconColor: '#A855F7',
            valueColor: '#A855F7',
            over: essentialSpent > monthlyEssentialBudget,
          },
          {
            label: 'Fun Money',
            value: fmt(funSpent),
            icon: PartyPopper,
            sub: <span className="flex items-center gap-1">{trendIcon(funSpent, prevTotalsProrated.fun)} {trendPercent(funSpent, prevTotalsProrated.fun)} vs last month {isCurrentMonth ? `(day ${daysElapsed})` : ''}</span>,
            meta: `Budget: ${fmt(monthlyFunBudget)}`,
            border: '#22C55E',
            shadow: 'rgba(34,197,94,0.22)',
            iconBg: '#DCFCE7',
            iconColor: '#166534',
            valueColor: '#22C55E',
            over: funSpent > monthlyFunBudget,
          },
          {
            label: 'Fixed Bills',
            value: fmt(fixedMonthly),
            icon: Lock,
            sub: <span className="text-slate-500">{fmt(fixedSpent)} paid · {fmt(Math.max(0, fixedMonthly - fixedSpent))} remaining</span>,
            meta: `Committed monthly total`,
            border: '#FF7AD1',
            shadow: 'rgba(255,122,209,0.22)',
            iconBg: '#FFF0F8',
            iconColor: '#FF2EB8',
            valueColor: '#FF7AD1',
            over: false,
          },
        ] as const).map((c) => {
          const Icon = c.icon;
          const isOver = c.over;
          return (
            <div
              key={c.label}
              className="rounded-2xl border-2 bg-white p-4 sm:p-5 flex flex-col gap-2 transition-transform hover:-translate-y-0.5"
              style={{
                borderColor: isOver ? '#DC2626' : c.border,
                boxShadow: `4px 4px 0 ${isOver ? 'rgba(220,38,38,0.20)' : c.shadow}`,
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: c.iconBg }}
                >
                  <Icon className="w-4 h-4" style={{ color: c.iconColor }} />
                </div>
                <p
                  className="text-[10px] font-display font-bold uppercase tracking-[0.14em]"
                  style={{ color: isOver ? '#DC2626' : c.iconColor }}
                >
                  {c.label}
                </p>
              </div>
              <div
                className="font-display font-black tabular-nums text-2xl sm:text-3xl leading-none"
                style={{ color: isOver ? '#DC2626' : c.valueColor }}
              >
                {c.value}
              </div>
              <p className="text-[11px] font-semibold text-slate-700">{c.meta}</p>
              <div className="text-[11px] text-slate-500">{c.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Pace / Projection Widget */}
      {(() => {
        const overBudget = projectedDiff > 0;
        const paceBorder = overBudget ? '#DC2626' : '#22C55E';
        const paceShadow = overBudget ? 'rgba(220,38,38,0.20)' : 'rgba(34,197,94,0.22)';
        const paceTint = overBudget ? '#FEE2E2' : '#DCFCE7';
        const paceAccent = overBudget ? '#DC2626' : '#166534';
        return (
          <div
            className="rounded-2xl border-2 bg-white p-4 sm:p-5"
            style={{ borderColor: paceBorder, boxShadow: `4px 4px 0 ${paceShadow}` }}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: paceTint }}>
                  <Gauge className="w-5 h-5" style={{ color: paceAccent }} />
                </div>
                <div>
                  <p className="text-[10px] font-display font-bold uppercase tracking-[0.14em]" style={{ color: paceAccent }}>
                    Monthly Pace
                  </p>
                  <p className="text-xs text-slate-500">
                    {isCurrentMonth
                      ? `Day ${daysElapsed} of ${daysInMonth} — ${daysRemaining} left`
                      : `Month complete (${daysInMonth} days)`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openBudgetDialog}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50"
              >
                <Pencil className="w-3 h-3" />
                Edit budget
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Spent so far</p>
                <p className="text-2xl font-display font-black tabular-nums text-slate-900 mt-1">{fmt(totalSpent)}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{fmt(dailyVariablePace)}/day var pace</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Projected total</p>
                <p className="text-2xl font-display font-black tabular-nums mt-1" style={{ color: paceAccent }}>
                  {fmt(projectedSpend)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Budget {fmt(monthlyTotalBudget)}
                  {budgetOverride == null || budgetOverride === '' ? (
                    <span className="block text-[10px] text-slate-400 font-medium">
                      Auto: {fmt(fixedMonthly)} Bills + {fmt(monthlyEssentialBudget)} Ess + {fmt(monthlyFunBudget)} Fun
                    </span>
                  ) : (
                    <span className="block text-[10px] text-indigo-600 font-medium">Custom override</span>
                  )}
                </p>
              </div>
              <div className="rounded-xl p-3" style={{ background: paceTint }}>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: paceAccent }}>
                  {overBudget ? 'Projected over by' : 'Projected under by'}
                </p>
                <p className="text-2xl font-display font-black tabular-nums mt-1" style={{ color: paceAccent }}>
                  {fmt(Math.abs(projectedDiff))}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: paceAccent }}>
                  {overBudget
                    ? `Cut ${fmt(daysRemaining > 0 ? projectedDiff / daysRemaining : 0)}/day to stay on track`
                    : `You've got ${fmt(daysRemaining > 0 ? Math.abs(projectedDiff) / daysRemaining : 0)}/day of headroom`}
                </p>
              </div>
            </div>

            {/* Progress bars: expected pace vs actual spend */}
            <div className="mt-4 space-y-2.5">
              <div>
                <div className="flex justify-between text-[11px] font-semibold text-slate-600 mb-1">
                  <span>Pace target (incl. fixed bills)</span>
                  <span className="tabular-nums">{expectedPct.toFixed(0)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-slate-400" style={{ width: `${Math.min(100, expectedPct)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[11px] font-semibold mb-1" style={{ color: paceAccent }}>
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

      {/* Category Spotlight — visually distinct band */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-muted/40 via-background to-muted/20 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Where the money went</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">Tap a tile to see merchants</p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-2 py-1 rounded-full border border-border/60">
            {monthLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {spotlight.map(s => {
            const palette: Record<string, { bg: string; ring: string; icon: string; value: string }> = {
              supermarkets: { bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', icon: 'text-emerald-500 bg-emerald-500/15', value: 'text-emerald-600 dark:text-emerald-400' },
              pharmacies:   { bg: 'bg-sky-500/10',     ring: 'ring-sky-500/30',     icon: 'text-sky-500 bg-sky-500/15',         value: 'text-sky-600 dark:text-sky-400' },
              transport:    { bg: 'bg-amber-500/10',   ring: 'ring-amber-500/30',   icon: 'text-amber-600 bg-amber-500/15',     value: 'text-amber-600 dark:text-amber-400' },
              eatingout:    { bg: 'bg-rose-500/10',    ring: 'ring-rose-500/30',    icon: 'text-rose-500 bg-rose-500/15',       value: 'text-rose-600 dark:text-rose-400' },
            };
            const p = palette[s.key];
            const Icon = s.icon;
            const trendDown = s.previous > 0 && s.current < s.previous;
            return (
              <button
                key={s.key}
                onClick={() => setSelectedSpotlight(s)}
                className={`group relative text-left rounded-xl p-3 ${p.bg} ring-1 ${p.ring} hover:ring-2 transition-all active:scale-[0.98] min-h-[44px]`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${p.icon}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/80 truncate">
                    {s.label}
                  </span>
                </div>
                <div className={`text-2xl font-black tabular-nums leading-none ${p.value}`}>
                  {fmt(s.current)}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground truncate">
                    was {fmt(s.previous)}
                  </span>
                  {s.previous > 0 && (
                    <span className={`font-semibold tabular-nums ${trendDown ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                      {trendPercent(s.current, s.previous)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Other categories — everything NOT already in the 4 spotlight tiles */}
      {(() => {
        const otherCats = categoryBreakdown;
        console.log("otherCats array:", otherCats);
        return (
          <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-muted/40 via-background to-muted/20 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">All categories</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">Every category with spend this month · tap for merchants</p>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-2 py-1 rounded-full border border-border/60">
                {otherCats.length} {otherCats.length === 1 ? 'category' : 'categories'}
              </span>
            </div>
            {otherCats.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No other categorised spend yet this month.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {otherCats.map(c => {
                  const share = totalSpent > 0 ? (c.total / totalSpent) * 100 : 0;
                  return (
                    <button
                      key={c.catId}
                      onClick={() => setSelectedCategory({ catId: c.catId, name: c.name, color: c.color })}
                      className="group text-left rounded-xl p-3 bg-white/70 border border-border/50 hover:border-foreground/20 hover:shadow-sm transition-all active:scale-[0.98] min-h-[44px]"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/80 truncate">
                          {c.name}
                        </span>
                        {c.isEssential && (
                          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300">
                            Ess
                          </span>
                        )}
                      </div>
                      <div className="text-xl font-black tabular-nums leading-none" style={{ color: c.color }}>
                        {fmt(c.total)}
                      </div>
                      <div className="mt-2 h-1 rounded-full bg-black/5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: c.color }} />
                      </div>
                      <div className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
                        {share.toFixed(0)}% of month
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Category merchant breakdown dialog */}
      <Dialog open={!!selectedCategory} onOpenChange={() => setSelectedCategory(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCategory && (
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedCategory.color }} />
              )}
              {selectedCategory?.name} · merchants
            </DialogTitle>
            <DialogDescription>
              Total spent this month: {selectedCategory ? fmt(categoryBreakdown.find(c => c.catId === selectedCategory.catId)?.total || 0) : fmt(0)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] -mr-4 pr-4">
            <div className="space-y-1">
              {categoryMerchantBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching transactions this month.</p>
              ) : (
                categoryMerchantBreakdown.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/40 hover:bg-muted/60 transition-colors"
                  >
                    <span className="text-sm font-medium text-foreground truncate pr-4">{item.name}</span>
                    <span className="text-sm font-black tabular-nums whitespace-nowrap">{fmt(item.total)}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>


      {/* Spotlight Breakdown Dialog */}
      <Dialog open={!!selectedSpotlight} onOpenChange={() => setSelectedSpotlight(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedSpotlight && <selectedSpotlight.icon className="w-4 h-4" />}
              {selectedSpotlight?.label} breakdown
            </DialogTitle>
            <DialogDescription>
              Total spent this month: {selectedSpotlight ? fmt(spotlight.find(s => s.key === selectedSpotlight.key)?.current || 0) : fmt(0)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] -mr-4 pr-4">
            <div className="space-y-1">
              {spotlightBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching transactions this month.</p>
              ) : (
                spotlightBreakdown.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/40 hover:bg-muted/60 transition-colors"
                  >
                    <span className="text-sm font-medium text-foreground truncate pr-4">{item.name}</span>
                    <span className="text-sm font-black tabular-nums whitespace-nowrap">{fmt(item.total)}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>




      {/* Net Budget Card */}
      <Card className="metric-card">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Net (Budget vs Actual)</p>
            <p className={`text-xl font-black tracking-tight ${netBudget >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
              {netBudget >= 0 ? '+' : ''}{fmt(netBudget)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{fmtGbp(netBudget)}</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {trendIcon(totalSpent, prevTotals.total)}
            <span>{trendPercent(totalSpent, prevTotals.total)} total spend vs last month</span>
          </div>
        </CardContent>
      </Card>

      {/* Runway Visual */}
      {snapshot && (
        <Card className="metric-card">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Financial Runway</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-black tracking-tight text-foreground">
                  {(() => {
                    const rw = Math.floor(snapshot.runwayWeeks);
                    const months = Math.floor(rw / 4.33);
                    const weeks = rw - Math.round(months * 4.33);
                    return months > 0
                      ? `${months}mo ${weeks > 0 ? `${weeks}w` : ''}`
                      : `${rw}w`;
                  })()}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  until {format(addWeeks(new Date(), Math.floor(snapshot.runwayWeeks)), 'MMM do, yyyy')}
                </p>
              </div>
            </div>

            {(() => {
              const runwayMonths = snapshot.runwayWeeks / 4.33;
              const maxMonths = Math.max(12, Math.ceil(runwayMonths) + 2);
              const fillPct = Math.min((runwayMonths / maxMonths) * 100, 100);
              const dangerZone = (3 / maxMonths) * 100;
              const cautionZone = (6 / maxMonths) * 100;
              const safeColor = runwayMonths >= 6 ? 'bg-emerald-500' : runwayMonths >= 3 ? 'bg-amber-400' : 'bg-destructive';

              return (
                <div className="space-y-2">
                  <div className="relative h-8 rounded-lg overflow-hidden bg-muted/30">
                    <div className="absolute inset-y-0 left-0 bg-destructive/10 border-r border-destructive/30" style={{ width: `${dangerZone}%` }} />
                    <div className="absolute inset-y-0 bg-amber-400/10 border-r border-amber-400/30" style={{ left: `${dangerZone}%`, width: `${cautionZone - dangerZone}%` }} />
                    <div className="absolute inset-y-0 bg-emerald-500/8" style={{ left: `${cautionZone}%`, right: 0 }} />
                    <div className={`absolute inset-y-0 left-0 ${safeColor} transition-all duration-700 ease-out`} style={{ width: `${fillPct}%`, opacity: 0.85 }} />
                    {Array.from({ length: maxMonths }, (_, i) => i + 1).map(m => {
                      const pos = (m / maxMonths) * 100;
                      const isKey = m === 3 || m === 6 || m === 12;
                      return pos < 98 ? (
                        <div key={m} className="absolute top-0 bottom-0" style={{ left: `${pos}%` }}>
                          <div className={`w-px h-full ${isKey ? 'bg-foreground/20' : 'bg-foreground/8'}`} />
                        </div>
                      ) : null;
                    })}
                  </div>

                  <div className="relative h-4">
                    {[3, 6, 9, 12].filter(m => m <= maxMonths).map(m => (
                      <span key={m} className="absolute text-[9px] font-semibold text-muted-foreground/60 -translate-x-1/2" style={{ left: `${(m / maxMonths) * 100}%` }}>
                        {m}mo
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/50">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Living Pool</p>
                      <p className="text-sm font-black text-foreground">{fmt(snapshot.livingPool)}</p>
                      <p className="text-[10px] text-muted-foreground">{fmtGbp(snapshot.livingPool)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Monthly Burn</p>
                      <p className="text-sm font-black text-foreground">{fmt(snapshot.totalWeeklyBurn * 4.33)}</p>
                      <p className="text-[10px] text-muted-foreground">{fmtGbp(snapshot.totalWeeklyBurn * 4.33)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">w/ Emergency</p>
                      <p className="text-sm font-black text-foreground">
                        {(() => {
                          const rw = Math.floor(snapshot.runwayWithEmergencyWeeks);
                          const months = Math.floor(rw / 4.33);
                          const weeks = rw - Math.round(months * 4.33);
                          return months > 0 ? `${months}mo ${weeks > 0 ? `${weeks}w` : ''}` : `${rw}w`;
                        })()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        until {format(addWeeks(new Date(), Math.floor(snapshot.runwayWithEmergencyWeeks)), 'MMM do')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Category Breakdown with Donut */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Donut */}
        <Card className="metric-card">
          <CardContent className="p-5 flex flex-col items-center">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Where It Went</p>
            <MultiSegmentDonut
              segments={donutSegments}
              total={totalSpent}
              centerTop={fmt(totalSpent)}
              centerBottom="total"
              size={160}
            />
            <div className="flex flex-wrap gap-2 mt-4 justify-center">
              {donutSegments.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Category Lists */}
        <div className="space-y-4">
          {/* Essentials */}
          <Card className="metric-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <ShoppingCart className="w-3.5 h-3.5" /> Essentials
                </p>
                <Badge variant="secondary" className="text-[10px]">{fmt(essentialSpent)}</Badge>
              </div>
              <div className="space-y-2">
                {essentialCats.length === 0 && <p className="text-xs text-muted-foreground">No essential spending this month</p>}
                {essentialCats.map(c => (
                  <div key={c.catId} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-sm">{c.name}</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{fmt(c.total)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Fun */}
          <Card className="metric-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <PartyPopper className="w-3.5 h-3.5" /> Fun Money
                </p>
                <Badge variant="secondary" className="text-[10px]">{fmt(funSpent)}</Badge>
              </div>
              <div className="space-y-2">
                {funCats.length === 0 && <p className="text-xs text-muted-foreground">No fun spending this month</p>}
                {funCats.map(c => (
                  <div key={c.catId} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-sm">{c.name}</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{fmt(c.total)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Daily Spending Chart */}
      <Card className="metric-card">
        <CardContent className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Daily Spending</p>
          <div className="flex items-end gap-px h-32">
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
                    "flex-1 flex flex-col items-center justify-end h-full group relative cursor-pointer hover:bg-slate-100/50 rounded-sm p-0.5 transition-all",
                    isSelected && "bg-slate-200/60 ring-1 ring-primary"
                  )}
                  title={`Click to view transactions for ${format(monthStart, 'MMM')} ${i + 1}`}
                >
                  {/* Tooltip */}
                  {total > 0 && (
                    <div className="absolute -top-8 bg-popover border border-border rounded px-1.5 py-0.5 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap">
                      {fmt(total)}
                    </div>
                  )}
                  <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                    {funH > 0 && (
                      <div
                        className="w-full rounded-t-sm bg-emerald-500/80 group-hover:brightness-110"
                        style={{ height: `${funH}%`, minHeight: funH > 0 ? 2 : 0 }}
                      />
                    )}
                    {essH > 0 && (
                      <div
                        className="w-full bg-primary/80 group-hover:brightness-110"
                        style={{
                          height: `${essH}%`,
                          minHeight: essH > 0 ? 2 : 0,
                          borderRadius: funH > 0 ? 0 : '2px 2px 0 0',
                        }}
                      />
                    )}
                  </div>
                  <span className={`text-[8px] mt-1 tabular-nums ${isToday ? 'font-bold text-primary' : 'text-muted-foreground/50'}`}>
                    {i + 1}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 justify-center">
            <div className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-full bg-primary/80" />
              <span className="text-muted-foreground">Essentials</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
              <span className="text-muted-foreground">Fun</span>
            </div>
          </div>
        </CardContent>
      </Card>

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
