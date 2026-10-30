import { useMemo, useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses, toWeekly, FREQ_TO_WEEKLY } from '@/hooks/useFixedExpenses';
import { useFixedExpensePayments } from '@/hooks/useFixedExpensePayments';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import { computePolicySnapshot, computeActualSpendingIncome, computeWeekVariableSpend } from '@/lib/policyEngine';
import { deduplicateTransactions } from '@/lib/deduplication';
import { parseCoverMeta, planOverspendCover, planUnderspendRepay, type CoverMeta, type CoverStep } from '@/lib/overspendCover';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import { subDays, startOfDay, startOfWeek, endOfWeek, differenceInDays, format, addWeeks, subWeeks, isSameWeek, addDays } from 'date-fns';
import { Lock, ShoppingCart, PartyPopper, Zap, X, Info, TrendingDown, Calendar as CalendarIcon, Shield, Target, ChevronDown, History, Clock, Check, Plane, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { MetricCard } from '@/components/finance/MetricCard';
import { DonutChart } from '@/components/finance/DonutChart';
import { MultiSegmentDonut } from '@/components/finance/MultiSegmentDonut';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import FinancialReportExporterModal from '@/components/finance/FinancialReportExporterModal';




const BRAND_MAP = [
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

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function FinanceBudget() {
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading, update: updateAssumptions } = useFinanceAssumptions();
  const { expenses: fixedExpenses, monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll } = useFixedExpenses();
  const { boosts, totalBoostThisWeek, addBoost, removeBoost } = useWeeklyBoosts();
  const { getWeekType, weekTypeMap } = useWeekTypes();
  const { trips } = useFinanceTrips();
  const { isPaidThisPeriod, markPaid, unmarkPaid, totalPaidThisMonth } = useFixedExpensePayments();
  const navigate = useNavigate();

  const handleAddBoost = async (goalId: string, amount: number, note?: string) => {
    const goal = finance.goals.find(g => g.id === goalId);
    if (goal) {
      const currentAssigned = goal.assigned_amount || 0;
      const newAssigned = Math.max(0, currentAssigned - amount);
      await finance.updateGoal(goalId, { assigned_amount: newAssigned } as any);
    }
    await addBoost(goalId, amount, note);
  };

  const handleRemoveBoost = async (boostId: string) => {
    const boost = boosts.find(b => b.id === boostId);
    if (boost) {
      const goal = finance.goals.find(g => g.id === boost.goal_id);
      if (goal) {
        const currentAssigned = goal.assigned_amount || 0;
        await finance.updateGoal(goal.id, { assigned_amount: currentAssigned + boost.amount } as any);
      }
    }
    await removeBoost(boostId);
  };

  const wtMap = useMemo(() => weekTypeMap(), [weekTypeMap]);

  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const today = useMemo(() => new Date(), []);
  const isCurrentWeek = useMemo(() => isSameWeek(selectedDate, today, { weekStartsOn: 1 }), [selectedDate, today]);
  
  const weekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate]);
  const weekEnd = useMemo(() => endOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate]);

  const weekStartKey = useMemo(() => format(weekStart, 'yyyy-MM-dd'), [weekStart]);

  const boostAmount = useMemo(() => {
    return boosts
      .filter(b => b.week_start === weekStartKey)
      .reduce((sum, b) => sum + b.amount, 0);
  }, [boosts, weekStartKey]);

  const baseCurrency = (finance.settings?.base_currency || 'GBP').toUpperCase();
  const fxRates = {
    AUD_GBP: 0.52,
    GBP_AUD: 1.92,
    EUR_GBP: 0.85,
    GBP_EUR: 1.18,
    USD_GBP: 0.78,
    GBP_USD: 1.28,
    ...((finance.settings?.fx_rates || {}) as Record<string, number>),
  };
  const audToGbp = fxRates['AUD_GBP'] || 0.52;
  const fmt = (n: number) => formatCurrency(n, baseCurrency);
  const fmtGbp = (n: number) => formatCurrency(baseCurrency === 'GBP' ? n : n * audToGbp, 'GBP');

  // Savings Stash: find existing goal named "Savings Stash" or marked with is_stash
  const stashGoal = useMemo(() => {
    const stashes = finance.goals.filter(g => (g as any).is_stash === true || g.name.toLowerCase().includes('stash'));
    return stashes.find(g => g.currency === baseCurrency) || stashes[0];
  }, [finance.goals, baseCurrency]);
  const stashBalance = stashGoal?.assigned_amount || 0;

  const referenceDateForEngine = useMemo(() => {
    return isCurrentWeek ? today : weekStart;
  }, [isCurrentWeek, today, weekStart]);

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    const computed = computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions,
      finance.categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, boostAmount, typeof wtMap === 'function' ? wtMap() : wtMap, trips, fixedExpensesMonthlyAll,
      referenceDateForEngine
    );
    if (!isCurrentWeek && selectedDate < today) {
      const meta = parseCoverMeta(stashGoal?.description);
      const locked = meta.closed_weeks?.[weekStartKey];
      if (locked && locked.totalBudget > 0) {
        const weeklyEssentialBudget = locked.essentialBudget;
        const baseWeeklyFun = locked.baseFunBudget;
        const weeklyFunBudget = baseWeeklyFun + boostAmount;
        return {
          ...computed,
          weeklyEssentialBudget,
          baseWeeklyFun,
          weeklyFunBudget,
          baseBudgetBeforeRollover: baseWeeklyFun + boostAmount,
        };
      }
    }
    return computed;
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, boostAmount, wtMap, trips, referenceDateForEngine, isCurrentWeek, selectedDate, today, stashGoal?.description, weekStartKey]);

  // Emergency Fund Goal: find existing goal marked with is_emergency or named "Emergency"
  const emergencyGoal = useMemo(() => finance.goals.find(g => (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency')), [finance.goals]);

  // Pull from stash INTO this week's fun budget (uses existing boost system)
  const handleStashWithdraw = async () => {
    if (!stashGoal || stashBalance <= 0) return;
    const amount = Math.min(50, stashBalance);
    await handleAddBoost(stashGoal.id, amount, 'Stash top-up');
    toast.success(`Added ${fmt(amount)} from Savings Stash to this week's budget`);
  };

  const now = selectedDate;
  const dayOfWeek = isCurrentWeek 
    ? differenceInDays(today, weekStart) + 1 
    : (selectedDate < today ? 7 : 0);
  const daysLeft = isCurrentWeek 
    ? Math.max(1, 8 - dayOfWeek) 
    : (selectedDate < today ? 0 : 7);

  const currentWeekType = getWeekType(selectedDate);

  // Auto-settle previous week's performance into Savings Stash
  const settleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot || finance.loading || assumptionsLoading || !assumptions) return;
    const todayWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const prevWeekStart = startOfWeek(subDays(todayWeekStart, 1), { weekStartsOn: 1 });
    const prevWeekKey = format(prevWeekStart, 'yyyy-MM-dd');
    const SETTLE_VERSION = 6;

    const prevWeekSpend = computeWeekVariableSpend(finance.transactions, finance.categories, prevWeekStart, trips);
    const prevEssentialSpent = prevWeekSpend.essentialSpent;
    const prevFunSpent = prevWeekSpend.funSpent;
    const prevWeekBoost = boosts
      .filter(b => b.week_start === prevWeekKey)
      .reduce((sum, b) => sum + b.amount, 0);
    const prevWeekSnapshot = computePolicySnapshot(
      assumptions,
      finance.accounts,
      finance.transactions,
      finance.categories,
      finance.goals,
      finance.convertToBase,
      fixedExpensesMonthly,
      prevWeekBoost,
      typeof wtMap === 'function' ? wtMap() : wtMap,
      trips,
      fixedExpensesMonthlyAll,
      prevWeekStart,
    );

    // Strictly match last week's budget: last week's Essentials + Base Fun + last week's Boosts
    const totalBudget = prevWeekSnapshot.weeklyEssentialBudget + prevWeekSnapshot.baseWeeklyFun + prevWeekBoost;
    const totalSpent = prevEssentialSpent + prevFunSpent;
    const netDifference = Math.round((totalBudget - totalSpent) * 100) / 100;

    const meta: CoverMeta = parseCoverMeta(stashGoal?.description);
    const localKey = `stash_settled_v${SETTLE_VERSION}_${prevWeekKey}`;
    const isCurrentVersionSettled =
      meta.last_settled_week === prevWeekKey &&
      meta.settled_version === SETTLE_VERSION;

    // If already settled under v4 and the stash delta matches current netDifference, skip
    const expectedStashDelta = netDifference > 0 ? netDifference : 0;
    const deltaMatches =
      isCurrentVersionSettled &&
      Math.abs((meta.last_settled_stash_delta ?? 0) - expectedStashDelta) <= 0.02;

    if (settleRef.current === `${prevWeekKey}_${expectedStashDelta.toFixed(2)}`) return;
    if (deltaMatches) {
      settleRef.current = `${prevWeekKey}_${expectedStashDelta.toFixed(2)}`;
      localStorage.setItem(localKey, 'true');
      return;
    }

    const doSettle = async () => {
      settleRef.current = `${prevWeekKey}_${expectedStashDelta.toFixed(2)}`;
      const thisWeekKey = format(todayWeekStart, 'yyyy-MM-dd');
      let stashDelta = 0;
      let newBorrowed = { ...(meta.borrowed || {}) };
      let steps: CoverStep[] = [];
      let carryDebt = 0;
      const potDeltas: Record<string, number> = {};

      // If prevWeekKey was previously settled (e.g. under v3 before the spend calculation fix, or with an older transaction set),
      // reverse its previous stash/pot adjustments before applying the true settlement.
      if (meta.last_settled_week === prevWeekKey) {
        if (typeof meta.last_settled_stash_delta === 'number') {
          stashDelta -= meta.last_settled_stash_delta;
        }
        if (meta.last_cover?.week === prevWeekKey && Array.isArray(meta.last_cover.steps)) {
          for (const prevStep of meta.last_cover.steps) {
            if (prevStep.source === 'stash' && typeof meta.last_settled_stash_delta !== 'number') {
              stashDelta += prevStep.amount;
            } else if (prevStep.source === 'pot' && prevStep.goalId) {
              potDeltas[prevStep.goalId] = (potDeltas[prevStep.goalId] || 0) + prevStep.amount;
              newBorrowed[prevStep.goalId] = Math.max(0, Math.round(((newBorrowed[prevStep.goalId] || 0) - prevStep.amount) * 100) / 100);
              if (newBorrowed[prevStep.goalId] <= 0) delete newBorrowed[prevStep.goalId];
            } else if (prevStep.source === 'repay' && prevStep.goalId) {
              potDeltas[prevStep.goalId] = (potDeltas[prevStep.goalId] || 0) - prevStep.amount;
              newBorrowed[prevStep.goalId] = Math.round(((newBorrowed[prevStep.goalId] || 0) + prevStep.amount) * 100) / 100;
            }
          }
        }
      }

      let recordedStashDelta = 0;
      if (netDifference > 0) {
        // UNDERSPENT: 100% of weekly underspend sweeps straight into Savings Stash
        stashDelta += netDifference;
        recordedStashDelta = netDifference;
      } else if (netDifference < 0) {
        // OVERSPENT: Stash -> next week (capped) -> pots lowest priority first -> leftover debt
        const plan = planOverspendCover({
          overspend: Math.abs(netDifference),
          stash: (stashGoal as any) || null,
          nextWeekFun: snapshot.baseWeeklyFun,
          goals: finance.goals as any,
          trips: trips as any,
          meta: { ...meta, borrowed: newBorrowed },
          now: new Date(),
        });
        steps = plan.steps;
        carryDebt = plan.nextWeekDeduction + plan.leftoverDebt;
        for (const s of plan.steps) {
          if (s.source === 'stash') {
            stashDelta -= s.amount;
            recordedStashDelta -= s.amount;
          }
          if (s.source === 'pot' && s.goalId) {
            potDeltas[s.goalId] = (potDeltas[s.goalId] || 0) - s.amount;
            newBorrowed[s.goalId] = Math.round(((newBorrowed[s.goalId] || 0) + s.amount) * 100) / 100;
          }
        }
      }

      // Apply pot changes
      for (const [goalId, delta] of Object.entries(potDeltas)) {
        if (Math.abs(delta) < 0.01) continue;
        const g = finance.goals.find(x => x.id === goalId);
        if (g) await finance.updateGoal(goalId, { assigned_amount: Math.max(0, (g.assigned_amount || 0) + delta) } as any);
      }

      // Calculate post-settle Stash balance
      let nextStashAmount = Math.max(
        0,
        Math.round(((stashGoal?.assigned_amount || 0) + stashDelta) * 100) / 100
      );

      // End-of-Month Sweep: if we have entered a new calendar month relative to prevWeekStart
      // (i.e. prevWeekStart's month has now ended) and we haven't swept that month yet,
      // shift 100% of any money left in Savings Stash straight into the real "Savings" pool.
      const prevWeekMonthKey = format(prevWeekStart, 'yyyy-MM');
      const todayMonthKey = format(today, 'yyyy-MM');
      let sweptMonthKey = meta.last_swept_month;
      let lastMonthSweep = meta.last_month_sweep || null;

      if (todayMonthKey > prevWeekMonthKey && meta.last_swept_month !== prevWeekMonthKey) {
        const realSavingsGoal =
          finance.goals.find(
            g =>
              !(g as any).is_stash &&
              !(g as any).is_emergency &&
              !g.name.toLowerCase().includes('stash') &&
              !g.name.toLowerCase().includes('emergency') &&
              g.name.trim().toLowerCase() === 'savings'
          ) ||
          finance.goals.find(
            g =>
              !(g as any).is_stash &&
              !(g as any).is_emergency &&
              !g.name.toLowerCase().includes('stash') &&
              !g.name.toLowerCase().includes('emergency') &&
              g.name.toLowerCase().includes('saving')
          );

        if (realSavingsGoal && nextStashAmount > 0.01) {
          const sweptAmount = nextStashAmount;
          const oneInBase = finance.convertToBase(1, realSavingsGoal.currency);
          const nativeAdd = oneInBase === 0 ? sweptAmount : sweptAmount / oneInBase;
          await finance.updateGoal(realSavingsGoal.id, {
            assigned_amount: Math.round(((realSavingsGoal.assigned_amount || 0) + nativeAdd) * 100) / 100,
          } as any);
          nextStashAmount = 0;
          sweptMonthKey = prevWeekMonthKey;
          lastMonthSweep = {
            month: prevWeekMonthKey,
            amount: sweptAmount,
            targetGoalId: realSavingsGoal.id,
            targetGoalName: realSavingsGoal.name,
          };
          toast.success(
            `End of month! Shifted ${fmt(sweptAmount)} left in Savings Stash straight into your ${realSavingsGoal.name} pool 🎉`,
            { duration: 9000 }
          );
        } else {
          sweptMonthKey = prevWeekMonthKey;
        }
      }

      // Stash balance + metadata (settle marker, version, stash delta, closed_weeks lock, borrowed ledger, last cover summary) — always written
      const newMeta: CoverMeta = {
        ...meta,
        user_description: meta.user_description || 'Cash surplus',
        last_settled_week: prevWeekKey,
        settled_version: SETTLE_VERSION,
        last_settled_stash_delta: recordedStashDelta,
        last_swept_month: sweptMonthKey,
        last_month_sweep: lastMonthSweep,
        closed_weeks: {
          ...(meta.closed_weeks || {}),
          [prevWeekKey]: {
            essentialBudget: Math.round(prevWeekSnapshot.weeklyEssentialBudget * 100) / 100,
            baseFunBudget: Math.round(prevWeekSnapshot.baseWeeklyFun * 100) / 100,
            boost: Math.round(prevWeekBoost * 100) / 100,
            totalBudget: Math.round(totalBudget * 100) / 100,
            essentialSpent: Math.round(prevEssentialSpent * 100) / 100,
            funSpent: Math.round(prevFunSpent * 100) / 100,
            totalSpent: Math.round(totalSpent * 100) / 100,
            netDifference,
          },
        },
        borrowed: newBorrowed,
        last_cover: netDifference < 0
          ? { week: prevWeekKey, overspend: Math.abs(netDifference), steps, leftoverDebt: carryDebt }
          : null,
      };
      if (stashGoal) {
        await finance.updateGoal(stashGoal.id, {
          assigned_amount: nextStashAmount,
          is_stash: true,
          description: JSON.stringify(newMeta),
        } as any);
      } else {
        await finance.addGoal({
          name: 'Savings Stash', target_amount: 9999, currency: baseCurrency, priority: 3,
          safety_mode: 'balanced', assigned_amount: nextStashAmount, color: '#10b981', is_stash: true,
          description: JSON.stringify(newMeta),
        } as any);
      }

      // Debt for this week (engine only uses stored debt once a settle has run for this week)
      await updateAssumptions({ carry_forward_debt: carryDebt, last_debt_week: thisWeekKey }, true);

      // Summary toast
      if (netDifference < 0) {
        const parts = steps.map(s => `${fmt(s.amount)} ${s.source === 'next_week' ? 'from next week' : `from ${s.name}`}`);
        const left = carryDebt - (steps.find(s => s.source === 'next_week')?.amount || 0);
        toast.warning(`Overspent ${fmt(Math.abs(netDifference))} last week → covered ${parts.join(', ')}${left > 0.01 ? ` · ${fmt(left)} still carried` : ''}`, { duration: 10000 });
      } else if (netDifference > 0) {
        toast.success(`Underspent ${fmt(netDifference)} last week → ${fmt(netDifference)} added to Savings Stash 💰`);
      }

      localStorage.setItem(localKey, 'true');
    };

    doSettle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, finance.loading, assumptionsLoading, today, stashGoal?.id, stashGoal?.description]);

  // Fixed expenses normalized to weekly
  const fixedWeeklyItems = useMemo(() => {
    return fixedExpenses.map(e => ({
      name: e.name,
      weekly: toWeekly(e.amount, e.frequency),
      frequency: e.frequency,
    }));
  }, [fixedExpenses]);

  // Build category map
  const catMap = useMemo(() => new Map(finance.categories.map(c => [c.id, c])), [finance.categories]);

  // Essential categories from is_essential flag
  const essentialCatIds = useMemo(() => new Set(
    finance.categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)
  ), [finance.categories]);

  // Categorize transactions from last 28 days + unified weekly variable spend
  const { essentials, funCategories, allVariableCategories, essentialSpentThisWeek, funSpentThisWeek, thisWeekByCategory, thisWeekTxns, dailySpendingStacked } = useMemo(() => {
    const cutoff = startOfDay(subDays(weekEnd, 28));
    const { cleaned: transactions } = deduplicateTransactions(finance.transactions);

    const weekSummary = computeWeekVariableSpend(transactions, finance.categories, weekStart, trips);

    const spendTxns = transactions.filter(tx => {
      if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) return false;
      if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') return false;
      if ((tx as any).goal_id || (tx as any).is_travel_spend || (tx as any).trip_id) return false;
      const d = parseUkDate(tx.posted_at);
      if (d < cutoff || d > weekEnd) return false;
      const cat = catMap.get(tx.category_id || '');
      if (cat?.exclude_from_reports) return false;
      if (cat?.type === 'fixed' || cat?.type === 'income' || cat?.type === 'transfer') return false;
      if (tx.is_fixed || (tx as any).fixed_expense_id) return false;
      return true;
    });

    const grouped = new Map<string, { name: string; color: string | null; total: number; isEssential: boolean; catId: string }>();
    for (const tx of spendTxns) {
      const catId = tx.category_id || '__uncategorised';
      const cat = catMap.get(catId);
      const isEssential = essentialCatIds.has(catId);
      const existing = grouped.get(catId);
      if (existing) {
        existing.total += Math.abs(baseAmt(tx));
      } else {
        grouped.set(catId, {
          name: cat?.name || 'Uncategorised',
          color: cat?.color || null,
          total: Math.abs(baseAmt(tx)),
          isEssential,
          catId,
        });
      }
    }

    // Ensure every category with spend this week is represented
    for (const [catId, spentAmt] of weekSummary.byCategory.entries()) {
      if (!grouped.has(catId) && spentAmt > 0) {
        const cat = catMap.get(catId);
        grouped.set(catId, {
          name: cat?.name || 'Uncategorised',
          color: cat?.color || null,
          total: spentAmt,
          isEssential: essentialCatIds.has(catId),
          catId,
        });
      }
    }

    const items = Array.from(grouped.values()).map(g => ({
      ...g,
      weeklyAvg: g.total / 4,
    }));

    const essentials = items.filter(i => i.isEssential).sort((a, b) => b.weeklyAvg - a.weeklyAvg);
    const funCategories = items.filter(i => !i.isEssential).sort((a, b) => b.weeklyAvg - a.weeklyAvg);

    const thisWeekByCategory = weekSummary.byCategory;
    const essentialSpentThisWeek = weekSummary.essentialSpent;
    const funSpentThisWeek = weekSummary.funSpent;
    const thisWeekTxns = weekSummary.txns;
    const dailySpendingStacked = weekSummary.daily;

    const allVariableCategories = [...essentials, ...funCategories].sort((a, b) => {
      const aSpent = thisWeekByCategory.get(a.catId) || 0;
      const bSpent = thisWeekByCategory.get(b.catId) || 0;
      return bSpent - aSpent;
    });

    return {
      essentials,
      funCategories,
      allVariableCategories,
      essentialSpentThisWeek,
      funSpentThisWeek,
      thisWeekByCategory,
      thisWeekTxns,
      dailySpendingStacked,
    };
  }, [finance.transactions, finance.categories, weekStart, weekEnd, trips, catMap, essentialCatIds]);

  const [selectedCategory, setSelectedCategory] = useState<any | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  const selectedDayDate = useMemo(() => {
    if (selectedDayIndex === null) return null;
    return addDays(weekStart, selectedDayIndex);
  }, [selectedDayIndex, weekStart]);

  const selectedDayTxns = useMemo(() => {
    if (!selectedDayDate) return [];
    const targetStr = format(selectedDayDate, 'yyyy-MM-dd');
    return thisWeekTxns
      .filter(tx => format(parseUkDate(tx.posted_at), 'yyyy-MM-dd') === targetStr)
      .sort((a, b) => parseUkDate(b.posted_at).getTime() - parseUkDate(a.posted_at).getTime());
  }, [selectedDayDate, thisWeekTxns]);

  const selectedDayTotal = useMemo(() => {
    return selectedDayTxns.reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);
  }, [selectedDayTxns]);

  const categoryMerchantBreakdown = useMemo(() => {
    if (!selectedCategory || !thisWeekTxns) return [] as { name: string; total: number }[];
    const map = new Map<string, number>();
    for (const tx of thisWeekTxns) {
      const catId = tx.category_id || '__uncategorised';
      if (catId !== selectedCategory.catId) continue;
      const key = canonicaliseMerchant(tx.merchant || tx.description || '');
      map.set(key, (map.get(key) || 0) + Math.abs(baseAmt(tx)));
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [selectedCategory, thisWeekTxns]);

  // Upcoming bills
  const upcomingBills = useMemo(() => {
    return fixedExpenses.map(e => {
      const freq = e.frequency;
      let nextDueLabel: string = freq;
      let dueSoon = false;
      const paid = isPaidThisPeriod(e.id, e.frequency);
      if (freq === 'weekly') { nextDueLabel = 'Every week'; dueSoon = true; }
      else if (freq === 'fortnightly') { nextDueLabel = 'Every 2 weeks'; dueSoon = true; }
      else if (freq === 'monthly') {
        const dueDay = (e as any).due_day || 1;
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
        const next = thisMonth >= startOfDay(now) ? thisMonth : nextMonth;
        const daysUntil = differenceInDays(next, startOfDay(now));
        nextDueLabel = daysUntil <= 0 ? 'Due today' : `In ${daysUntil} day${daysUntil > 1 ? 's' : ''}`;
        dueSoon = daysUntil <= 7;
      } else if (freq === 'quarterly') { nextDueLabel = 'Quarterly'; }
      else if (freq === 'yearly') { nextDueLabel = 'Yearly'; }
      return { ...e, nextDueLabel, dueSoon, paid };
    });
  }, [fixedExpenses, now, isPaidThisPeriod]);

  // Compute effective fun spent after boost offset (greedy: largest category first)
  const effectiveFunByCategory = useMemo(() => {
    const sorted = [...funCategories].sort((a, b) => {
      const aSpent = thisWeekByCategory.get(a.catId) || 0;
      const bSpent = thisWeekByCategory.get(b.catId) || 0;
      return bSpent - aSpent;
    });
    let boostRemaining = boostAmount;
    const result = new Map<string, number>();
    for (const cat of sorted) {
      const actual = thisWeekByCategory.get(cat.catId) || 0;
      const offset = Math.min(boostRemaining, actual);
      result.set(cat.catId, Math.max(0, actual - offset));
      boostRemaining -= offset;
    }
    return result;
  }, [funCategories, thisWeekByCategory, boostAmount]);

  if (finance.loading || assumptionsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Weekly Budget</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!snapshot) return null;

  const weekLabel = `${format(weekStart, 'EEE d MMM')} – ${format(weekEnd, 'EEE d MMM')}`;
  const _dailyPace = daysLeft > 0 ? snapshot.remainingWeeklyFun / daysLeft : snapshot.remainingWeeklyFun;
  const dailyPaceLine = (snapshot.weeklyEssentialBudget + snapshot.weeklyFunBudget) / 7;
  const maxDailySpend = Math.max(...dailySpendingStacked.map(d => d.essential + d.fun), dailyPaceLine, 1);
  // Boost is already added to snapshot.weeklyFunBudget by the engine — don't also subtract it from spend
  const effectiveFunSpent = funSpentThisWeek;
  const funPercentSpent = snapshot.weeklyFunBudget > 0 ? Math.min((effectiveFunSpent / snapshot.weeklyFunBudget) * 100, 100) : 0;
  const essentialWeeklyBudget = snapshot.weeklyEssentialBudget;
  const essentialRemaining = snapshot.remainingEssentials;
  // Use raw budget-minus-spent to avoid double-counting from bidirectional overspend cross-subtraction
  // Same spent figures as the KPI tiles + pulse bar so every number on the page reconciles
  const combinedSafeToSpend = (snapshot.weeklyFunBudget + essentialWeeklyBudget) - (essentialSpentThisWeek + effectiveFunSpent);
  const combinedDailyPace = daysLeft > 0 ? combinedSafeToSpend / daysLeft : combinedSafeToSpend;
  const isOverBudget = combinedSafeToSpend < 0;
  const overAmount = Math.abs(combinedSafeToSpend);
  const nextMonday = addWeeks(weekStart, 1);
  const daysUntilReset = isCurrentWeek ? daysLeft : 0;

  // === Week Pulse segments (Variable spending only: Essentials + Fun) ===
  const totalWeeklyBudget = essentialWeeklyBudget + snapshot.weeklyFunBudget;
  const totalWeeklySpent = essentialSpentThisWeek + effectiveFunSpent;
  const weekNetDifference = totalWeeklyBudget - totalWeeklySpent;

  const pulseSegments = [
    { label: 'Essentials spent', value: essentialSpentThisWeek, color: '#0ea5e9' },
    { label: 'Fun spent', value: effectiveFunSpent, color: '#FF2EB8' },
  ];
  const pulseUsed = pulseSegments.reduce((s, x) => s + x.value, 0);
  const pulseRemaining = Math.max(0, totalWeeklyBudget - pulseUsed);
  const pulseDenom = Math.max(totalWeeklyBudget, pulseUsed, 1);

  // Insight state
  const insightTone: 'good' | 'warn' | 'bad' = !isCurrentWeek
    ? (weekNetDifference >= 0 ? 'good' : 'bad')
    : (isOverBudget ? 'bad' : snapshot.carryForwardDebt > 0 ? 'warn' : 'good');

  const insightTitle = !isCurrentWeek
    ? (weekNetDifference > 0
        ? `Week Closed: Underspent by +${fmt(weekNetDifference)}`
        : weekNetDifference < 0
          ? `Week Closed: Overspent by −${fmt(Math.abs(weekNetDifference))}`
          : 'Week Closed: Landed On Target')
    : (isOverBudget
        ? `You're ${fmt(overAmount)} over this week`
        : snapshot.carryForwardDebt > 0
          ? `Carried from last week: −${fmt(snapshot.carryForwardDebt)}`
          : "You're on track");

  const insightSubtitle = !isCurrentWeek
    ? (weekNetDifference > 0
        ? `Leftover ${fmt(weekNetDifference)} was automatically assigned into Savings Stash 💰`
        : weekNetDifference < 0
          ? `${fmt(Math.abs(weekNetDifference))} was automatically deducted from Savings Stash 📉`
          : 'Spending landed exactly on budget (zero net change to Savings Stash) 🎯')
    : (isOverBudget
        ? `Resets in ${daysUntilReset} day${daysUntilReset !== 1 ? 's' : ''} · overspend will be deducted next week`
        : snapshot.carryForwardDebt > 0
          ? "Fun Money budget reduced this week to settle the gap"
          : `Spending pace is ${fmt(combinedDailyPace)}/day — within budget`);

  return (
    <div className="space-y-6 sm:space-y-8 w-full font-body">
      {/* Utility bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedDate(prev => subWeeks(prev, 1))}
            className="h-8 w-8 hover:bg-[#FF7AD1]/15 hover:text-[#FF2EB8] rounded-xl transition-all"
            title="Previous Week"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          
          <div className="text-left min-w-[130px]">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#FF2EB8]/80">Weekly Budget</p>
            <p className="text-xs sm:text-sm font-semibold text-slate-800 tabular-nums">{weekLabel}</p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedDate(prev => addWeeks(prev, 1))}
            className="h-8 w-8 hover:bg-[#FF7AD1]/15 hover:text-[#FF2EB8] rounded-xl transition-all"
            title="Next Week"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>

          {!isCurrentWeek && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setSelectedDate(new Date())}
              className="text-[9px] h-6 px-2.5 rounded-lg border-pink-200/50 bg-pink-50/20 text-[#FF2EB8] hover:bg-[#FF2EB8] hover:text-white hover:border-transparent transition-all font-semibold"
            >
              Today
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
          <FinancialReportExporterModal />
          {currentWeekType !== 'normal' && (
            <Badge variant="secondary" className="text-[10px]">
              {currentWeekType === 'travel' ? '🏖 Holiday week' : '⚡ Exception week'}
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs text-muted-foreground" onClick={() => navigate('/finance/history')}>
            <History className="w-3.5 h-3.5" /> History
          </Button>
        </div>
      </div>

      {/* Travel Mode Banner (context slot) */}
      {snapshot.isTravelWeek && (
        <Card className="border border-sky-500/25 bg-sky-500/[0.04] shadow-none">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-sky-500/15 flex items-center justify-center flex-shrink-0">
                <Plane className="w-4 h-4 text-sky-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {snapshot.activeTrip?.name || 'Travel'} · Travel Mode
                </p>
                <p className="text-xs text-muted-foreground">
                  Essentials & Fun paused. Travel Pool: {fmt(snapshot.travelPoolRemaining)} of {fmt(snapshot.travelPoolAmount)} left.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/finance/travel')}>
              <Plane className="w-3.5 h-3.5" /> Travel page
            </Button>
          </CardContent>
        </Card>
      )}

      {/* === EDITORIAL HERO === */}
      <div className="text-center pt-6 pb-2">
        <span className={cn(
          "text-[11px] font-bold uppercase tracking-[0.2em]",
          !isCurrentWeek
            ? (weekNetDifference >= 0 ? "text-emerald-600" : "text-destructive/80")
            : (isOverBudget ? "text-destructive/70" : "text-muted-foreground/70")
        )}>
          {!isCurrentWeek
            ? (weekNetDifference > 0 ? 'Week Closed · Underspent' : weekNetDifference < 0 ? 'Week Closed · Overspent' : 'Week Closed · On Target')
            : (isOverBudget ? 'Over Budget This Week' : 'Safe to Spend This Week')}
        </span>
        <h1 className={cn(
          "text-6xl sm:text-7xl font-display font-black mt-4 mb-3 tracking-tight tabular-nums",
          !isCurrentWeek
            ? (weekNetDifference >= 0 ? "text-emerald-600" : "text-destructive")
            : (isOverBudget ? "text-destructive" : "text-[#FF2EB8]")
        )}>
          {!isCurrentWeek
            ? (weekNetDifference >= 0 ? `+${fmt(weekNetDifference)}` : `−${fmt(Math.abs(weekNetDifference))}`)
            : (isOverBudget ? `−${fmt(overAmount)}` : fmt(combinedSafeToSpend))}
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          {!isCurrentWeek ? (
            weekNetDifference > 0 ? (
              <>Auto-saved <span className="font-semibold text-emerald-600 tabular-nums">{fmt(weekNetDifference)}</span> straight into Savings Stash 💰</>
            ) : weekNetDifference < 0 ? (
              <>Auto-deducted <span className="font-semibold text-destructive tabular-nums">{fmt(Math.abs(weekNetDifference))}</span> straight from Savings Stash 📉</>
            ) : (
              <>Balanced budget · Zero net change to Savings Stash 🎯</>
            )
          ) : isOverBudget ? (
            <>Resets in <span className="font-semibold text-foreground">{daysUntilReset} day{daysUntilReset !== 1 ? 's' : ''}</span></>
          ) : (
            <>
              You can spend{' '}
              <span className="text-emerald-600 font-semibold tabular-nums">{fmt(combinedDailyPace)}/day</span>
              {' '}for{' '}
              <span className="text-foreground font-semibold">{daysLeft} more day{daysLeft !== 1 ? 's' : ''}</span>
            </>
          )}
        </p>

        {/* Thin progress */}
        <div className="mt-8 max-w-xs mx-auto">
          <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                !isCurrentWeek
                  ? (weekNetDifference >= 0 ? "bg-emerald-500" : "bg-destructive")
                  : (isOverBudget ? "bg-destructive" : "bg-emerald-500")
              )}
              style={{ width: `${!isCurrentWeek ? 100 : Math.min(100, (dayOfWeek / 7) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-3 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
            <span>{format(now, 'EEEE')}</span>
            <span>{!isCurrentWeek ? 'Week Complete (7 of 7 days)' : `${daysLeft} Day${daysLeft !== 1 ? 's' : ''} Left`}</span>
          </div>
        </div>
      </div>

      {/* === KPI STRIP (3 colorful bento tiles) === */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border-2 border-[#FF7AD1]/40 p-4 sm:p-5 shadow-[4px_4px_0px_0px_rgba(255,46,184,0.15)]">
          <p className="text-[#FF2EB8] text-[10px] font-display font-bold uppercase tracking-[0.15em] mb-2">Weekly Budget</p>
          <p className="text-slate-900 font-display font-black tabular-nums text-2xl sm:text-3xl leading-none">{fmt(totalWeeklyBudget)}</p>
          <p className="text-[11px] text-slate-500 mt-1.5 font-medium">{fmt(essentialWeeklyBudget)} essentials · {fmt(snapshot.weeklyFunBudget)} fun</p>
        </div>
        <div className={cn(
          "bg-white rounded-2xl border-2 p-4 sm:p-5",
          (!isCurrentWeek ? weekNetDifference < 0 : isOverBudget)
            ? "border-destructive/50 shadow-[4px_4px_0px_0px_rgba(220,38,38,0.15)]"
            : "border-[#22C55E]/40 shadow-[4px_4px_0px_0px_rgba(34,197,94,0.15)]"
        )}>
          <p className={cn(
            "text-[10px] font-display font-bold uppercase tracking-[0.15em] mb-2",
            (!isCurrentWeek ? weekNetDifference < 0 : isOverBudget) ? "text-destructive" : "text-[#166534]"
          )}>
            {!isCurrentWeek ? 'Total Spent' : 'Spent So Far'}
          </p>
          <p className={cn(
            "font-display font-black tabular-nums text-2xl sm:text-3xl leading-none",
            (!isCurrentWeek ? weekNetDifference < 0 : isOverBudget) ? 'text-destructive' : 'text-slate-900'
          )}>
            {fmt(essentialSpentThisWeek + effectiveFunSpent)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1.5 font-medium">
            {!isCurrentWeek ? '7 of 7 days complete' : `Day ${dayOfWeek} of 7`}
          </p>
        </div>
        <div className="bg-white rounded-2xl border-2 border-[#FF2EB8]/40 p-4 sm:p-5 shadow-[4px_4px_0px_0px_rgba(255,46,184,0.15)]">
          <p className="text-[#FF2EB8] text-[10px] font-display font-bold uppercase tracking-[0.15em] mb-2">
            {!isCurrentWeek ? 'Avg Daily Spend' : 'Daily Pace'}
          </p>
          <p className="text-slate-900 font-display font-black tabular-nums text-2xl sm:text-3xl leading-none">
            {fmt(!isCurrentWeek ? (essentialSpentThisWeek + effectiveFunSpent) / 7 : dailyPaceLine)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1.5 font-medium">
            {!isCurrentWeek ? 'actual avg / day' : 'target / day'}
          </p>
        </div>
      </div>

      {/* === WEEK PULSE === */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">Week Pulse</p>
          <p className="text-[10px] text-muted-foreground/60 tabular-nums">
            {fmt(pulseUsed)} of {fmt(totalWeeklyBudget)} committed
          </p>
        </div>
        <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-muted/50">
          {pulseSegments.map((s, i) => s.value > 0 && (
            <div
              key={i}
              className="h-full transition-all"
              style={{ width: `${(s.value / pulseDenom) * 100}%`, backgroundColor: s.color }}
              title={`${s.label}: ${fmt(s.value)}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[10px] text-muted-foreground">
          {pulseSegments.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
              <span>{s.label}</span>
              <span className="tabular-nums font-semibold text-foreground/80">{fmt(s.value)}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="w-2 h-2 rounded-sm bg-muted/70" />
            <span>Remaining</span>
            <span className="tabular-nums font-semibold text-foreground/80">{fmt(pulseRemaining)}</span>
          </div>
        </div>
      </div>

      {/* === CONTEXTUAL INSIGHT === */}
      <Card className={cn(
        "border shadow-sm",
        insightTone === 'bad' && "border-destructive/20 bg-destructive/[0.03]",
        insightTone === 'warn' && "border-amber-500/25 bg-amber-500/[0.03]",
        insightTone === 'good' && "border-border bg-card",
      )}>
        <CardContent className="p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
              insightTone === 'good' && "bg-emerald-50 dark:bg-emerald-500/10",
              insightTone === 'warn' && "bg-amber-500/10",
              insightTone === 'bad' && "bg-destructive/10",
            )}>
              {insightTone === 'good' && <Check className="w-5 h-5 text-emerald-600" />}
              {insightTone === 'warn' && <History className="w-5 h-5 text-amber-600" />}
              {insightTone === 'bad' && <Lock className="w-5 h-5 text-destructive" />}
            </div>
            <div>
              <p className={cn(
                "text-sm font-semibold",
                insightTone === 'good' && "text-foreground",
                insightTone === 'warn' && "text-amber-700 dark:text-amber-400",
                insightTone === 'bad' && "text-destructive",
              )}>{insightTitle}</p>
              <p className="text-xs text-muted-foreground">{insightSubtitle}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] whitespace-nowrap hidden sm:inline-flex">
            {!isCurrentWeek ? 'Closed' : `Resets in ${daysUntilReset}d`}
          </Badge>
        </CardContent>
      </Card>



      {/* === DETAIL DRILL-DOWNS (Essentials / Fun / Bills) === */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/75 mb-3">Pool Breakdown</p>
        <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-4', snapshot.isTravelWeek ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-4')}>
          <MetricCard
            label={!isCurrentWeek ? "Total Spent" : "Spent This Week"}
            value={fmt(essentialSpentThisWeek + effectiveFunSpent)}
            icon={Zap}
            delta={`of ${fmt(totalWeeklyBudget)}`}
            deltaType="neutral"
            subtitle={<span>{!isCurrentWeek ? "7 of 7 days complete" : `Day ${dayOfWeek} of 7`} · <span className="text-muted-foreground/50">{fmtGbp(essentialSpentThisWeek + effectiveFunSpent)}</span></span>}
            valueClassName="text-foreground"
            className="bg-white border-2 border-slate-200 shadow-[4px_4px_0px_0px_rgba(15,23,42,0.04)]"
          />
          <MetricCard
            label="Runway"
            value={(() => {
              const rw = Math.floor(snapshot.runwayWeeks);
              const runwayMonths = Math.floor(rw / 4.33);
              const remainderWeeks = Math.max(0, rw - Math.round(runwayMonths * 4.33));
              return runwayMonths > 0
                ? `~${runwayMonths}mo ${remainderWeeks > 0 ? remainderWeeks + 'w' : ''}`
                : `~${rw}w`;
            })()}
            icon={Shield}
            delta={`Until ${format(addWeeks(now, Math.floor(snapshot.runwayWeeks)), 'MMMM do')}`}
            deltaType="neutral"
            subtitle="Incl. emergency · ex. saving pots"
            className="bg-white border-2 border-pink-200 shadow-[4px_4px_0px_0px_rgba(255,46,184,0.06)]"
          />
          <MetricCard
            label="Fixed Bills (Monthly)"
            value={fmt(snapshot.weeklyFixedCosts * 4.33)}
            icon={Lock}
            delta="/month"
            deltaType="neutral"
            subtitle={<span className="text-[#FF2EB8] font-semibold hover:underline">View in Monthly Report →</span>}
            valueClassName="text-slate-700"
            className="bg-white border-2 border-slate-200 shadow-[4px_4px_0px_0px_rgba(15,23,42,0.04)] cursor-pointer hover:border-[#FF2EB8]/40 transition-all"
            onAction={() => navigate('/finance/monthly')}
          />
          {snapshot.isTravelWeek ? (
            <MetricCard
              label="Travel Pool"
              value={fmt(snapshot.travelPoolRemaining)}
              icon={Plane}
              delta={`/${fmt(snapshot.travelPoolAmount)}`}
              deltaType="neutral"
              subtitle={<span>{fmt(snapshot.travelPoolSpent)} spent · <span className="text-muted-foreground/50">{fmtGbp(snapshot.travelPoolRemaining)} left</span></span>}
              valueClassName="text-sky-500"
              className="bg-white border-2 border-sky-200 shadow-[4px_4px_0px_0px_rgba(14,165,233,0.06)]"
              onAction={() => navigate('/finance/travel')}
            />
          ) : (
            <MetricCard
              label="Weekly Safe to Spend"
              value={fmt(combinedSafeToSpend)}
              icon={PartyPopper}
              delta={`/${fmt(totalWeeklyBudget)}`}
              deltaType="neutral"
              subtitle={
                <span className="flex flex-col gap-0.5">
                  <span>{fmt(essentialSpentThisWeek + effectiveFunSpent)} spent · <span className="text-muted-foreground/50">{fmtGbp(combinedSafeToSpend)} left</span></span>
                  {snapshot.carryForwardDebt > 0 && (
                    <span className="text-[10px] text-destructive/80">
                      −{fmt(snapshot.carryForwardDebt)} last week overspend
                    </span>
                  )}
                </span>
              }
              valueClassName={combinedSafeToSpend < 0 ? "text-destructive" : "text-[#FF2EB8]"}
              className="bg-white border-2 border-pink-200 shadow-[4px_4px_0px_0px_rgba(255,46,184,0.06)]"
              onAction={handleStashWithdraw}
              actionDisabled={stashBalance <= 0}
            />
          )}
        </div>
      </div>






      {/* === DAILY SPENDING TIMELINE === */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Daily Spending — {!isCurrentWeek ? 'Selected Week' : 'This Week'}
            </p>
          </div>
          <div className="flex items-end gap-1 h-24">
            {dailySpendingStacked.map((day, i) => {
              const isToday = i === dayOfWeek - 1;
              const isFuture = i >= dayOfWeek;
              const total = day.essential + day.fun;
              
              const essentialHeight = maxDailySpend > 0 ? (day.essential / maxDailySpend) * 100 : 0;
              const funHeight = maxDailySpend > 0 ? (day.fun / maxDailySpend) * 100 : 0;
              const isSelected = selectedDayIndex === i;
              return (
                <div
                  key={i}
                  onClick={() => setSelectedDayIndex(i)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 cursor-pointer rounded-xl p-1 transition-all hover:bg-slate-100 group relative",
                    isSelected && "bg-slate-100 ring-2 ring-primary/50"
                  )}
                  title={`Click to view transactions for ${DAY_LABELS[i]}`}
                >
                  <span className="text-[9px] tabular-nums font-semibold text-muted-foreground group-hover:text-foreground">
                    {total > 0 ? fmt(total) : ''}
                  </span>
                  <div className="w-full flex flex-col items-stretch justify-end" style={{ height: '64px' }}>
                    {isFuture ? (
                      <div className="w-full rounded-t bg-muted/40" style={{ height: '8%' }} />
                    ) : (
                      <>
                        {/* Fun (pink) on top */}
                        {day.fun > 0 && (
                          <div
                            className="w-full rounded-t transition-all group-hover:brightness-110"
                            style={{
                              height: `${Math.max(funHeight, 4)}%`,
                              backgroundColor: '#FF2EB8',
                            }}
                          />
                        )}
                        {/* Essential (blue) on bottom */}
                        {day.essential > 0 && (
                          <div
                            className={`w-full transition-all group-hover:brightness-110 ${day.fun <= 0 ? 'rounded-t' : ''}`}
                            style={{
                              height: `${Math.max(essentialHeight, 4)}%`,
                              backgroundColor: '#0ea5e9',
                            }}
                          />
                        )}
                        {total === 0 && (
                          <div className="w-full rounded-t bg-muted/30 group-hover:bg-muted/50" style={{ height: '2%' }} />
                        )}
                      </>
                    )}
                  </div>
                  <span className={`text-[9px] font-medium ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                    {DAY_LABELS[i]}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#0ea5e9' }} />
              <span>Essentials</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#FF2EB8' }} />
              <span>Fun</span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-muted-foreground/40 rounded" />
              <span>Pace: {fmt(dailyPaceLine)}/day</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === HOW THIS IS CALCULATED === */}
      {(() => {
        const s = snapshot.split;
        const essentialsMonthly = essentialWeeklyBudget * 4.33;
        const row = (label: string, val: string, sub?: string, cls = 'text-slate-900') => (
          <div className="flex items-start justify-between gap-4 py-2">
            <div><p className="text-sm font-semibold text-slate-800">{label}</p>{sub && <p className="text-[11px] text-slate-500">{sub}</p>}</div>
            <p className={cn('text-sm font-bold tabular-nums shrink-0', cls)}>{val}</p>
          </div>
        );
        return (
          <Collapsible>
            <div className="bg-white rounded-2xl border border-pink-200/60 p-4 sm:p-5">
              <CollapsibleTrigger className="w-full flex items-center justify-between text-left">
                <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#FF2EB8]">How this is calculated</span>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 divide-y divide-slate-100">
                {(() => {
                  const ai = computeActualSpendingIncome(finance.transactions, finance.categories, referenceDateForEngine);
                  return (
                    <>
                      {row(
                        'Baseline monthly income (Gamma + VA)',
                        `+${fmt(s.monthlyIncome)}`,
                        ai.isLate
                          ? `⚠️ Pay not landed yet — using last month (${format(ai.cycleStart, 'MMM yyyy')}) as a guide`
                          : `${format(ai.cycleStart, 'd MMM')} → ${ai.nextPayday ? format(ai.nextPayday, 'd MMM') : '—'}`,
                        'text-emerald-600'
                      )}
                      {ai.gamma > 0 && (
                        <div className="flex justify-between pl-4 py-1 text-[11px] text-slate-500">
                          <span>Gamma Salary {ai.gammaDate ? `(paid ${format(ai.gammaDate, 'd MMM')})` : ''}</span>
                          <span className="tabular-nums">{fmt(ai.gamma)}</span>
                        </div>
                      )}
                      {ai.venture > 0 && (
                        <div className="flex justify-between pl-4 py-1 text-[11px] text-slate-500">
                          <span>Venture Advisory</span>
                          <span className="tabular-nums">{fmt(ai.venture)}</span>
                        </div>
                      )}
                      {row('Fixed bills', `−${fmt(s.mandatoryAmount)}`, 'All fixed expenses (including externally-paid)', 'text-rose-600')}
                      {row('Variable essentials', `−${fmt(essentialsMonthly)}`, 'Higher of your estimate or normal-week average', 'text-rose-600')}
                      {row('Saving goals', `−${fmt(s.goalSavingsAmount)}`, 'Pools with deadlines: remaining ÷ weeks left (capped at remaining balance)', 'text-rose-600')}
                      {row('Base fun money (monthly)', `=${fmt(s.funAmount)}`, `÷ 4.33 = ${fmt(snapshot.baseWeeklyFun)}/wk base weekly fun`)}
                      {ai.otherItems.length > 0 && (
                        <div className="py-2">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">Extra side income (paced over month)</p>
                              <p className="text-[11px] text-slate-500">Each extra payment is divided by the weeks left in the month</p>
                            </div>
                            <p className="text-sm font-bold tabular-nums text-emerald-600">+{fmt(ai.otherWeeklyBonus)}/wk</p>
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {ai.otherItems.map((o, i) => (
                              <div key={i} className="flex justify-between pl-4 py-0.5 text-[11px] text-slate-500">
                                <span>
                                  {o.name} ({fmt(o.amount)} on {format(o.date, 'd MMM')} ÷ {o.weeksSpread} {o.weeksSpread === 1 ? 'wk' : 'wks'} left)
                                </span>
                                <span className="tabular-nums text-emerald-600 font-semibold">+{fmt(o.perWeek)}/wk</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {row(
                        'Weekly budget',
                        fmt(totalWeeklyBudget),
                        `${fmt(essentialWeeklyBudget)} essentials + ${fmt(snapshot.baseWeeklyFun)} base fun${ai.otherWeeklyBonus > 0 ? ` + ${fmt(ai.otherWeeklyBonus)} paced extra income` : ''}${boostAmount ? ` + ${fmt(boostAmount)} boost` : ''}${snapshot.carryForwardDebt ? ` − ${fmt(snapshot.carryForwardDebt)} carried debt` : ''}`
                      )}
                    </>
                  );
                })()}
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })()}

      {/* === WEEKLY SPENDING === */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-[#FF2EB8]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Weekly Spending · This Week
            </p>
          </div>

          {/* Hero: Left to Spend */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Left to Spend</p>
              <p className={`text-3xl font-semibold tracking-tight tabular-nums ${combinedSafeToSpend < 0 ? 'text-destructive' : 'text-foreground'}`}>
                {combinedSafeToSpend < 0 ? `−${fmt(Math.abs(combinedSafeToSpend))}` : fmt(combinedSafeToSpend)}
              </p>
            </div>
            <div className="text-right text-xs font-medium text-muted-foreground tabular-nums space-y-0.5">
              <div>{fmt(essentialSpentThisWeek + funSpentThisWeek)} of {fmt(totalWeeklyBudget)}</div>
              {snapshot.boostAmount > 0 && <div className="text-emerald-600 font-semibold">+{fmt(snapshot.boostAmount)} boosts</div>}
              {snapshot.carryForwardDebt > 0 && <div className="text-destructive font-semibold">−{fmt(snapshot.carryForwardDebt)} last week overspend</div>}
            </div>
          </div>

          {/* Where it's going */}
          {allVariableCategories.length > 0 && (
            <div className="pt-4 border-t border-border/50">
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-2.5 flex-1 min-w-0">
                  {allVariableCategories.map((cat) => {
                    const actualSpent = thisWeekByCategory.get(cat.catId) || 0;
                    return (
                      <button
                        key={cat.catId}
                        onClick={() => setSelectedCategory(cat)}
                        className="flex items-center gap-2.5 w-full text-left p-1 -m-1 rounded-md hover:bg-muted/40 transition-colors"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color || '#FF2EB8' }}
                        />
                        <span className="text-xs font-medium text-muted-foreground truncate">{cat.name}</span>
                        <span className="text-xs font-semibold tabular-nums ml-auto text-foreground">{fmt(actualSpent)}</span>
                      </button>
                    );
                  })}
                </div>
                <MultiSegmentDonut
                  segments={allVariableCategories.map((cat) => ({
                    color: cat.color || '#FF2EB8',
                    value: thisWeekByCategory.get(cat.catId) || 0,
                    label: cat.name,
                  }))}
                  total={totalWeeklyBudget}
                  size={115}
                  centerTop={fmt(essentialSpentThisWeek + funSpentThisWeek)}
                  centerBottom={`/ ${fmt(totalWeeklyBudget)}`}
                />
              </div>

              <p className="text-[10px] font-medium text-muted-foreground/80 pt-4 mt-4 border-t border-border/40">
                Based on last <span className="font-semibold text-foreground/80">{snapshot.normalWeeksUsed}</span> normal week{snapshot.normalWeeksUsed !== 1 ? 's' : ''}
                {snapshot.excludedWeeksCount > 0 && ` · ${snapshot.excludedWeeksCount} travel/exception week${snapshot.excludedWeeksCount !== 1 ? 's' : ''} excluded`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>




      {/* === ACTIVE BOOSTS === */}
      {boosts.filter(b => b.week_start === weekStartKey).length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Active Boosts</p>
            </div>
            {boosts.filter(b => b.week_start === weekStartKey).map(b => {
              const goalName = finance.goals.find(g => g.id === b.goal_id)?.name || 'Unknown';
              return (
                <div key={b.id} className="flex items-center justify-between text-sm bg-primary/5 border border-primary/15 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    <span className="font-semibold text-primary">+{fmt(b.amount)}</span>
                    <span className="text-muted-foreground text-xs">from {goalName}</span>
                  </div>
                  <button onClick={() => handleRemoveBoost(b.id)} className="p-1 rounded-md hover:bg-muted">
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* === RUNWAY CALCULATION (Collapsible at bottom) === */}
      <Collapsible>
        <Card className="border-muted">
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Budget Derivation
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 space-y-1.5 text-xs tabular-nums">
              {snapshot.isDrawdownMode ? (
                <>
                  <WaterfallRow label="Total Cash" value={fmt(snapshot.totalLiquidCash)} />
                  <WaterfallRow label="Emergency Fund" value={fmt(snapshot.emergencyFloor)} prefix="−" muted />
                  {snapshot.totalGoalAllocations > 0 && (
                    <WaterfallRow label="Goal Allocations" value={fmt(snapshot.totalGoalAllocations)} prefix="−" muted />
                  )}
                  <div className="border-t border-border/50 my-1.5" />
                  <WaterfallRow label="Living Pool" value={fmt(snapshot.livingPool)} bold />
                  {snapshot.targetSavings > 0 && (
                    <WaterfallRow label="Target Savings" value={fmt(snapshot.targetSavings)} prefix="−" muted />
                  )}
                  <div className="border-t border-border/50 my-1.5" />
                  <WaterfallRow label="Spendable Pool" value={fmt(snapshot.spendablePool)} bold accent />
                  <div className="border-t border-border/50 my-1.5" />
                  <WaterfallRow label="Weekly Burn" value={fmt(snapshot.weeklyGross)} bold />
                  <WaterfallRow label="Fixed Bills /wk" value={fmt(snapshot.weeklyFixedCosts)} muted />
                  <WaterfallRow label="Essentials /wk" value={fmt(snapshot.weeklyEssentialBudget)} muted />
                  <WaterfallRow label="Fun Money /wk" value={fmt(snapshot.baseWeeklyFun)} muted />
                  <div className="border-t border-border/50 my-1.5" />
                  <WaterfallRow label={`Runway`} value={`${Math.round(snapshot.runwayWeeks)} weeks`} bold />
                </>
              ) : (
                <>
                  <WaterfallRow label="Monthly Income" value={fmt(snapshot.split.monthlyIncome)} />
                  <WaterfallRow label={`Fixed Bills (${snapshot.split.mandatoryPercent.toFixed(0)}%)`} value={fmt(snapshot.split.mandatoryAmount)} prefix="−" muted />
                  <WaterfallRow label={`Base Savings (${snapshot.split.baseSavingsPercent.toFixed(0)}%)`} value={fmt(snapshot.split.baseSavingsAmount)} prefix="−" muted />
                  {snapshot.split.goalSavingsAmount > 0 && (
                    <WaterfallRow label={`Goal Savings (${snapshot.split.goalSavingsPercent.toFixed(0)}%)`} value={fmt(snapshot.split.goalSavingsAmount)} prefix="−" muted />
                  )}
                  <WaterfallRow label="Essentials (Variable)" value={fmt(snapshot.computedEssentialVariable)} prefix="−" muted />
                  <div className="border-t border-border/50 my-1.5" />
                  <WaterfallRow label="Weekly Fun" value={fmt(snapshot.baseWeeklyFun)} bold accent />
                </>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* === WEEKLY RULES EXPLAINED === */}
      <Card className="border-2 border-[#FF7AD1]/30 bg-white/60 backdrop-blur-sm shadow-[4px_4px_0px_0px_rgba(255,46,184,0.08)] rounded-3xl overflow-hidden mt-6">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-5 h-5 text-[#FF2EB8]" />
            <h3 className="font-display font-black text-lg text-slate-800">How your Weekly Budget works:</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                  <ShoppingCart className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-850">1. Unified Weekly Budget</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    All discretionary & variable spending flows into one clean weekly safe-to-spend allowance.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <TrendingDown className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-850">2. Auto-Savings & Overspend Adjustment</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Underspending at week-end automatically sweeps into your Emergency Reserve or Savings Stash. Any overspend carries forward to adjust next week's allowance.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-xl bg-pink-100 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4 text-[#FF2EB8]" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-850">3. Stash & Goal Boosts</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pull funds from your Savings Stash or goals anytime to boost your current week's spending room.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                  <Plane className="w-4 h-4 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-850">4. Travel Mode Pause</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    During travel weeks, day-to-day budgets are paused and spending pulls directly from your specific Travel Pool.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Boost button */}
      {finance.goals.length > 0 && (
        <BoostDialog goals={finance.goals} fmt={fmt} onAddBoost={handleAddBoost} />
      )}

      {/* Category merchant breakdown dialog */}
      <Dialog open={!!selectedCategory} onOpenChange={() => setSelectedCategory(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCategory && (
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedCategory.color || '#8B5CF6' }} />
              )}
              {selectedCategory?.name} · merchants
            </DialogTitle>
            <DialogDescription>
              Total spent this week: {selectedCategory ? fmt(thisWeekByCategory.get(selectedCategory.catId) || 0) : fmt(0)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] -mr-4 pr-4">
            <div className="space-y-1">
              {categoryMerchantBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching transactions this week.</p>
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

      {/* Day Transactions Dialog */}
      <Dialog open={selectedDayIndex !== null} onOpenChange={(open) => { if (!open) setSelectedDayIndex(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-4">
              <span className="flex items-center gap-2 text-base font-bold">
                <CalendarIcon className="w-4 h-4 text-primary" />
                {selectedDayDate && format(selectedDayDate, 'EEEE, d MMMM')}
              </span>
              <Badge variant="secondary" className="font-bold font-mono text-xs px-2.5 py-0.5">
                {fmt(selectedDayTotal)}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selectedDayTxns.length === 0 
                ? 'No variable spending transactions recorded on this day.'
                : `${selectedDayTxns.length} transaction${selectedDayTxns.length > 1 ? 's' : ''} on this day`}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] -mr-4 pr-4">
            <div className="space-y-2 py-2">
              {selectedDayTxns.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  No spending recorded for this day.
                </div>
              ) : (
                selectedDayTxns.map((tx) => {
                  const cat = catMap.get(tx.category_id || '');
                  const isEssential = essentialCatIds.has(tx.category_id || '');
                  const amt = Math.abs(baseAmt(tx));
                  const txCur = (tx.currency || baseCurrency).toUpperCase();
                  const isForeign = txCur !== baseCurrency;
                  const nativeAmt = Math.abs(Number(tx.amount) || 0);
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
                      <div className="text-right flex flex-col items-end shrink-0">
                        <span className="text-sm font-bold tabular-nums text-slate-900">
                          {fmt(amt)}
                        </span>
                        {isForeign && (
                          <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                            {formatCurrency(nativeAmt, txCur)} {txCur}
                          </span>
                        )}
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

// --- Sub-components ---

function RunwayRow({ label, value, muted, bold, className }: {
  label: string; value: string; muted?: boolean; bold?: boolean; className?: string;
}) {
  return (
    <div className={`flex justify-between items-center ${bold ? 'font-semibold text-foreground' : ''} ${muted ? 'text-muted-foreground' : ''} ${className || ''}`}>
      <span className="text-xs">{label}</span>
      <span className={`text-xs tabular-nums ${bold ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  );
}


function WaterfallRow({ label, value, prefix, muted, bold, accent }: {
  label: string; value: string; prefix?: string; muted?: boolean; bold?: boolean; accent?: boolean;
}) {
  return (
    <div className={`flex justify-between items-center ${bold ? 'font-semibold' : ''} ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{prefix ? `${prefix} ` : ''}{label}</span>
      {value && (
        <span className={accent ? 'text-primary font-bold' : ''}>
          {prefix && value ? `${prefix}${value}` : value}
        </span>
      )}
    </div>
  );
}

function BoostDialog({ goals, fmt, onAddBoost }: {
  goals: ReturnType<typeof useFinanceData>['goals'];
  fmt: (n: number) => string;
  onAddBoost: (goalId: string, amount: number, note?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const goalsWithFunds = goals.filter(g => g.assigned_amount > 0);

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!selectedGoal || isNaN(amt) || amt <= 0) return;
    const goal = goals.find(g => g.id === selectedGoal);
    if (goal && amt > goal.assigned_amount) return;
    await onAddBoost(selectedGoal, amt, note || undefined);
    setOpen(false);
    setAmount('');
    setNote('');
    setSelectedGoal('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full border-dashed gap-1.5">
          <Zap className="w-3.5 h-3.5" /> Boost This Week from a Goal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Boost This Week's Budget</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Pull extra money from a savings goal into this week's spending budget.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">From Goal</label>
            <Select value={selectedGoal} onValueChange={setSelectedGoal}>
              <SelectTrigger><SelectValue placeholder="Select a goal" /></SelectTrigger>
              <SelectContent>
                {goalsWithFunds.length > 0 ? goalsWithFunds.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} ({fmt(g.assigned_amount)} available)
                  </SelectItem>
                )) : goals.map(g => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Amount</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 100" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. extra this week" />
          </div>
          <Button onClick={handleSubmit} className="w-full">Add Boost</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
