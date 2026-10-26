import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import type { FinanceGoal, FinanceTransaction, FinanceAccount } from '@/hooks/useFinanceData';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import type { WeeklyBoost } from '@/hooks/useWeeklyBoosts';
import {
  startOfMonth, endOfMonth, addMonths,
  format, isBefore
} from 'date-fns';
import {
  Lock, CheckCircle2, ShoppingCart, PartyPopper,
  PiggyBank, ArrowDownRight, ArrowUpRight, ChevronDown,
  ChevronUp, Calendar, Info, Layers, Sparkles
} from 'lucide-react';
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
  accounts?: FinanceAccount[];
  trips?: FinanceTrip[];
  boosts?: WeeklyBoost[];
  emergencyFloor?: number;
  totalLiquidCash?: number;
  stashBalance?: number;
  convertToBase: (amount: number, currency: string) => number;
}

interface PotRowData {
  id: string;
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
    return { emoji: '✈️', color: color || '#0EA5E9', badge: 'Travel' };
  }
  if (lower.includes('visa')) {
    return { emoji: '🛂', color: color || '#8B5CF6', badge: 'Legal' };
  }
  if (lower.includes('amsterdam')) {
    return { emoji: '🚲', color: color || '#F59E0B', badge: 'City Trip' };
  }
  if (lower.includes('xmas') || lower.includes('christmas')) {
    return { emoji: '🎄', color: color || '#EF4444', badge: 'Holiday' };
  }
  if (lower.includes('emergency')) {
    return { emoji: '🛡️', color: color || '#10B981', badge: 'Emergency Buffer' };
  }
  if (lower.includes('stash')) {
    return { emoji: '⚡', color: color || '#EC4899', badge: 'Shock Absorber' };
  }
  return { emoji: '🎯', color: color || '#6366F1', badge: 'Goal Pot' };
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
  accounts = [],
  trips = [],
  boosts = [],
  emergencyFloor = 1000,
  totalLiquidCash = 0,
  stashBalance = 0,
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
  // Pot Ledger Data Calculation
  // -------------------------------------------------------------
  const potLedgerData = useMemo(() => {
    const list: PotRowData[] = [];
    const seenStash = { handled: false };
    const seenEmergency = { handled: false };

    // Total liquid cash across accounts
    const effectiveTotalCash = totalLiquidCash > 0
      ? totalLiquidCash
      : accounts.filter(a => !(a as any).exclude_from_totals).reduce((s, a) => s + convertToBase(a.balance || 0, a.currency), 0);

    // Sum assigned across standard goals (excluding emergency & stash)
    const assignedOtherGoals = goals
      .filter(g => !(g as any).is_stash && !(g as any).is_emergency && !g.name.toLowerCase().includes('emergency') && !g.name.toLowerCase().includes('stash'))
      .reduce((s, g) => s + convertToBase(g.assigned_amount || 0, g.currency), 0);
    const unassignedCash = Math.max(0, effectiveTotalCash - assignedOtherGoals);

    // Target emergency floor
    const targetEm = emergencyFloor > 0 ? emergencyFloor : 1000;

    // Helper: compute monthly delta for a goal in any given month mDate
    const getMonthDeltaForGoal = (g: FinanceGoal, mDate: Date) => {
      const mStart = startOfMonth(mDate);
      const mEnd = endOfMonth(mDate);
      const mKey = format(mDate, 'yyyy-MM');
      const isEmergency = (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency');
      const isStash = (g as any).is_stash === true || g.name.toLowerCase().includes('stash');

      // 1. Linked Trip transactions (if any)
      const linkedTrip = trips.find(t => t.goal_id === g.id);

      // 2. Direct goal transactions + intelligent description matching
      const goalTxs = transactions.filter(t => {
        if ((t as any).goal_id === g.id) return true;
        if (linkedTrip && ((t as any).trip_id === linkedTrip.id)) return true;

        const raw = `${t.merchant || ''} ${t.description || ''} ${(t as any).raw?.message || ''}`.toLowerCase();
        if (isEmergency) {
          return raw.includes('emergency') || (raw.includes('saving') && (t.is_transfer || t.amount > 0));
        }
        if (isStash) {
          return raw.includes('stash');
        }
        return false;
      });

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
            const addedAmt = Math.abs(bAmt);
            txInflow += addedAmt;
            monthTxActivity.push({
              id: t.id,
              description: t.merchant || t.description || 'Deposit to pot',
              amount: addedAmt,
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

      // 3. Boosts in this month
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

      // 4. Saved pot plan or Policy engine monthly allocation
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

      if (planOrPolicyAlloc === 0 && !isStash && !isEmergency) {
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

    // -------------------------------------------------------------
    // Process Goals
    // -------------------------------------------------------------
    for (const g of goals) {
      const isStash = (g as any).is_stash === true || g.name.toLowerCase().includes('stash');
      const isEmergency = (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency');

      // Deduplicate multiple stash or emergency goals
      if (isStash && seenStash.handled) continue;
      if (isEmergency && seenEmergency.handled) continue;
      if (isStash) seenStash.handled = true;
      if (isEmergency) seenEmergency.handled = true;

      const visuals = getPotVisuals(g.name, g.color);
      let targetBase = convertToBase(g.target_amount || 0, g.currency);

      // Emergency Fund target & current funding resolution
      let currentAssigned = convertToBase(g.assigned_amount || 0, g.currency);
      if (isEmergency) {
        targetBase = targetEm;
        const allEmGoals = goals.filter(x => (x as any).is_emergency === true || x.name.toLowerCase().includes('emergency'));
        const emAssignedSum = allEmGoals.reduce((s, x) => s + convertToBase(x.assigned_amount || 0, x.currency), 0);
        
        // Funded by explicitly assigned funds OR liquid unassigned cash buffer
        currentAssigned = Math.max(
          emAssignedSum,
          Math.min(targetEm, unassignedCash)
        );
      }

      // Savings Stash resolution
      if (isStash) {
        const allStashes = goals.filter(x => (x as any).is_stash === true || x.name.toLowerCase().includes('stash'));
        const stashAssignedSum = allStashes.reduce((s, x) => s + convertToBase(x.assigned_amount || 0, x.currency), 0);
        // Excess cash above emergency floor flows to stash
        const stashExcess = Math.max(0, unassignedCash - targetEm);
        currentAssigned = Math.max(stashBalance, stashAssignedSum, stashExcess);
        if (targetBase <= 0 || targetBase === 9999) {
          targetBase = 0; // Open-ended shock absorber
        }
      }

      const selectedMonthData = getMonthDeltaForGoal(g, selectedMonth);

      // If funds were situated this month and no prior activity:
      const mStart = startOfMonth(selectedMonth);
      const isCreatedThisMonth = g.created_at && new Date(g.created_at) >= mStart;

      if ((isEmergency || isStash) && currentAssigned > 0 && selectedMonthData.contributions <= 0) {
        selectedMonthData.contributions = currentAssigned;
        selectedMonthData.netDelta = currentAssigned;
      }

      let startBalance = 0;
      let endBalance = 0;

      if (isCurrentMonth) {
        endBalance = currentAssigned;
        // If created this month or newly situated, start balance is 0 and difference is the situated amount
        if (isCreatedThisMonth || selectedMonthData.netDelta >= currentAssigned) {
          startBalance = 0;
          selectedMonthData.netDelta = endBalance;
        } else {
          startBalance = Math.max(0, currentAssigned - selectedMonthData.netDelta);
        }
      } else if (isPastMonth) {
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
      if (isEmergency) {
        deadlineLabel = 'Ongoing Reserve';
      } else if (isStash) {
        deadlineLabel = 'Shock Absorber';
      } else if (g.deadline) {
        try {
          deadlineLabel = format(new Date(g.deadline), 'd MMM yyyy');
        } catch {
          deadlineLabel = g.deadline;
        }
      }

      list.push({
        id: g.id,
        name: isEmergency ? 'Emergency Fund' : (isStash ? 'Savings Stash' : g.name),
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

    // -------------------------------------------------------------
    // Fallback: If Emergency Fund was completely missing from goals
    // -------------------------------------------------------------
    if (!seenEmergency.handled) {
      const emBalance = Math.min(targetEm, unassignedCash);

      list.push({
        id: '__emergency_virtual__',
        name: 'Emergency Fund',
        emoji: '🛡️',
        badge: 'Emergency Buffer',
        accentColor: '#10B981',
        targetBase: targetEm,
        startBalance: 0,
        contributions: emBalance,
        spend: 0,
        netDelta: emBalance,
        endBalance: emBalance,
        progressPct: targetEm > 0 ? Math.min(100, (emBalance / targetEm) * 100) : 100,
        isCompleted: emBalance >= targetEm,
        deadlineLabel: 'Ongoing Reserve',
        activityTransactions: [],
      });
    }

    // -------------------------------------------------------------
    // Fallback: If Savings Stash was completely missing from goals
    // -------------------------------------------------------------
    if (!seenStash.handled) {
      const stashBal = Math.max(stashBalance, Math.max(0, unassignedCash - targetEm));
      list.push({
        id: '__stash_virtual__',
        name: 'Savings Stash',
        emoji: '⚡',
        badge: 'Shock Absorber',
        accentColor: '#EC4899',
        targetBase: 0,
        startBalance: 0,
        contributions: stashBal,
        spend: 0,
        netDelta: stashBal,
        endBalance: stashBal,
        progressPct: 100,
        isCompleted: true,
        deadlineLabel: 'Shock Absorber',
        activityTransactions: [],
      });
    }

    // Sort order:
    // 1. Featured pots (Europe, Visa, Amsterdam, Xmas)
    // 2. Emergency Fund
    // 3. Other goals
    // 4. Savings Stash
    return list.sort((a, b) => {
      const getPriority = (name: string) => {
        const l = name.toLowerCase();
        if (l.includes('europe') || l.includes('euro')) return 1;
        if (l.includes('visa')) return 2;
        if (l.includes('amsterdam')) return 3;
        if (l.includes('xmas') || l.includes('christmas')) return 4;
        if (l.includes('emergency')) return 5;
        if (l.includes('stash')) return 9;
        return 6;
      };
      return getPriority(a.name) - getPriority(b.name);
    });
  }, [goals, selectedMonth, transactions, trips, boosts, isCurrentMonth, isPastMonth, convertToBase, emergencyFloor, totalLiquidCash, stashBalance, incomeTotal, now, accounts]);

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
    <div className="space-y-4 pt-2">
      {/* ========================================================= */}
      {/* UNIFIED ZERO-BASED CASH FLOW & POT BREAKDOWN CARD          */}
      {/* ========================================================= */}
      <Card className="rounded-[2rem] border-slate-200/90 shadow-sm overflow-hidden bg-white">
        <CardContent className="p-5 sm:p-7 space-y-6">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#FF2EB8] to-[#FF7AD1] flex items-center justify-center text-white shadow-md shrink-0">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                    Where Every Dollar Went in {monthLabel}
                  </h3>
                  <Badge variant="outline" className="border-pink-200 text-[#FF2EB8] bg-pink-50/70 text-[11px] font-bold">
                    {potLedgerData.length} Pots
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Complete view of income, bills, variable spending, and all savings pots (including emergency & stash).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">
                Accounted: <strong className="text-slate-900 font-bold">{fmt(totalAccountedFor)}</strong> of {fmt(incomeTotal)}
              </span>
            </div>
          </div>

          {/* 5 Cash Flow Pillars */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {/* 1. Total Inflow */}
            <div className="col-span-2 sm:col-span-1 rounded-2xl p-4 bg-emerald-500/10 border border-emerald-500/20 flex flex-col justify-between">
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

            {/* 5. Savings Pots */}
            <div className="col-span-2 sm:col-span-1 rounded-2xl p-4 bg-pink-50 border-2 border-pink-200 flex flex-col justify-between shadow-2xs">
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
                Protected pools
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

          {/* ========================================================= */}
          {/* SIMPLE VIEW OF ALL THE POTS (INCLUDING EMERGENCY & STASH) */}
          {/* ========================================================= */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <PiggyBank className="w-4 h-4 text-[#FF2EB8]" />
                All Pots Ledger ({monthLabel})
              </h4>
              <span className="text-[11px] text-slate-500 font-medium">
                Click any pot to see transactions
              </span>
            </div>

            {/* Clean, Simple Table View */}
            <div className="border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 text-slate-600 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                      <th className="py-3 px-3 sm:px-4">Pot / Goal</th>
                      <th className="py-3 px-2 sm:px-3 text-right">Start of Month</th>
                      <th className="py-3 px-2 sm:px-3 text-right">Difference</th>
                      <th className="py-3 px-2 sm:px-3 text-right">End of Month</th>
                      <th className="py-3 px-3 sm:px-4 text-right">End Goal Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {potLedgerData.map(pot => {
                      const isExpanded = expandedPotId === pot.id;
                      const hasActivity = pot.activityTransactions.length > 0;

                      return (
                        <React.Fragment key={pot.id}>
                          <tr
                            onClick={() => hasActivity && setExpandedPotId(isExpanded ? null : pot.id)}
                            className={cn(
                              "transition-colors",
                              hasActivity ? "cursor-pointer hover:bg-slate-50/80" : "hover:bg-slate-50/40",
                              isExpanded && "bg-pink-50/30"
                            )}
                          >
                            {/* Pot Name + Badge */}
                            <td className="py-3 px-3 sm:px-4">
                              <div className="flex items-center gap-2.5">
                                <span className="text-base shrink-0">{pot.emoji}</span>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-slate-900">{pot.name}</span>
                                    {pot.isCompleted && (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 inline" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5">
                                    <span>{pot.badge}</span>
                                    {pot.deadlineLabel && (
                                      <>
                                        <span className="text-slate-300">•</span>
                                        <span>Target: {pot.deadlineLabel}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Start of Month */}
                            <td className="py-3 px-2 sm:px-3 text-right font-semibold text-slate-700 tabular-nums">
                              {fmt(pot.startBalance)}
                            </td>

                            {/* Difference (+ / -) */}
                            <td className="py-3 px-2 sm:px-3 text-right tabular-nums">
                              <span className={cn(
                                "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full font-bold text-[11px]",
                                pot.netDelta > 0
                                  ? "bg-emerald-50 text-emerald-700"
                                  : pot.netDelta < 0
                                  ? "bg-amber-50 text-amber-700"
                                  : "text-slate-400"
                              )}>
                                {pot.netDelta > 0 && <ArrowUpRight className="w-3 h-3 text-emerald-600 inline" />}
                                {pot.netDelta < 0 && <ArrowDownRight className="w-3 h-3 text-amber-600 inline" />}
                                {pot.netDelta > 0
                                  ? `+${fmt(pot.netDelta)}`
                                  : pot.netDelta < 0
                                  ? `−${fmt(Math.abs(pot.netDelta))}`
                                  : `£0.00`}
                              </span>
                            </td>

                            {/* End of Month */}
                            <td className="py-3 px-2 sm:px-3 text-right font-black text-slate-950 tabular-nums">
                              {fmt(pot.endBalance)}
                            </td>

                            {/* End Goal Target & Progress */}
                            <td className="py-3 px-3 sm:px-4 text-right">
                              {pot.targetBase > 0 ? (
                                <div className="inline-flex flex-col items-end min-w-[100px]">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-slate-900 tabular-nums">{fmt(pot.targetBase)}</span>
                                    <span className="text-[10px] font-black text-slate-500 tabular-nums">({pot.progressPct.toFixed(0)}%)</span>
                                  </div>
                                  <Progress
                                    value={pot.progressPct}
                                    className="h-1.5 w-24 bg-slate-100 mt-1"
                                    style={{ '--progress-background': pot.accentColor } as React.CSSProperties}
                                  />
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-500 font-medium">Dynamic Buffer</span>
                              )}
                            </td>
                          </tr>

                          {/* Expandable Activity Row (if toggled) */}
                          {isExpanded && hasActivity && (
                            <tr className="bg-slate-50/80">
                              <td colSpan={5} className="py-2.5 px-4 sm:px-6">
                                <div className="space-y-1.5 border-l-2 border-[#FF2EB8] pl-3 py-1">
                                  <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                                    {pot.activityTransactions.length} activity item{pot.activityTransactions.length === 1 ? '' : 's'} in {monthLabel}
                                  </span>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                    {pot.activityTransactions.map((tx, idx) => (
                                      <div key={tx.id || idx} className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-slate-200/70 text-xs">
                                        <div className="flex items-center gap-2 truncate mr-2">
                                          <span className={cn(
                                            "w-1.5 h-1.5 rounded-full shrink-0",
                                            tx.type === 'inflow' ? "bg-emerald-500" : "bg-amber-500"
                                          )} />
                                          <span className="truncate text-slate-700 font-medium">{tx.description}</span>
                                          <span className="text-[10px] text-slate-400 shrink-0">{format(new Date(tx.date), 'd MMM')}</span>
                                        </div>
                                        <span className={cn(
                                          "font-bold tabular-nums shrink-0",
                                          tx.type === 'inflow' ? "text-emerald-700" : "text-amber-700"
                                        )}>
                                          {tx.type === 'inflow' ? `+${fmt(tx.amount)}` : `−${fmt(tx.amount)}`}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Liquid Cash Buffer Banner */}
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
    </div>
  );
}
