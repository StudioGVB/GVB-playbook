import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import type { FinanceGoal, FinanceTransaction } from '@/hooks/useFinanceData';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import type { WeeklyBoost } from '@/hooks/useWeeklyBoosts';
import {
  startOfMonth, endOfMonth, addMonths, subMonths,
  format, isAfter, isBefore
} from 'date-fns';
import {
  Wallet, ShieldCheck, Globe, Gift, MapPin, Zap,
  PiggyBank, ArrowDownRight, ArrowUpRight, ChevronDown,
  ChevronUp, Calendar, Lock, CheckCircle2, AlertCircle,
  Sparkles, DollarSign, Layers, ShoppingCart, PartyPopper,
  Info
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface MonthlyPotLedgerProps {
  selectedMonth: Date;
  baseCurrency: string;
  incomeTotal: number;
  fixedMonthly: number;
  fixedSpent: number;
  monthlyEssentialBudget: number;
  essentialSpent: number;
  monthlyFunBudget: number;
  funSpent: number;
  paidFixedTxns?: { name: string; amount: number; date?: any }[];
  variableCategoryBreakdown?: Record<string, number>;
  goals: FinanceGoal[];
  transactions: FinanceTransaction[];
  trips?: FinanceTrip[];
  boosts?: WeeklyBoost[];
  emergencyFloor?: number;
  convertToBase: (amount: number, currency: string) => number;
}

interface PotMonthlyData {
  goal: FinanceGoal;
  name: string;
  emoji: string;
  badge: string;
  accentColor: string;
  targetBase: number;
  startBalance: number;
  contributions: number;
  spend: number;
  netDelta: number;
  endBalance: number;
  progressPct: number;
  isCompleted: boolean;
  deadlineLabel: string | null;
  activityTransactions: {
    id: string;
    description: string;
    amount: number;
    type: 'inflow' | 'outflow';
    date: string;
  }[];
}

function getPotVisuals(name: string, color?: string | null) {
  const lower = name.toLowerCase();
  if (lower.includes('europe') || lower.includes('euro')) {
    return { emoji: '✈️', color: color || '#0EA5E9', badge: 'Travel & Trips' };
  }
  if (lower.includes('visa')) {
    return { emoji: '🛂', color: color || '#8B5CF6', badge: 'Legal & Immigration' };
  }
  if (lower.includes('amsterdam')) {
    return { emoji: '🚲', color: color || '#F59E0B', badge: 'City Trip' };
  }
  if (lower.includes('xmas') || lower.includes('christmas')) {
    return { emoji: '🎄', color: color || '#EF4444', badge: 'Holiday & Seasonal' };
  }
  if (lower.includes('emergency')) {
    return { emoji: '🛡️', color: color || '#10B981', badge: 'Emergency Buffer' };
  }
  if (lower.includes('stash')) {
    return { emoji: '⚡', color: color || '#EC4899', badge: 'Shock Absorber' };
  }
  return { emoji: '🎯', color: color || '#6366F1', badge: 'Savings Pot' };
}

export default function MonthlyPotLedger({
  selectedMonth,
  baseCurrency,
  incomeTotal,
  fixedMonthly,
  fixedSpent,
  monthlyEssentialBudget,
  essentialSpent,
  monthlyFunBudget,
  funSpent,
  paidFixedTxns = [],
  variableCategoryBreakdown = {},
  goals,
  transactions,
  trips = [],
  boosts = [],
  emergencyFloor = 0,
  convertToBase,
}: MonthlyPotLedgerProps) {
  const fmt = (n: number) => formatCurrency(Math.round(n * 100) / 100, baseCurrency);
  const monthLabel = format(selectedMonth, 'MMMM yyyy');
  const now = new Date();
  const currentMonthKey = format(now, 'yyyy-MM');
  const selectedMonthKey = format(selectedMonth, 'yyyy-MM');
  const isCurrentMonth = selectedMonthKey === currentMonthKey;
  const isPastMonth = isBefore(startOfMonth(selectedMonth), startOfMonth(now));

  const [expandedPotId, setExpandedPotId] = useState<string | null>(null);
  const [showFixedDetails, setShowFixedDetails] = useState(false);
  const [showVariableDetails, setShowVariableDetails] = useState(false);

  // -------------------------------------------------------------
  // Pot Ledger Calculations
  // -------------------------------------------------------------
  const potLedgerData = useMemo(() => {
    const list: PotMonthlyData[] = [];

    // Helper: compute monthly delta for a goal in any given month mDate
    const getMonthDeltaForGoal = (g: FinanceGoal, mDate: Date) => {
      const mStart = startOfMonth(mDate);
      const mEnd = endOfMonth(mDate);
      const mKey = format(mDate, 'yyyy-MM');

      // 1. Linked Trip transactions (if any)
      const linkedTrip = trips.find(t => t.goal_id === g.id);

      // 2. Direct goal transactions
      const directTxs = transactions.filter(t => (t as any).goal_id === g.id);

      // 3. Trip spend transactions
      const tripTxs = linkedTrip
        ? transactions.filter(t => {
            if (t.is_fixed || t.is_transfer || t.amount >= 0) return false;
            if ((t as any).is_travel_spend === false) return false;
            if ((t as any).trip_id === linkedTrip.id) return true;
            if (linkedTrip.start_date && linkedTrip.end_date) {
              const txD = new Date(t.posted_at);
              const s = new Date(linkedTrip.start_date);
              const e = new Date(linkedTrip.end_date);
              e.setHours(23, 59, 59, 999);
              return txD >= s && txD <= e;
            }
            return false;
          })
        : [];

      // Combine transactions (dedup by id)
      const txMap = new Map<string, FinanceTransaction>();
      directTxs.forEach(t => txMap.set(t.id, t));
      tripTxs.forEach(t => txMap.set(t.id, t));
      const goalTxs = Array.from(txMap.values());

      // Filter txs strictly within mDate month
      let txInflow = 0;
      let txOutflow = 0;
      const monthTxActivity: {
        id: string;
        description: string;
        amount: number;
        type: 'inflow' | 'outflow';
        date: string;
      }[] = [];

      goalTxs.forEach(t => {
        const txDate = new Date(t.posted_at);
        if (txDate >= mStart && txDate <= mEnd) {
          const bAmt = baseAmt(t);
          if (t.amount > 0 || (t.is_transfer && bAmt > 0)) {
            txInflow += bAmt;
            monthTxActivity.push({
              id: t.id,
              description: t.merchant || t.description || 'Deposit to pot',
              amount: bAmt,
              type: 'inflow',
              date: t.posted_at,
            });
          } else {
            const spent = Math.abs(bAmt);
            txOutflow += spent;
            monthTxActivity.push({
              id: t.id,
              description: t.merchant || t.description || 'Spend from pot',
              amount: spent,
              type: 'outflow',
              date: t.posted_at,
            });
          }
        }
      });

      // 4. Boosts in this month
      const monthBoosts = boosts.filter(b => {
        if (b.goal_id !== g.id) return false;
        const bDate = new Date(b.week_start);
        return bDate >= mStart && bDate <= mEnd;
      });
      const boostTotal = monthBoosts.reduce((s, b) => s + b.amount, 0);
      monthBoosts.forEach(b => {
        monthTxActivity.push({
          id: b.id,
          description: b.note || 'Weekly Boost contribution',
          amount: b.amount,
          type: 'inflow',
          date: b.week_start,
        });
      });

      // 5. Saved pot plan or Policy engine monthly allocation
      let planOrPolicyAlloc = 0;
      try {
        const raw = localStorage.getItem(`gvb_pot_plan_${mKey}`);
        if (raw) {
          const p = JSON.parse(raw);
          const item = p.allocations?.find((a: any) => a.goalId === g.id);
          if (item && item.amount > 0) {
            planOrPolicyAlloc = item.amount;
          }
        }
      } catch {}

      if (planOrPolicyAlloc === 0 && !(g as any).is_stash) {
        const targetBase = convertToBase(g.target_amount || 0, g.currency);
        if (g.deadline) {
          const dl = new Date(g.deadline);
          const daysLeft = Math.max(1, Math.ceil((dl.getTime() - mStart.getTime()) / (1000 * 60 * 60 * 24)));
          const weeksLeft = Math.max(1, daysLeft / 7);
          planOrPolicyAlloc = Math.min(targetBase, (targetBase / weeksLeft) * 4.33);
        } else if (g.percent_allocation && g.percent_allocation > 0 && incomeTotal > 0) {
          planOrPolicyAlloc = Math.min(targetBase, (g.percent_allocation / 100) * incomeTotal);
        }
      }

      // Total contributed = max of direct deposits/boosts or scheduled monthly savings allocation
      const totalContributed = Math.max(txInflow + boostTotal, planOrPolicyAlloc);
      const totalSpent = txOutflow;
      const netDelta = totalContributed - totalSpent;

      return {
        contributions: totalContributed,
        spend: totalSpent,
        netDelta,
        activityTransactions: monthTxActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      };
    };

    // Process all goals
    for (const g of goals) {
      const isStash = (g as any).is_stash === true || g.name.toLowerCase().includes('stash');
      const isEmergency = (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency');
      const visuals = getPotVisuals(g.name, g.color);

      let targetBase = convertToBase(g.target_amount || 0, g.currency);
      if (isEmergency && targetBase <= 0 && emergencyFloor > 0) {
        targetBase = emergencyFloor;
      }

      const currentAssigned = convertToBase(g.assigned_amount || 0, g.currency);

      // Selected month activity
      const selectedMonthData = getMonthDeltaForGoal(g, selectedMonth);

      let startBalance = 0;
      let endBalance = 0;

      if (isCurrentMonth) {
        endBalance = currentAssigned;
        startBalance = Math.max(0, currentAssigned - selectedMonthData.netDelta);
      } else if (isPastMonth) {
        // Roll backwards: sum deltas from selectedMonth + 1 month up to current month
        let postDeltas = 0;
        let iterMonth = addMonths(startOfMonth(selectedMonth), 1);
        const curStart = startOfMonth(now);

        while (iterMonth <= curStart) {
          const d = getMonthDeltaForGoal(g, iterMonth);
          postDeltas += d.netDelta;
          iterMonth = addMonths(iterMonth, 1);
        }

        endBalance = Math.max(0, currentAssigned - postDeltas);
        startBalance = Math.max(0, endBalance - selectedMonthData.netDelta);
      } else {
        // Future month: roll forwards from current month
        let preDeltas = 0;
        let iterMonth = startOfMonth(now);
        const selStart = startOfMonth(selectedMonth);

        while (iterMonth < selStart) {
          const d = getMonthDeltaForGoal(g, iterMonth);
          preDeltas += d.netDelta;
          iterMonth = addMonths(iterMonth, 1);
        }

        startBalance = currentAssigned + preDeltas;
        endBalance = startBalance + selectedMonthData.netDelta;
      }

      const netDelta = endBalance - startBalance;
      const progressPct = targetBase > 0 ? Math.min(100, (endBalance / targetBase) * 100) : 100;
      const isCompleted = targetBase > 0 && endBalance >= targetBase;

      let deadlineLabel: string | null = null;
      if (g.deadline) {
        try {
          deadlineLabel = format(new Date(g.deadline), 'd MMM yyyy');
        } catch {
          deadlineLabel = g.deadline;
        }
      }

      list.push({
        goal: g,
        name: g.name,
        emoji: visuals.emoji,
        badge: visuals.badge,
        accentColor: visuals.color,
        targetBase,
        startBalance,
        contributions: selectedMonthData.contributions,
        spend: selectedMonthData.spend,
        netDelta,
        endBalance,
        progressPct,
        isCompleted,
        deadlineLabel,
        activityTransactions: selectedMonthData.activityTransactions,
      });
    }

    // Sort order:
    // 1. Featured pots mentioned by user (Europe, Visa, Amsterdam, Xmas)
    // 2. Other goals
    // 3. Emergency Buffer
    // 4. Savings Stash
    return list.sort((a, b) => {
      const getPriority = (name: string) => {
        const l = name.toLowerCase();
        if (l.includes('europe') || l.includes('euro')) return 1;
        if (l.includes('visa')) return 2;
        if (l.includes('amsterdam')) return 3;
        if (l.includes('xmas') || l.includes('christmas')) return 4;
        if (l.includes('emergency')) return 8;
        if (l.includes('stash')) return 9;
        return 5;
      };
      return getPriority(a.name) - getPriority(b.name);
    });
  }, [goals, selectedMonth, transactions, trips, boosts, isCurrentMonth, isPastMonth, convertToBase, emergencyFloor, incomeTotal, now]);

  // Total savings allocated across all pots in selected month
  const totalPotsFunded = useMemo(() => {
    return potLedgerData.reduce((s, p) => s + Math.max(0, p.netDelta), 0);
  }, [potLedgerData]);

  // Overall cash outflows in this month
  const variableSpent = essentialSpent + funSpent;
  const totalSpentOutflows = fixedSpent + variableSpent;
  const totalAccountedFor = totalSpentOutflows + totalPotsFunded;
  const liquidCashBuffer = incomeTotal - totalAccountedFor;

  return (
    <div className="space-y-6 pt-2">
      {/* ========================================================= */}
      {/* SECTION HEADER                                            */}
      {/* ========================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FF2EB8] to-[#FF7AD1] flex items-center justify-center text-white shadow-md shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Monthly Cash Flow & Pot Ledger
              </h2>
              <Badge variant="outline" className="border-pink-200 text-[#FF2EB8] bg-pink-50/70 text-[11px] font-bold">
                {monthLabel}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Zero-based breakdown showing exactly where every dollar went, including pot start/end balances and goal progress.
            </p>
          </div>
        </div>

        {/* Quick Month Overview Chips */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-2.5 py-1 rounded-xl font-bold flex items-center gap-1.5">
            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
            <span>Income Inflow: {fmt(incomeTotal)}</span>
          </div>
          <div className="bg-pink-50 text-pink-900 border border-pink-200/80 px-2.5 py-1 rounded-xl font-bold flex items-center gap-1.5">
            <PiggyBank className="w-3.5 h-3.5 text-[#FF2EB8]" />
            <span>Saved to Pots: {fmt(totalPotsFunded)}</span>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 1. "WHERE EVERY DOLLAR WENT" WATERFALL BREAKDOWN          */}
      {/* ========================================================= */}
      <Card className="rounded-[2rem] border-slate-200/90 shadow-sm overflow-hidden bg-white">
        <CardContent className="p-5 sm:p-7 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-[#FF2EB8]">
                Zero-Based Cash Flow
              </span>
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Where Every Dollar Went in {monthLabel}
              </h3>
            </div>
            <span className="text-xs text-slate-500">
              Total Accounted: <strong className="text-slate-800">{fmt(totalAccountedFor)}</strong> of {fmt(incomeTotal)}
            </span>
          </div>

          {/* Equation Strip / Distribution Pillars */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {/* 1. Income Inflow */}
            <div className="col-span-2 md:col-span-1 rounded-2xl p-4 bg-emerald-500/10 border border-emerald-500/20 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">1. Total Inflow</span>
                <span className="text-sm">💰</span>
              </div>
              <div className="mt-2">
                <span className="text-xl font-black text-emerald-900 tabular-nums">{fmt(incomeTotal)}</span>
                <p className="text-[11px] text-emerald-700 mt-0.5">Primary earned income</p>
              </div>
            </div>

            {/* 2. Fixed Bills */}
            <div className="rounded-2xl p-4 bg-slate-50 border border-slate-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">2. Fixed Bills</span>
                <Lock className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="mt-2">
                <span className="text-lg font-black text-slate-900 tabular-nums">{fmt(fixedSpent)}</span>
                <p className="text-[11px] text-slate-500 mt-0.5">Budget: {fmt(fixedMonthly)}</p>
              </div>
              {paidFixedTxns.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFixedDetails(!showFixedDetails)}
                  className="mt-2 text-[10px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                >
                  <span>{paidFixedTxns.length} bills</span>
                  {showFixedDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>

            {/* 3. Variable Essentials */}
            <div className="rounded-2xl p-4 bg-purple-50 border border-purple-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-purple-700">3. Essentials</span>
                <ShoppingCart className="w-3.5 h-3.5 text-purple-500" />
              </div>
              <div className="mt-2">
                <span className="text-lg font-black text-purple-950 tabular-nums">{fmt(essentialSpent)}</span>
                <p className="text-[11px] text-purple-700 mt-0.5">Groceries & transport</p>
              </div>
              {Object.keys(variableCategoryBreakdown).length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowVariableDetails(!showVariableDetails)}
                  className="mt-2 text-[10px] font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1 cursor-pointer"
                >
                  <span>Categories</span>
                  {showVariableDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>

            {/* 4. Fun & Lifestyle */}
            <div className="rounded-2xl p-4 bg-amber-50 border border-amber-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">4. Fun & Social</span>
                <PartyPopper className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="mt-2">
                <span className="text-lg font-black text-amber-950 tabular-nums">{fmt(funSpent)}</span>
                <p className="text-[11px] text-amber-700 mt-0.5">Dining, coffee, shopping</p>
              </div>
              <span className="text-[10px] font-semibold text-amber-600 mt-2">
                Allowance: {fmt(monthlyFunBudget)}
              </span>
            </div>

            {/* 5. Savings Pots & Pools */}
            <div className="col-span-2 md:col-span-1 rounded-2xl p-4 bg-pink-50 border-2 border-pink-200 flex flex-col justify-between shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-[#FF2EB8]">5. Savings Pots</span>
                <PiggyBank className="w-4 h-4 text-[#FF2EB8]" />
              </div>
              <div className="mt-2">
                <span className="text-xl font-black text-[#FF2EB8] tabular-nums">{fmt(totalPotsFunded)}</span>
                <p className="text-[11px] text-pink-700 mt-0.5">Funded across {potLedgerData.length} pots</p>
              </div>
              <span className="text-[10px] font-bold text-pink-600 mt-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#FF2EB8]" />
                Goals protected
              </span>
            </div>
          </div>

          {/* Expandable Fixed Bills List */}
          {showFixedDetails && paidFixedTxns.length > 0 && (
            <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200/80 animate-in fade-in-50 duration-200">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">
                Fixed Bills Paid in {monthLabel}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {paidFixedTxns.map((b, i) => (
                  <div key={i} className="flex items-center justify-between bg-white px-3 py-2 rounded-xl border border-slate-200/60 text-xs">
                    <span className="font-medium text-slate-700 truncate mr-2">{b.name}</span>
                    <span className="font-bold text-slate-900 tabular-nums shrink-0">{fmt(b.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expandable Variable Categories List */}
          {showVariableDetails && Object.keys(variableCategoryBreakdown).length > 0 && (
            <div className="rounded-2xl bg-purple-50/60 p-4 border border-purple-200/70 animate-in fade-in-50 duration-200">
              <h4 className="text-xs font-black text-purple-900 uppercase tracking-wider mb-2">
                Variable Spend by Category in {monthLabel}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {Object.entries(variableCategoryBreakdown).map(([catName, amt]) => (
                  <div key={catName} className="bg-white px-3 py-2 rounded-xl border border-purple-100 text-xs flex items-center justify-between">
                    <span className="text-slate-600 truncate mr-1.5">{catName}</span>
                    <span className="font-bold text-slate-900 tabular-nums">{fmt(amt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cash Flow Balance Footer Banner */}
          <div className={cn(
            "rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs",
            liquidCashBuffer >= 0
              ? "bg-slate-50 border border-slate-200 text-slate-700"
              : "bg-rose-50 border border-rose-200 text-rose-800"
          )}>
            <div className="flex items-center gap-2">
              <Info className={cn("w-4 h-4 shrink-0", liquidCashBuffer >= 0 ? "text-slate-500" : "text-rose-600")} />
              <span>
                {liquidCashBuffer >= 0 ? (
                  <>
                    <strong className="font-bold text-slate-900">Unallocated Liquid Buffer:</strong> {fmt(liquidCashBuffer)} remaining in checking/savings accounts after all expenses & pot funding.
                  </>
                ) : (
                  <>
                    <strong className="font-bold text-rose-950">Net Monthly Deficit:</strong> {fmt(Math.abs(liquidCashBuffer))} absorbed from Savings Stash / emergency liquid buffers.
                  </>
                )}
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
              {fmt(incomeTotal)} (In) − {fmt(totalSpentOutflows)} (Spend) − {fmt(totalPotsFunded)} (Pots) = {fmt(liquidCashBuffer)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ========================================================= */}
      {/* 2. SAVINGS POTS LEDGER (THE CORE SAVINGS REPORT)         */}
      {/* ========================================================= */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <PiggyBank className="w-5 h-5 text-[#FF2EB8]" />
              <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                Savings Pots & Goals Ledger
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks starting balance, monthly change (+contributions / −spent), ending balance, and progress toward your end goal for {monthLabel}.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {potLedgerData.length} Active Pots
          </span>
        </div>

        {/* Pots Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {potLedgerData.map(pot => {
            const isExpanded = expandedPotId === pot.goal.id;
            const hasActivity = pot.activityTransactions.length > 0;

            return (
              <Card
                key={pot.goal.id}
                className={cn(
                  "rounded-2xl border transition-all duration-200 overflow-hidden bg-white shadow-xs hover:shadow-md",
                  isExpanded ? "border-[#FF2EB8]/60 ring-2 ring-[#FF2EB8]/15" : "border-slate-200/90"
                )}
              >
                <CardContent className="p-4 sm:p-5 space-y-4">
                  {/* Pot Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shadow-2xs shrink-0"
                        style={{ backgroundColor: `${pot.accentColor}18`, borderColor: `${pot.accentColor}40`, borderWidth: 1 }}
                      >
                        <span>{pot.emoji}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-black text-slate-900 tracking-tight">
                            {pot.name}
                          </h4>
                          {pot.isCompleted && (
                            <Badge className="bg-emerald-500 text-white text-[9px] font-bold py-0 h-4">
                              <CheckCircle2 className="w-2.5 h-2.5 mr-1 inline" />
                              Goal Met
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-semibold text-slate-500">{pot.badge}</span>
                          {pot.deadlineLabel && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-medium">
                                <Calendar className="w-2.5 h-2.5 text-slate-400" />
                                Target: {pot.deadlineLabel}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Net Delta Pill for this month */}
                    <div className="text-right shrink-0">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black tabular-nums border",
                        pot.netDelta > 0
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : pot.netDelta < 0
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      )}>
                        {pot.netDelta > 0 && <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />}
                        {pot.netDelta < 0 && <ArrowDownRight className="w-3.5 h-3.5 text-amber-600" />}
                        {pot.netDelta > 0 ? `+${fmt(pot.netDelta)}` : pot.netDelta < 0 ? `-${fmt(Math.abs(pot.netDelta))}` : `£0.00`}
                      </span>
                      <p className="text-[9px] text-slate-400 font-medium mt-0.5">This Month</p>
                    </div>
                  </div>

                  {/* 3-Part Balance Metric Card: Start → Month Activity → End */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-50/80 rounded-xl p-3 border border-slate-200/60">
                    {/* Start Balance */}
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Start of Month
                      </span>
                      <span className="text-sm sm:text-base font-black text-slate-800 tabular-nums">
                        {fmt(pot.startBalance)}
                      </span>
                    </div>

                    {/* Activity (Difference) */}
                    <div className="border-x border-slate-200/80 px-2 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Difference
                      </span>
                      <span className={cn(
                        "text-sm sm:text-base font-black tabular-nums",
                        pot.netDelta > 0 ? "text-emerald-700" : pot.netDelta < 0 ? "text-amber-700" : "text-slate-600"
                      )}>
                        {pot.netDelta > 0 ? `+${fmt(pot.netDelta)}` : pot.netDelta < 0 ? `-${fmt(Math.abs(pot.netDelta))}` : `£0`}
                      </span>
                    </div>

                    {/* End Balance */}
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        End of Month
                      </span>
                      <span className="text-sm sm:text-base font-black text-slate-950 tabular-nums">
                        {fmt(pot.endBalance)}
                      </span>
                    </div>
                  </div>

                  {/* Progress Toward Goal Target */}
                  {pot.targetBase > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">
                          Goal Target: <strong className="text-slate-800 font-bold">{fmt(pot.targetBase)}</strong>
                        </span>
                        <span className="font-black text-slate-800 tabular-nums">
                          {pot.progressPct.toFixed(0)}%
                        </span>
                      </div>
                      <Progress
                        value={pot.progressPct}
                        className="h-2 bg-slate-100"
                        style={
                          {
                            '--progress-background': pot.accentColor,
                          } as React.CSSProperties
                        }
                      />
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>
                          {pot.endBalance >= pot.targetBase
                            ? 'Goal fully achieved!'
                            : `${fmt(pot.targetBase - pot.endBalance)} remaining`}
                        </span>
                        {pot.contributions > 0 && pot.spend > 0 && (
                          <span className="text-slate-500">
                            (+{fmt(pot.contributions)} in, −{fmt(pot.spend)} spent)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
                      <span>Open-ended reserve pot</span>
                      <span className="font-semibold text-slate-700">Liquid cushion</span>
                    </div>
                  )}

                  {/* Activity Details Toggle (if transactions or boosts exist) */}
                  {hasActivity && (
                    <div className="border-t border-slate-100 pt-2">
                      <button
                        type="button"
                        onClick={() => setExpandedPotId(isExpanded ? null : pot.goal.id)}
                        className="w-full text-left text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center justify-between cursor-pointer py-1"
                      >
                        <span className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-[#FF2EB8]" />
                          <span>{pot.activityTransactions.length} activity item{pot.activityTransactions.length === 1 ? '' : 's'} in {monthLabel}</span>
                        </span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-1.5 bg-slate-50/90 rounded-xl p-3 border border-slate-200/60 animate-in fade-in-50 duration-150">
                          {pot.activityTransactions.map((item, idx) => (
                            <div key={item.id || idx} className="flex items-center justify-between text-xs py-1 border-b border-slate-200/40 last:border-b-0">
                              <div className="flex items-center gap-2 truncate mr-2">
                                <span className={cn(
                                  "w-1.5 h-1.5 rounded-full shrink-0",
                                  item.type === 'inflow' ? "bg-emerald-500" : "bg-amber-500"
                                )} />
                                <span className="text-slate-700 font-medium truncate">{item.description}</span>
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  {format(new Date(item.date), 'd MMM')}
                                </span>
                              </div>
                              <span className={cn(
                                "font-bold tabular-nums shrink-0",
                                item.type === 'inflow' ? "text-emerald-700" : "text-amber-700"
                              )}>
                                {item.type === 'inflow' ? `+${fmt(item.amount)}` : `−${fmt(item.amount)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
