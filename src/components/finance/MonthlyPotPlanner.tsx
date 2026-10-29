import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, subMonths, startOfMonth, endOfMonth, format } from 'date-fns';
import {
  Sparkles, Wallet, Lock, Check, RotateCcw, Calendar, ArrowRight,
  CheckCircle2, AlertCircle, TrendingUp, PiggyBank, Pencil, Target, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import type { FinanceGoal, FinanceCategory, FinanceTransaction } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';

interface Props {
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  goals: FinanceGoal[];
  convertToBase: (amt: number, cur: string) => number;
  updateGoal: (id: string, updates: Partial<FinanceGoal>) => Promise<void>;
  addGoal?: (goal: any) => Promise<any>;
  baseCurrency?: string;
  assumptions?: FinanceAssumptions | null;
  fixedMonthlyTotal?: number;
  essentialVariable?: number;
  emergencyFloor?: number;
  currentEmergencyFunded?: number;
  onUpdateExpectedIncome?: (val: number) => Promise<void>;
}

interface SavedPlan {
  monthKey: string;
  monthLabel: string;
  expectedIncome: number;
  potPoolTotal: number;
  allocations: { goalId: string; amount: number; percent: number }[];
  savedAt: number;
  committed: boolean;
  committedAt?: number;
}

const PALETTE = ['#0EA5E9', '#EC4899', '#F59E0B', '#8B5CF6', '#22C55E', '#14B8A6', '#F97316', '#6366F1'];

export default function MonthlyPotPlanner({
  transactions,
  categories,
  goals,
  convertToBase,
  updateGoal,
  addGoal,
  baseCurrency = 'GBP',
  assumptions,
  fixedMonthlyTotal = 0,
  essentialVariable = 0,
  emergencyFloor = 0,
  currentEmergencyFunded = 0,
  onUpdateExpectedIncome,
}: Props) {
  const now = new Date();
  const fmt = (n: number) => formatCurrency(Math.round(n * 100) / 100, baseCurrency);

  // Month navigation: default to 1 (Next Month)
  const [monthOffset, setMonthOffset] = useState<number>(1);
  const targetDate = useMemo(() => addMonths(startOfMonth(now), monthOffset), [monthOffset, now]);
  const monthKey = format(targetDate, 'yyyy-MM');
  const monthLabel = format(targetDate, 'MMMM yyyy');
  const isNextMonth = monthOffset === 1;
  const isCurrentMonth = monthOffset === 0;

  // Expected income resolution
  const detectedPaycheck = useMemo(() => {
    // Find latest regular salary transaction (e.g. Gamma Salary)
    const sorted = [...transactions]
      .filter(t => !t.is_transfer && t.amount > 0)
      .sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime());
    const gamma = sorted.find(t => (t.merchant || t.description || '').toLowerCase().includes('gamma') || baseAmt(t) >= 1500);
    return gamma ? baseAmt(gamma) : 3083.33;
  }, [transactions]);

  const defaultExpectedIncome = assumptions?.expected_monthly_income && assumptions.expected_monthly_income > 0
    ? assumptions.expected_monthly_income
    : detectedPaycheck;

  const [expectedIncomeInput, setExpectedIncomeInput] = useState<string>(String(Math.round(defaultExpectedIncome)));
  const [isEditingIncome, setIsEditingIncome] = useState(false);
  const effectiveExpectedIncome = parseFloat(expectedIncomeInput) || defaultExpectedIncome;

  // Living costs & Emergency reserve waterfall
  const totalLivingReserve = fixedMonthlyTotal + essentialVariable;
  const emergencyShortfall = Math.max(0, emergencyFloor - currentEmergencyFunded);
  const emergencyTopUp = Math.min(Math.max(0, effectiveExpectedIncome - totalLivingReserve), emergencyShortfall);
  const defaultAvailableForPots = Math.max(0, effectiveExpectedIncome - totalLivingReserve - emergencyTopUp);

  const [customPotPool, setCustomPotPool] = useState<string>('');
  const potPoolTotal = customPotPool !== '' ? Math.max(0, parseFloat(customPotPool) || 0) : defaultAvailableForPots;

  // Allocatable goal pots (excluding savings stash)
  const allocatablePots = useMemo(() => {
    return goals
      .filter(g => !(g as any).is_stash && !g.name.toLowerCase().includes('stash'))
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.name.localeCompare(b.name));
  }, [goals]);

  // Goal-driven recommendations
  const recommendations = useMemo(() => {
    const list: { goal: FinanceGoal; remaining: number; isFull: boolean; monthlyTarget: number; recommendedPct: number }[] = [];
    let sumTargets = 0;

    for (const g of allocatablePots) {
      const targetBase = convertToBase(g.target_amount || 0, g.currency);
      const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
      const remaining = Math.max(0, targetBase - assignedBase);
      const isFull = remaining <= 0.01;

      let monthlyTarget = 0;
      if (!isFull) {
        if (g.deadline) {
          const daysLeft = Math.max(1, Math.ceil((new Date(g.deadline).getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24)));
          const weeksLeft = Math.max(1, daysLeft / 7);
          monthlyTarget = Math.min(remaining, (remaining / weeksLeft) * 4.33);
        } else if (g.percent_allocation && g.percent_allocation > 0) {
          monthlyTarget = Math.min(remaining, potPoolTotal * (g.percent_allocation / 100));
        } else {
          monthlyTarget = Math.min(remaining, Math.max(50, targetBase / 12));
        }
      }

      sumTargets += monthlyTarget;
      list.push({ goal: g, remaining, isFull, monthlyTarget, recommendedPct: 0 });
    }

    // Normalize percentages to potPoolTotal
    return list.map(item => {
      const pct = sumTargets > 0 ? (item.monthlyTarget / sumTargets) * 100 : (100 / Math.max(1, allocatablePots.length));
      return { ...item, recommendedPct: pct };
    });
  }, [allocatablePots, convertToBase, targetDate, potPoolTotal]);

  // Pct state for the interactive sliders
  const [pcts, setPcts] = useState<Record<string, number>>({});
  const [savedPlan, setSavedPlan] = useState<SavedPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);

  // Dialog for capacity increase
  const [capacityModal, setCapacityModal] = useState<{ open: boolean; goal: FinanceGoal | null; plannedAmt: number } | null>(null);

  // Load saved plan for monthKey
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`gvb_pot_plan_${monthKey}`);
      if (raw) {
        const parsed: SavedPlan = JSON.parse(raw);
        setSavedPlan(parsed);
        const map: Record<string, number> = {};
        parsed.allocations.forEach(a => { map[a.goalId] = a.percent; });
        setPcts(map);
        if (parsed.expectedIncome) setExpectedIncomeInput(String(Math.round(parsed.expectedIncome)));
        if (parsed.potPoolTotal != null) setCustomPotPool(String(Math.round(parsed.potPoolTotal)));
        return;
      }
    } catch {}

    // If no saved plan, apply goal-driven recommendations
    const initialPcts: Record<string, number> = {};
    recommendations.forEach(r => {
      initialPcts[r.goal.id] = Math.round(r.recommendedPct);
    });
    setPcts(initialPcts);
    setSavedPlan(null);
  }, [monthKey, recommendations]);

  // Compute allocated amounts from pcts
  const totalPct = useMemo(() => {
    return Object.values(pcts).reduce((s, v) => s + (v || 0), 0);
  }, [pcts]);

  const allocatedAmounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of allocatablePots) {
      const p = pcts[g.id] || 0;
      map[g.id] = (p / 100) * potPoolTotal;
    }
    return map;
  }, [allocatablePots, pcts, potPoolTotal]);

  const totalAllocated = useMemo(() => {
    return Object.values(allocatedAmounts).reduce((s, v) => s + v, 0);
  }, [allocatedAmounts]);

  // Update a single pot percentage
  const handleSetPotPct = (goalId: string, newPct: number) => {
    setPcts(prev => ({
      ...prev,
      [goalId]: Math.max(0, Math.min(100, newPct)),
    }));
  };

  // Update pot by amount
  const handleSetPotAmt = (goal: FinanceGoal, amt: number) => {
    const targetBase = convertToBase(goal.target_amount || 0, goal.currency);
    const assignedBase = convertToBase(goal.assigned_amount || 0, goal.currency);
    const remaining = Math.max(0, targetBase - assignedBase);

    // If pot is at capacity and user adds > 0, show capacity prompt
    if (remaining <= 0.01 && amt > 0) {
      setCapacityModal({ open: true, goal, plannedAmt: amt });
      return;
    }

    if (potPoolTotal <= 0) return;
    const newPct = (amt / potPoolTotal) * 100;
    handleSetPotPct(goal.id, newPct);
  };

  // Quick actions
  const applyGoalRecommendations = () => {
    const next: Record<string, number> = {};
    recommendations.forEach(r => {
      next[r.goal.id] = Math.round(r.recommendedPct);
    });
    setPcts(next);
    toast.success('Applied goal-driven pacing for each pot');
  };

  const applyEqualSplit = () => {
    const count = allocatablePots.filter(g => {
      const targetBase = convertToBase(g.target_amount || 0, g.currency);
      const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
      return targetBase - assignedBase > 0.01;
    }).length;
    if (count === 0) return;
    const per = Math.floor(100 / count);
    const next: Record<string, number> = {};
    allocatablePots.forEach(g => {
      const targetBase = convertToBase(g.target_amount || 0, g.currency);
      const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
      next[g.id] = targetBase - assignedBase > 0.01 ? per : 0;
    });
    setPcts(next);
  };

  const handleReset = () => {
    const next: Record<string, number> = {};
    allocatablePots.forEach(g => { next[g.id] = 0; });
    setPcts(next);
  };

  // Save Plan
  const handleSavePlan = () => {
    setSaving(true);
    try {
      const plan: SavedPlan = {
        monthKey,
        monthLabel,
        expectedIncome: effectiveExpectedIncome,
        potPoolTotal,
        allocations: allocatablePots.map(g => ({
          goalId: g.id,
          amount: allocatedAmounts[g.id] || 0,
          percent: pcts[g.id] || 0,
        })),
        savedAt: Date.now(),
        committed: savedPlan?.committed || false,
      };
      localStorage.setItem(`gvb_pot_plan_${monthKey}`, JSON.stringify(plan));
      setSavedPlan(plan);
      toast.success(`Plan saved for ${monthLabel}! ✨`);
    } catch (e: any) {
      toast.error('Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  // Commit Plan into Pools
  const handleCommitPlan = async () => {
    if (totalAllocated <= 0) {
      toast.error('No funds allocated to commit.');
      return;
    }
    setCommitting(true);
    try {
      for (const g of allocatablePots) {
        const addBase = allocatedAmounts[g.id] || 0;
        if (addBase <= 0.01) continue;

        const oneInBase = convertToBase(1, g.currency) || 1;
        const addNative = addBase / oneInBase;
        const currentAssigned = g.assigned_amount || 0;
        const currentTarget = g.target_amount || 0;

        // If amount causes goal to exceed target, update target or cap
        const newAssigned = currentAssigned + addNative;
        const updates: Partial<FinanceGoal> = {
          assigned_amount: newAssigned,
        };
        if (newAssigned > currentTarget && currentTarget > 0) {
          updates.target_amount = newAssigned;
        }

        await updateGoal(g.id, updates);
      }

      const updatedPlan: SavedPlan = {
        ...(savedPlan || {
          monthKey,
          monthLabel,
          expectedIncome: effectiveExpectedIncome,
          potPoolTotal,
          allocations: allocatablePots.map(g => ({
            goalId: g.id,
            amount: allocatedAmounts[g.id] || 0,
            percent: pcts[g.id] || 0,
          })),
          savedAt: Date.now(),
          committed: true,
        }),
        committed: true,
        committedAt: Date.now(),
      };
      localStorage.setItem(`gvb_pot_plan_${monthKey}`, JSON.stringify(updatedPlan));
      setSavedPlan(updatedPlan);

      toast.success(`Committed ${fmt(totalAllocated)} to your pots! 🚀`);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to commit money to pools');
    } finally {
      setCommitting(false);
    }
  };

  // Status check: Is it ready to commit?
  const isMonthReadyToCommit = now >= startOfMonth(targetDate);

  return (
    <div className="space-y-6 font-body">
      {/* Month Navigation & Context Header */}
      <div className="bg-white rounded-[2rem] border-2 border-[#FF7AD1]/40 p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-2xl bg-gradient-to-tr from-[#FF2EB8] to-[#FF7AD1] text-white shadow-md shadow-[#FF2EB8]/20">
                <PiggyBank className="w-5 h-5" />
              </span>
              <h2 className="text-2xl font-display font-black text-slate-900 tracking-tight">
                Monthly Pot Planning
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Forward-looking pot allocation. Plan your distributions before payday, and commit when the month begins.
            </p>
          </div>

          {/* Month Toggle Tabs */}
          <div className="flex items-center bg-[#FFF5FA] p-1.5 rounded-2xl border border-[#FF7AD1]/30 self-start sm:self-center">
            <button
              onClick={() => setMonthOffset(0)}
              className={`px-4 py-2 rounded-xl text-xs font-display font-bold transition-all ${
                isCurrentMonth
                  ? 'bg-white text-[#FF2EB8] shadow-sm shadow-[#FF2EB8]/10'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Current ({format(now, 'MMM yyyy')})
            </button>
            <button
              onClick={() => setMonthOffset(1)}
              className={`px-4 py-2 rounded-xl text-xs font-display font-bold transition-all flex items-center gap-1.5 ${
                isNextMonth
                  ? 'bg-[#FF2EB8] text-white shadow-md shadow-[#FF2EB8]/20'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Next Month ({format(addMonths(now, 1), 'MMM yyyy')})
            </button>
          </div>
        </div>

        {/* Expected Income & Waterfall Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          {/* 1. Expected Income */}
          <div className="bg-[#F0FDF4] rounded-2xl p-4 border border-emerald-200 space-y-1 relative">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Expected Income</p>
              <button
                onClick={() => setIsEditingIncome(!isEditingIncome)}
                className="text-emerald-700 hover:text-emerald-900"
                title="Edit expected income"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
            {isEditingIncome ? (
              <div className="flex items-center gap-1 pt-1">
                <Input
                  type="number"
                  className="h-8 text-sm font-bold bg-white"
                  value={expectedIncomeInput}
                  onChange={e => setExpectedIncomeInput(e.target.value)}
                  onBlur={() => {
                    setIsEditingIncome(false);
                    if (onUpdateExpectedIncome && parseFloat(expectedIncomeInput) > 0) {
                      onUpdateExpectedIncome(parseFloat(expectedIncomeInput));
                    }
                  }}
                  autoFocus
                />
              </div>
            ) : (
              <p className="text-xl sm:text-2xl font-display font-black text-emerald-900 tabular-nums">
                {fmt(effectiveExpectedIncome)}
              </p>
            )}
            <p className="text-[10px] text-emerald-600 font-medium">For {monthLabel}</p>
          </div>

          {/* 2. Living Costs Reserve */}
          <div className="bg-[#FFFBEB] rounded-2xl p-4 border border-amber-200 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Living Reserve</p>
            <p className="text-xl sm:text-2xl font-display font-black text-amber-900 tabular-nums">
              -{fmt(totalLivingReserve)}
            </p>
            <p className="text-[10px] text-amber-600 font-medium">Bills & essentials locked</p>
          </div>

          {/* 3. Emergency Top-up */}
          <div className="bg-[#FAF5FF] rounded-2xl p-4 border border-purple-200 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Emergency Top-up</p>
            <p className="text-xl sm:text-2xl font-display font-black text-purple-900 tabular-nums">
              {emergencyTopUp > 0 ? `-${fmt(emergencyTopUp)}` : '£0.00'}
            </p>
            <p className="text-[10px] text-purple-600 font-medium">
              {emergencyShortfall <= 0 ? 'Reserve at 100%' : 'To reach safety floor'}
            </p>
          </div>

          {/* 4. Available for Goal Pots */}
          <div className="bg-gradient-to-br from-[#FFF5FA] to-pink-50 rounded-2xl p-4 border-2 border-[#FF2EB8] space-y-1 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#FF2EB8]">Available for Pots</p>
            <p className="text-xl sm:text-2xl font-display font-black text-slate-900 tabular-nums">
              {fmt(potPoolTotal)}
            </p>
            <p className="text-[10px] text-[#FF2EB8] font-bold">Target pool to allocate</p>
          </div>
        </div>

        {/* Goal Recommendation Notice */}
        <div className="bg-gradient-to-r from-purple-50 via-pink-50 to-amber-50 p-4 rounded-2xl border border-purple-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <p className="font-display font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[#FF2EB8]" />
              Goal-Driven Recommendation for {monthLabel}
            </p>
            <p className="text-slate-600 text-[11px]">
              We calculated the exact pacing required for each pot based on your deadlines and target sizes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={applyGoalRecommendations}
              className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-xl text-xs h-8 shadow-sm shadow-[#FF2EB8]/20"
            >
              Apply Recommendations
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={applyEqualSplit}
              className="rounded-xl text-xs h-8 border-slate-300"
            >
              Equal Split
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReset}
              className="rounded-xl text-xs h-8 text-slate-500"
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Multi-Segment Allocation Bar */}
      <div className="bg-white rounded-[2rem] border-2 border-[#FF7AD1]/40 p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-display font-bold text-lg text-slate-900">Pot Distribution</h3>
            <p className="text-xs text-slate-500">Adjust the sliders or amounts for each pot below.</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-display font-bold uppercase tracking-wider text-slate-500">Allocated</p>
            <p className="text-xl font-display font-black tabular-nums text-slate-900">
              {fmt(totalAllocated)}{' '}
              <span className="text-xs font-bold text-slate-400">/ {fmt(potPoolTotal)} ({totalPct.toFixed(0)}%)</span>
            </p>
          </div>
        </div>

        {/* Visual Multi-Segment Bar */}
        <div className="h-10 rounded-full bg-slate-100 overflow-hidden flex shadow-inner border border-slate-200/80">
          {allocatablePots.map((g, i) => {
            const p = pcts[g.id] || 0;
            if (p <= 0) return null;
            const color = g.color || PALETTE[i % PALETTE.length];
            return (
              <div
                key={g.id}
                className="h-full flex items-center justify-center text-[10px] font-display font-black text-white/95 px-1 truncate transition-all duration-150"
                style={{ width: `${Math.min(100, p)}%`, backgroundColor: color }}
                title={`${g.name}: ${p.toFixed(0)}% (${fmt(allocatedAmounts[g.id] || 0)})`}
              >
                {p >= 7 && <span className="truncate">{g.name} ({p.toFixed(0)}%)</span>}
              </div>
            );
          })}
        </div>

        {/* Pots List with Interactive Sliders */}
        <div className="divide-y divide-slate-100">
          {allocatablePots.map((g, i) => {
            const color = g.color || PALETTE[i % PALETTE.length];
            const p = pcts[g.id] || 0;
            const amt = allocatedAmounts[g.id] || 0;
            const targetBase = convertToBase(g.target_amount || 0, g.currency);
            const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
            const remaining = Math.max(0, targetBase - assignedBase);
            const isFull = remaining <= 0.01;
            const rec = recommendations.find(r => r.goal.id === g.id);

            return (
              <div key={g.id} className="py-4 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-bold text-sm text-slate-900">{g.name}</span>
                        {isFull && (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] font-bold">
                            🎉 Goal Reached (Full)
                          </Badge>
                        )}
                        {g.deadline && !isFull && (
                          <span className="text-[10px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full font-semibold border border-purple-200">
                            Due {format(new Date(g.deadline), 'MMM yyyy')} · needs {fmt(rec?.monthlyTarget || 0)}/mo
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Current: {fmt(assignedBase)} / {fmt(targetBase)}
                        {!isFull && <span className="text-slate-400 ml-1.5">({fmt(remaining)} remaining)</span>}
                      </p>
                    </div>
                  </div>

                  {/* Pct & Amount Inputs */}
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <div className="flex items-center gap-1 bg-[#FFF5FA] px-2.5 py-1 rounded-xl border border-[#FF7AD1]/30">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="w-12 h-7 text-center font-bold px-1 text-xs bg-white"
                        value={Math.round(p)}
                        onChange={e => handleSetPotPct(g.id, parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-xs text-slate-500 font-bold">%</span>
                    </div>

                    <div className="flex items-center gap-1 bg-[#F8FAFC] px-2.5 py-1 rounded-xl border border-slate-200">
                      <span className="text-xs text-slate-400 font-bold">+</span>
                      <Input
                        type="number"
                        className="w-20 h-7 text-right font-display font-black text-xs bg-white text-slate-900"
                        value={Math.round(amt)}
                        onChange={e => handleSetPotAmt(g, parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                </div>

                {/* Slider */}
                <div className="pt-1">
                  <Slider
                    value={[p]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([val]) => handleSetPotPct(g.id, val)}
                    className="w-full"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Save & Commit Action Strip */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            {savedPlan?.committed ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Plan committed on {savedPlan.committedAt ? format(new Date(savedPlan.committedAt), 'd MMM yyyy, h:mm a') : 'this month'}
              </div>
            ) : savedPlan ? (
              <div className="flex items-center gap-1.5 text-xs text-purple-700 font-semibold bg-purple-50 px-3 py-1.5 rounded-xl border border-purple-200">
                <Check className="w-4 h-4 text-purple-600" />
                Plan saved for {monthLabel} ({fmt(savedPlan.potPoolTotal)} across {savedPlan.allocations.length} pots)
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Save your planned distribution to have it ready for payday.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSavePlan}
              disabled={saving}
              className="rounded-2xl font-display font-bold text-xs h-10 px-5 border-slate-300"
            >
              {saving ? 'Saving…' : `Save ${monthLabel} Plan`}
            </Button>

            <Button
              onClick={handleCommitPlan}
              disabled={committing || totalAllocated <= 0}
              className="bg-gradient-to-r from-[#FF2EB8] to-[#FF7AD1] hover:opacity-95 text-white font-display font-bold rounded-2xl text-xs h-10 px-6 shadow-lg shadow-[#FF2EB8]/25"
            >
              {committing ? 'Committing…' : isMonthReadyToCommit ? `Commit ${fmt(totalAllocated)} to Pools Now` : `Commit to Pools (${monthLabel})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Capacity Increase Dialog */}
      {capacityModal && (
        <Dialog open={capacityModal.open} onOpenChange={open => !open && setCapacityModal(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Increase Goal for {capacityModal.goal?.name}?
              </DialogTitle>
              <DialogDescription className="pt-2 text-sm text-slate-600">
                This pot is already at its target of <strong>{fmt(capacityModal.goal?.target_amount || 0)}</strong>.
                Would you like to increase the target to <strong>{fmt((capacityModal.goal?.target_amount || 0) + capacityModal.plannedAmt)}</strong> so it can receive this allocation?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => setCapacityModal(null)}>Cancel</Button>
              <Button
                className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-bold"
                onClick={async () => {
                  if (capacityModal.goal) {
                    const newTarget = (capacityModal.goal.target_amount || 0) + capacityModal.plannedAmt;
                    await updateGoal(capacityModal.goal.id, { target_amount: newTarget });
                    const newPct = potPoolTotal > 0 ? (capacityModal.plannedAmt / potPoolTotal) * 100 : 10;
                    handleSetPotPct(capacityModal.goal.id, newPct);
                    toast.success(`Updated ${capacityModal.goal.name} target to ${fmt(newTarget)}`);
                  }
                  setCapacityModal(null);
                }}
              >
                Increase Goal & Allocate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
