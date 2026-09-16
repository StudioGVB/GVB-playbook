import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, ShoppingCart, Target, Wallet, Lock, ArrowRightLeft, Trash2, Palette, Plane, Car, Home, GraduationCap, Heart, Gift, Laptop, Baby, PiggyBank, Briefcase, UtensilsCrossed, Dumbbell, Music, Gamepad2, BookOpen, Sparkles, Pencil, AlertCircle, type LucideIcon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import PriorMonthAllocator from '@/components/finance/PriorMonthAllocator';
import FinanceBalanceSheet from '@/pages/FinanceBalanceSheet';
import WeeklyPoolSavingsCard from '@/components/finance/WeeklyPoolSavingsCard';
import { format } from 'date-fns';


const POOL_ICON_KEYWORDS: [string[], LucideIcon][] = [
  [['travel', 'trip', 'holiday', 'vacation', 'flight', 'europe', 'asia', 'america'], Plane],
  [['car', 'vehicle', 'auto', 'drive'], Car],
  [['house', 'home', 'apartment', 'rent', 'mortgage', 'property', 'move'], Home],
  [['education', 'uni', 'course', 'study', 'school', 'tuition', 'learn'], GraduationCap],
  [['wedding', 'love', 'ring', 'engagement'], Heart],
  [['gift', 'present', 'christmas', 'birthday'], Gift],
  [['tech', 'laptop', 'computer', 'phone', 'gadget', 'device', 'pc', 'mac'], Laptop],
  [['baby', 'child', 'kid', 'family'], Baby],
  [['saving', 'buffer', 'rainy', 'fund', 'reserve'], PiggyBank],
  [['business', 'startup', 'invest', 'side hustle'], Briefcase],
  [['food', 'dining', 'restaurant', 'eat'], UtensilsCrossed],
  [['gym', 'fitness', 'health', 'sport'], Dumbbell],
  [['music', 'concert', 'festival', 'gig'], Music],
  [['game', 'gaming', 'console', 'play'], Gamepad2],
  [['book', 'read'], BookOpen],
];

function getPoolIcon(name: string): LucideIcon {
  const lower = name.toLowerCase();
  for (const [keywords, icon] of POOL_ICON_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) return icon;
  }
  return Sparkles;
}

const POOL_COLORS = [
  '#4558ff', '#da60ff', '#24af58', '#ffb92c', '#ef4444',
  '#06b6d4', '#84cc16', '#f97316', '#8b5cf6', '#ec4899',
  '#ffaded', '#6b7280',
];
import { formatCurrency } from '@/lib/financeUtils';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import { computePolicySnapshot, computeTripSpent } from '@/lib/policyEngine';
import { toast } from 'sonner';

type PoolId = string; // goal id or virtual id
const UNALLOCATED = '__unallocated__';
const LIVING_POOL = '__living_pool__';
const isVirtualPool = (id: PoolId) => id === UNALLOCATED || id === LIVING_POOL;

export default function FinancePoolsPage() {
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
  const { monthlyTotalInternal: fixedMonthlyTotal, monthlyTotal: fixedMonthlyTotalAll } = useFixedExpenses();
  const { weekTypeMap } = useWeekTypes();
  const { trips } = useFinanceTrips();

  // Map goal_id → trip spent (for goals linked to a trip)
  const goalTripSpent = useMemo(() => {
    const map = new Map<string, { spent: number; tripName: string }>();
    trips.forEach(t => {
      if (!t.goal_id) return;
      const spent = computeTripSpent(finance.transactions, t.id, t.start_date, t.end_date);
      map.set(t.goal_id, { spent, tripName: t.name });
    });
    return map;
  }, [trips, finance.transactions]);

  // Create pool dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCurrency, setNewCurrency] = useState('AUD');
  const [newColor, setNewColor] = useState(POOL_COLORS[0]);
  const [newPercentAllocation, setNewPercentAllocation] = useState('0');
  const [newDeadline, setNewDeadline] = useState('');
  // Move funds dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFrom, setMoveFrom] = useState<PoolId>('');
  const [moveTo, setMoveTo] = useState<PoolId>('');
  const [moveAmount, setMoveAmount] = useState('');
  // Edit goal dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editGoalId, setEditGoalId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editCurrency, setEditCurrency] = useState('AUD');
  const [editColor, setEditColor] = useState(POOL_COLORS[0]);
  const [editIsStash, setEditIsStash] = useState(false);
  const [editPercentAllocation, setEditPercentAllocation] = useState('0');
  const [editDeadline, setEditDeadline] = useState('');

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const wtMap = useMemo(() => weekTypeMap(), [weekTypeMap]);

  const snapshot = useMemo(() => {
    if (!assumptions || finance.loading) return null;
    return computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions, finance.categories,
      finance.goals, finance.convertToBase, fixedMonthlyTotal, undefined, wtMap, [], fixedMonthlyTotalAll,
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, finance.loading, fixedMonthlyTotal, fixedMonthlyTotalAll, wtMap]);

  const totalCash = snapshot?.totalLiquidCash ?? 0;
  const emergencyFloor = snapshot?.emergencyFloor ?? 0;
  const weeksUntilIncome = snapshot?.weeksUntilIncome ?? 0;
  const isDrawdown = snapshot?.isDrawdownMode ?? false;

  const totalGoalAssigned = finance.goals.reduce((s, g) => s + (g.assigned_amount || 0), 0);
  // Use snapshot values for living/spending pool
  const livingRemainder = snapshot?.livingPool ?? 0;
  const targetSavings = snapshot?.targetSavings ?? 0;
  const spendablePool = snapshot?.spendablePool ?? 0;
  // Weekly budget from snapshot (single source of truth)
  const weeklyFromRemainder = snapshot?.baseWeeklyFun ?? 0;

  const essentialVariable = snapshot?.computedEssentialVariable ?? (assumptions as any)?.estimated_essential_variable ?? 0;
  const bufferMonths = assumptions?.buffer_months ?? 3;
  const actualMonthlySurvival = snapshot?.emergencySurvivalMonthly ?? snapshot?.survivalCostMonthly ?? (fixedMonthlyTotal + essentialVariable);

  // Sub-breakdown of living/spending pool
  const fixedReserve = isDrawdown && weeksUntilIncome > 0
    ? (fixedMonthlyTotal / 4.33) * weeksUntilIncome
    : fixedMonthlyTotal;
  const essentialReserve = isDrawdown && weeksUntilIncome > 0
    ? (essentialVariable / 4.33) * weeksUntilIncome
    : essentialVariable;
  const funMoney = Math.max(0, spendablePool - fixedReserve - essentialReserve);

  // Build pool options for the move dialog
  const poolOptions: { id: PoolId; label: string; available: number; cap?: number }[] = useMemo(() => {
    const opts: { id: PoolId; label: string; available: number; cap?: number }[] = [];
    opts.push({ id: UNALLOCATED, label: 'Fun Money', available: funMoney });
    // Living Pool (free savings) — only show as a distinct option if it exceeds Fun Money
    // (i.e. there's additional headroom beyond the discretionary slice).
    if (livingRemainder > funMoney + 0.01) {
      opts.push({
        id: LIVING_POOL,
        label: 'Savings (Living Pool)',
        available: livingRemainder,
      });
    }
    finance.goals.forEach(g => {
      opts.push({
        id: g.id,
        label: g.name,
        available: finance.convertToBase(g.assigned_amount || 0, g.currency),
        cap: finance.convertToBase(g.target_amount, g.currency),
      });
    });
    return opts;
  }, [finance.goals, funMoney, livingRemainder]);

  // Stacked bar segments — Emergency + Goals + Living Pool always sum to totalCash.
  // Goal amounts must be converted to base currency (goals can be stored in AUD while base is GBP).
  const goalSegments = finance.goals
    .filter(g => (g.assigned_amount || 0) > 0)
    .map(g => ({
      label: g.name,
      amount: finance.convertToBase(g.assigned_amount || 0, g.currency),
      color: g.color || '#4558ff',
    }));
  const assignedGoalsTotal = goalSegments.reduce((s, seg) => s + seg.amount, 0);
  const accountedFor = emergencyFloor + assignedGoalsTotal + livingRemainder;
  const shortfall = Math.max(0, totalCash - accountedFor);

  const segments = [
    { label: 'Emergency', amount: Math.min(emergencyFloor, totalCash), color: '#ef6b6b' },
    ...goalSegments,
    { label: 'Living Pool', amount: livingRemainder, color: '#FFB8E6' },
    ...(shortfall > 0.01 ? [{ label: 'Unallocated', amount: shortfall, color: '#e5e7eb' }] : []),
  ];
  const totalForBar = Math.max(totalCash, segments.reduce((s, seg) => s + seg.amount, 0)) || 1;

  const handleEditGoal = async () => {
    if (!editGoalId || !editName.trim() || !editTarget) return;
    // If marking as stash, clear is_stash from any other goal first
    if (editIsStash) {
      const currentStash = finance.goals.find(g => (g as any).is_stash === true && g.id !== editGoalId);
      if (currentStash) {
        await finance.updateGoal(currentStash.id, { is_stash: false } as any);
      }
    }
    await finance.updateGoal(editGoalId, {
      name: editName.trim(),
      target_amount: parseFloat(editTarget),
      currency: editCurrency,
      color: editColor,
      is_stash: editIsStash,
      percent_allocation: parseFloat(editPercentAllocation) || 0,
      deadline: editDeadline || null,
    } as any);
    toast.success('Pool updated');
    setEditOpen(false);
    setEditGoalId(null);
  };

  const openEditDialog = (goal: typeof finance.goals[0]) => {
    setEditGoalId(goal.id);
    setEditName(goal.name);
    setEditTarget(String(goal.target_amount));
    setEditCurrency(goal.currency);
    setEditColor(goal.color || POOL_COLORS[0]);
    setEditIsStash((goal as any).is_stash === true);
    setEditPercentAllocation(String(goal.percent_allocation || 0));
    setEditDeadline(goal.deadline || '');
    setEditOpen(true);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newAmount) return;
    await finance.addGoal({
      name: newName.trim(),
      target_amount: parseFloat(newAmount),
      currency: newCurrency,
      priority: finance.goals.length + 1,
      safety_mode: 'balanced',
      color: newColor,
      percent_allocation: parseFloat(newPercentAllocation) || 0,
      deadline: newDeadline || null,
    } as any);
    setNewName(''); setNewAmount(''); setNewColor(POOL_COLORS[0]); setNewPercentAllocation('0'); setNewDeadline(''); setCreateOpen(false);
  };

  const handleMoveFunds = async () => {
    const val = parseFloat(moveAmount);
    if (!moveFrom || !moveTo || moveFrom === moveTo || isNaN(val) || val <= 0) {
      toast.error('Please select two different pools and enter an amount');
      return;
    }

    // Check source has enough
    const source = poolOptions.find(p => p.id === moveFrom);
    if (!source || val > source.available) {
      toast.error(`Not enough in "${source?.label}" — only ${fmt(source?.available ?? 0)} available`);
      return;
    }

    // val is in base currency; check destination cap in base too
    const dest = poolOptions.find(p => p.id === moveTo);
    if (dest && !isVirtualPool(dest.id) && dest.cap !== undefined) {
      const destGoal = finance.goals.find(g => g.id === dest.id);
      const currentAssignedBase = destGoal
        ? finance.convertToBase(destGoal.assigned_amount || 0, destGoal.currency)
        : 0;
      if (currentAssignedBase + val > dest.cap) {
        toast.error(`Would exceed ${dest.label}'s target of ${fmt(dest.cap)}`);
        return;
      }
    }

    // Helper: convert base-currency amount back to a goal's native currency
    const toGoalCurrency = (baseAmt: number, currency: string) => {
      const oneInBase = finance.convertToBase(1, currency);
      return oneInBase === 0 ? baseAmt : baseAmt / oneInBase;
    };

    // Execute: decrease source, increase destination
    const updates: Promise<void>[] = [];

    if (!isVirtualPool(moveFrom)) {
      const goal = finance.goals.find(g => g.id === moveFrom);
      if (goal) {
        const deltaNative = toGoalCurrency(val, goal.currency);
        updates.push(
          finance.updateGoal(goal.id, { assigned_amount: Math.max(0, (goal.assigned_amount || 0) - deltaNative) } as any)
        );
      }
    }
    // Virtual sources (Fun Money / Living Pool) have no DB update — they're derived.

    if (!isVirtualPool(moveTo)) {
      const goal = finance.goals.find(g => g.id === moveTo);
      if (goal) {
        const deltaNative = toGoalCurrency(val, goal.currency);
        updates.push(
          finance.updateGoal(goal.id, { assigned_amount: (goal.assigned_amount || 0) + deltaNative } as any)
        );
      }
    }
    // Virtual destinations are also derived — only the source side needs a write.

    await Promise.all(updates);
    toast.success(`Moved ${fmt(val)} from ${source?.label} → ${dest?.label}`);
    setMoveOpen(false);
    setMoveFrom('');
    setMoveTo('');
    setMoveAmount('');
  };

  if (finance.loading || assumptionsLoading) {
    return (
      <div className="space-y-6 w-full font-body -mx-4 sm:-mx-6 -my-6 px-4 sm:px-6 py-6 min-h-screen bg-[#FFF5FA]">
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Money Pools</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full font-body -mx-4 sm:-mx-6 -my-6 px-4 sm:px-6 py-6 min-h-screen bg-[#FFF5FA]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Money Pools</h1>
          <p className="text-muted-foreground text-sm">Every dollar has a job — allocate your cash into pools</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-9"
          onClick={() => setMoveOpen(true)}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" /> Move Funds
        </Button>
      </div>

      <Tabs defaultValue="pools" className="space-y-6">
        <TabsList className="bg-white/80 backdrop-blur-md p-1.5 rounded-2xl w-fit h-auto shadow-sm border border-[#FF7AD1]/30 gap-1">
          <TabsTrigger
            value="pools"
            className="px-5 sm:px-6 py-2.5 rounded-xl font-display font-semibold text-sm text-[#FF2EB8] data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-[#FF2EB8]/25 transition-all"
          >
            Money Pools
          </TabsTrigger>
          <TabsTrigger
            value="balance-sheet"
            className="px-5 sm:px-6 py-2.5 rounded-xl font-display font-semibold text-sm text-[#FF2EB8] data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-[#FF2EB8]/25 transition-all"
          >
            Balance Sheet & Net Worth
          </TabsTrigger>
          <TabsTrigger
            value="allocate"
            className="px-5 sm:px-6 py-2.5 rounded-xl font-display font-semibold text-sm text-[#FF2EB8] data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-[#FF2EB8]/25 transition-all"
          >
            Allocate Leftover
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pools" className="space-y-6">
      {/* Total Cash Hero */}

      <div className="bg-white rounded-3xl border-2 border-[#FF7AD1]/30 p-6 shadow-[6px_6px_0px_0px_rgba(255,46,184,0.1)]">
        <p className="text-[#FF2EB8] text-xs font-display font-bold uppercase tracking-[0.18em] mb-1">Total Across All Accounts</p>
        <p className="text-4xl sm:text-5xl font-display font-black text-slate-900 leading-tight">{fmt(totalCash)}</p>

        {/* Stacked bar */}
        <div className="mt-5 flex rounded-full overflow-hidden h-4 bg-muted/65 shadow-inner">
          {segments.map((seg, i) => {
            const pct = (seg.amount / totalForBar) * 100;
            if (pct < 0.5) return null;
            return (
              <div
                key={i}
                className="h-full transition-all relative group"
                style={{ width: `${pct}%`, backgroundColor: seg.color }}
                title={`${seg.label}: ${fmt(seg.amount)}`}
              />
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-semibold text-slate-600">
          {segments.filter(s => s.amount > 0).map((seg, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
              {seg.label}: <span className="text-slate-900 font-bold">{fmt(seg.amount)}</span>
              {seg.label === 'Emergency' && totalCash < emergencyFloor && (
                <span className="text-rose-600 font-bold text-[11px] ml-0.5">
                  ({fmt(emergencyFloor - Math.min(totalCash, emergencyFloor))} short)
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Weekly Pool Savings Engine Card */}
      <WeeklyPoolSavingsCard finance={finance} spendablePool={spendablePool} funMoney={funMoney} />

      {/* Pools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Emergency Fund */}
        {(() => {
          const currentFunded = Math.min(totalCash, emergencyFloor);
          const shortfallAmt = Math.max(0, emergencyFloor - currentFunded);
          const isShort = shortfallAmt > 0.01;
          const fundPct = emergencyFloor > 0 ? Math.min(100, (currentFunded / emergencyFloor) * 100) : 100;

          return (
            <div className={`bg-white rounded-2xl border-2 ${isShort ? 'border-[#ef6b6b]/60 shadow-[4px_4px_0px_0px_rgba(239,107,107,0.15)]' : 'border-emerald-300 shadow-[4px_4px_0px_0px_rgba(16,185,129,0.15)]'} p-5 transition-all flex flex-col justify-between hover:scale-[1.01]`}>
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl ${isShort ? 'bg-[#ef6b6b]/10' : 'bg-emerald-100'} flex items-center justify-center flex-shrink-0`}>
                      <Lock className={`w-5 h-5 ${isShort ? 'text-[#ef6b6b]' : 'text-emerald-600'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-base font-bold text-slate-900">Emergency Fund</h3>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground border-slate-200">Auto-calculated</Badge>
                      </div>
                    </div>
                  </div>
                  {isShort ? (
                    <Badge className="bg-rose-100 text-rose-700 border border-rose-200 font-display font-extrabold text-xs px-2.5 py-1 rounded-full shrink-0">
                      {fmt(shortfallAmt)} short
                    </Badge>
                  ) : (
                    <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 font-display font-bold text-xs px-2.5 py-1 rounded-full shrink-0">
                      Fully Funded
                    </Badge>
                  )}
                </div>

                <div className="mt-3">
                  <div className="flex items-baseline justify-between flex-wrap gap-1">
                    <span className="text-3xl font-display font-black text-slate-900 tracking-tight">
                      {fmt(currentFunded)}
                    </span>
                    <span className="text-xs font-display font-semibold text-slate-500">
                      Target Floor: <strong className="text-slate-800 font-bold">{fmt(emergencyFloor)}</strong>
                    </span>
                  </div>

                  {/* Funding Progress Bar */}
                  <div className="mt-2.5 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all rounded-full ${isShort ? 'bg-[#ef6b6b]' : 'bg-emerald-500'}`}
                      style={{ width: `${fundPct}%` }}
                    />
                  </div>

                  {isShort && (
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-rose-600 font-display font-bold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fmt(shortfallAmt)} short
                      </span>
                      <span className="text-slate-500 font-semibold">{fundPct.toFixed(0)}% saved</span>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-slate-500 mt-4 pt-3 border-t border-slate-100 font-medium">
                {bufferMonths}mo × {fmt(actualMonthlySurvival)}/mo × 1.2 buffer
              </p>
            </div>
          );
        })()}

        {/* Living / Spending Pool */}
        <div className="bg-white rounded-2xl border-2 border-[#FF2EB8]/45 p-5 shadow-[4px_4px_0px_0px_rgba(255,46,184,0.12)] md:col-span-2 lg:col-span-2 hover:scale-[1.01] hover:shadow-[6px_6px_0px_0px_rgba(255,46,184,0.15)] transition-all flex flex-col justify-between">
          <div>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <ShoppingCart className="w-5 h-5 text-[#FF2EB8]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-base font-bold text-slate-900">Living Pool</h3>
                  {isDrawdown && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200 bg-amber-50">Drawdown</Badge>}
                </div>
                <p className="text-3xl font-black text-slate-900 tracking-tight">{fmt(livingRemainder)}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  {isDrawdown ? `Over ${Math.round(weeksUntilIncome)} weeks` : 'After emergency + goals'}
                </p>
              </div>
            </div>

            {/* Sub-breakdown */}
            <div className="space-y-3 border-t border-slate-100 pt-4">
              {targetSavings > 0 && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600 font-medium">
                      <span className="w-2 h-2 rounded-full bg-[#8b5cf6] flex-shrink-0" />
                      🎯 Target Savings
                    </span>
                    <span className="font-bold text-slate-900">{fmt(targetSavings)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 ml-4 -mt-2">
                    Protected — want this left when income starts
                  </p>
                </>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-800 font-bold">
                  Spendable Pool
                </span>
                <span className="font-extrabold text-slate-900">{fmt(spendablePool)}</span>
              </div>

              <div className="border-t border-dashed border-slate-200 my-2.5" />

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-[#FF2EB8]/60 flex-shrink-0" />
                  📋 Fixed Bills Reserve
                </span>
                <span className="font-bold text-slate-900">{fmt(fixedReserve)}</span>
              </div>
              <p className="text-[11px] text-slate-400 ml-4 -mt-2">
                {fmt(fixedMonthlyTotal)}/mo{isDrawdown ? ` × ${Math.round(weeksUntilIncome)} wks` : ''}
              </p>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-[#8b5cf6]/60 flex-shrink-0" />
                  🛒 Essential Variable
                </span>
                <span className="font-bold text-slate-900">{fmt(essentialReserve)}</span>
              </div>
              <p className="text-[11px] text-slate-400 ml-4 -mt-2">
                {fmt(essentialVariable)}/mo — based on last 4 normal weeks
              </p>

              <div className="border-t border-dashed border-slate-200 my-2.5" />

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-bold text-[#FF2EB8]">
                  <span className="w-2 h-2 rounded-full bg-[#FFB8E6] flex-shrink-0" />
                  💰 Fun Money
                </span>
                <span className="font-extrabold text-[#FF2EB8] text-xl">{fmt(funMoney)}</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium ml-4 -mt-2">
                {fmt(weeklyFromRemainder)}/wk — your weekly discretionary budget
              </p>
            </div>
          </div>
        </div>

        {/* Goal Pool Cards */}
        {finance.goals.map(goal => {
          const assigned = goal.assigned_amount || 0;
          const tripInfo = goalTripSpent.get(goal.id);
          const tripSpent = tripInfo?.spent || 0;
          const remaining = Math.max(0, assigned - tripSpent);
          const displayAmount = tripInfo ? remaining : assigned;
          const pct = Math.min((displayAmount / goal.target_amount) * 100, 100);
          const goalColor = goal.color || '#4558ff';
          const GoalIcon = getPoolIcon(goal.name);
          return (
            <div
              key={goal.id}
              className="bg-white rounded-2xl border-2 p-5 transition-all hover:scale-[1.01] flex flex-col justify-between"
              style={{
                borderColor: `${goalColor}45`,
                boxShadow: `4px 4px 0px 0px ${goalColor}12`,
              }}
            >
              <div className="space-y-4 w-full">
                {/* Header: icon + name */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="w-10 h-10 rounded-xl flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-2 ring-offset-background transition-all flex items-center justify-center"
                          style={{ backgroundColor: goalColor }}
                          title="Change color"
                        >
                          <GoalIcon className="w-5 h-5 text-white" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-3" align="start">
                        <div className="grid grid-cols-6 gap-1.5">
                          {POOL_COLORS.map(c => (
                            <button
                              key={c}
                              className="w-7 h-7 rounded-md transition-all hover:scale-110"
                              style={{
                                backgroundColor: c,
                                outline: c === goalColor ? '2px solid hsl(var(--foreground))' : 'none',
                                outlineOffset: 2,
                              }}
                              onClick={() => finance.updateGoal(goal.id, { color: c } as any)}
                            />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <div className="min-w-0 flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-bold text-slate-900 truncate">{goal.name}</h3>
                        {(goal as any).is_stash && <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-slate-100 text-slate-600 border border-slate-200">Stash</Badge>}
                        {tripInfo && <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-sky-200 text-sky-600 bg-sky-50">Trip</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-950 hover:bg-slate-50 transition-colors"
                      onClick={() => openEditDialog(goal)}
                      title="Edit pool"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:text-destructive hover:bg-red-50 transition-colors"
                      onClick={() => finance.deleteGoal(goal.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Amount + progress */}
                <div className="w-full">
                  <div className="flex items-baseline justify-between mb-2">
                    <div>
                      <span className="text-2xl font-black tracking-tight" style={{ color: goalColor }}>
                        {formatCurrency(finance.convertToBase(displayAmount, goal.currency), baseCurrency)}
                      </span>
                      <span className="text-xs text-slate-400 ml-1 font-semibold">
                        / {formatCurrency(finance.convertToBase(goal.target_amount, goal.currency), baseCurrency)}
                      </span>
                    </div>
                    <span className="text-xs font-bold tabular-nums" style={{ color: goalColor }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden shadow-inner">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: goalColor }} />
                  </div>
                  {tripInfo && tripSpent > 0 && (
                    <p className="text-[11px] text-slate-500 font-medium mt-2">
                      {formatCurrency(finance.convertToBase(assigned, goal.currency), baseCurrency)} funded − {formatCurrency(finance.convertToBase(tripSpent, goal.currency), baseCurrency)} spent on trip
                    </p>
                  )}
                </div>

                {/* Due date & required allocation stats */}
                <div className="text-xs space-y-1.5 border-t border-slate-100 pt-3 mt-1">
                  {goal.deadline ? (() => {
                    const dl = new Date(goal.deadline);
                    const now = new Date();
                    const daysRemaining = Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    const isOverdue = daysRemaining < 0;
                    const daysLabel = isOverdue 
                      ? 'Overdue' 
                      : daysRemaining === 0 
                        ? 'Due today' 
                        : `${daysRemaining}d left`;
                    const daysRemainingClamped = Math.max(1, daysRemaining);
                    const weeksRemaining = daysRemainingClamped / 7;
                    const targetVal = finance.convertToBase(goal.target_amount || 0, goal.currency);
                    const assignedVal = finance.convertToBase(goal.assigned_amount || 0, goal.currency);
                    const remaining = Math.max(0, targetVal - assignedVal);
                    const weeklyRequired = remaining / weeksRemaining;
                    const monthlyRequired = weeklyRequired * 4.33;
                    
                    return (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">Due Date:</span>
                          <span className="font-bold text-slate-800">
                            {format(dl, 'MMM d, yyyy')} ({daysLabel})
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">Weekly Pace:</span>
                          <span className="font-extrabold text-indigo-600">
                            {formatCurrency(weeklyRequired, baseCurrency)}/wk
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">Left to Save:</span>
                          <span className="font-extrabold text-slate-700">
                            {formatCurrency(remaining, baseCurrency)}
                          </span>
                        </div>
                      </>
                    );
                  })() : (
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">Proportional Allocation:</span>
                      <span className="font-bold text-slate-800">
                        {goal.percent_allocation || 0}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1 w-full">
                  <Button
                    size="sm" variant="outline" className="h-8 text-xs font-semibold gap-1.5 flex-1 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                    onClick={() => {
                      setMoveFrom(UNALLOCATED);
                      setMoveTo(goal.id);
                      setMoveAmount('');
                      setMoveOpen(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add funds
                  </Button>
                  {assigned > 0 && (
                    <Button
                      size="sm" variant="ghost" className="h-8 text-xs font-semibold gap-1 text-slate-500 hover:text-slate-900 transition-colors"
                      onClick={() => {
                        setMoveFrom(goal.id);
                        setMoveTo('');
                        setMoveAmount('');
                        setMoveOpen(true);
                      }}
                    >
                      <ArrowRightLeft className="w-3 h-3" /> Move out
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Add Pool Card */}
        <div
          className="bg-white/45 rounded-2xl border-2 border-dashed border-[#FF2EB8]/30 hover:border-[#FF2EB8]/60 p-5 hover:bg-white/70 hover:scale-[1.01] transition-all flex flex-col items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer min-h-[170px]"
          onClick={() => setCreateOpen(true)}
        >
          <div className="w-12 h-12 rounded-full bg-[#FF2EB8]/10 flex items-center justify-center text-[#FF2EB8] mb-2 shadow-inner">
            <Plus className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold tracking-tight">Add Pool</p>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="balance-sheet" className="space-y-6">
          <FinanceBalanceSheet />
        </TabsContent>

        <TabsContent value="allocate" className="space-y-4">
          <PriorMonthAllocator
            transactions={finance.transactions}
            categories={finance.categories}
            goals={finance.goals}
            convertToBase={finance.convertToBase}
            updateGoal={finance.updateGoal}
          />
        </TabsContent>
      </Tabs>

      {/* Create Pool Dialog */}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Pool</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Pool Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Europe Trip" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Target Amount</Label>
                <Input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="5000" />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={newCurrency} onValueChange={setNewCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Monthly Proportional Allocation (%)</Label>
              <Input type="number" value={newPercentAllocation} onChange={e => setNewPercentAllocation(e.target.value)} placeholder="15" min="0" max="100" />
              <p className="text-[10px] text-muted-foreground">Used if no due date is set.</p>
            </div>
            <div className="space-y-2">
              <Label>Target Date / Due Date (Optional)</Label>
              <Input type="date" value={newDeadline} onChange={e => setNewDeadline(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">If set, calculates the exact monthly target savings to hit this goal in time.</p>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-1.5">
                {POOL_COLORS.map(c => (
                  <button
                    key={c}
                    className="w-7 h-7 rounded-md transition-all hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: c === newColor ? '2px solid hsl(var(--foreground))' : 'none',
                      outlineOffset: 2,
                    }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
            </div>
            <Button onClick={handleCreate} className="w-full">Create Pool</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Pool Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Pool</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Pool Name</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Target Amount</Label>
                <Input type="number" value={editTarget} onChange={e => setEditTarget(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={editCurrency} onValueChange={setEditCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Monthly Proportional Allocation (%)</Label>
              <Input type="number" value={editPercentAllocation} onChange={e => setEditPercentAllocation(e.target.value)} min="0" max="100" />
              <p className="text-[10px] text-muted-foreground">Used if no due date is set.</p>
            </div>
            <div className="space-y-2">
              <Label>Target Date / Due Date (Optional)</Label>
              <Input type="date" value={editDeadline} onChange={e => setEditDeadline(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">If set, calculates the exact monthly target savings to hit this goal in time.</p>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-1.5">
                {POOL_COLORS.map(c => (
                  <button
                    key={c}
                    className="w-7 h-7 rounded-md transition-all hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: c === editColor ? '2px solid hsl(var(--foreground))' : 'none',
                      outlineOffset: 2,
                    }}
                    onClick={() => setEditColor(c)}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Savings Stash</Label>
                <p className="text-xs text-muted-foreground">Leftover budget accumulates here</p>
              </div>
              <Switch checked={editIsStash} onCheckedChange={setEditIsStash} />
            </div>
            <Button onClick={handleEditGoal} className="w-full">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>


      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5" /> Move Funds Between Pools
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Select value={moveFrom} onValueChange={setMoveFrom}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source pool" />
                </SelectTrigger>
                <SelectContent>
                  {poolOptions.filter(p => p.available > 0 && p.id !== moveTo).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label} — {fmt(p.available)} available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {moveFrom === LIVING_POOL && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                  Heads up: this dips into bills/essentials reserve, so your runway will shorten.
                </p>
              )}
            </div>

            <div className="flex justify-center">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Select value={moveTo} onValueChange={setMoveTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination pool" />
                </SelectTrigger>
                <SelectContent>
                  {poolOptions.filter(p => p.id !== moveFrom).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                      {p.cap !== undefined ? ` — ${fmt(p.available)}/${fmt(p.cap)}` : ` — ${fmt(p.available)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Amount</Label>
              <Input
                type="number"
                value={moveAmount}
                onChange={e => setMoveAmount(e.target.value)}
                placeholder="0.00"
              />
              {moveFrom && (
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => {
                    const source = poolOptions.find(p => p.id === moveFrom);
                    if (source) {
                      // If dest has a cap, clamp to remaining room
                      let max = source.available;
                      if (moveTo && !isVirtualPool(moveTo)) {
                        const dest = poolOptions.find(p => p.id === moveTo);
                        if (dest?.cap !== undefined) {
                          max = Math.min(max, dest.cap - dest.available);
                        }
                      }
                      setMoveAmount(String(Math.max(0, max)));
                    }
                  }}
                >
                  Use max available
                </button>
              )}
            </div>

            {/* Preview */}
            {moveFrom && moveTo && moveAmount && parseFloat(moveAmount) > 0 && (
              <div className="p-3 rounded-lg bg-muted/50 border text-sm space-y-1">
                <p className="font-medium text-foreground">Preview</p>
                <p className="text-muted-foreground">
                  {poolOptions.find(p => p.id === moveFrom)?.label}: {fmt((poolOptions.find(p => p.id === moveFrom)?.available ?? 0) - parseFloat(moveAmount))}
                  {' '}(was {fmt(poolOptions.find(p => p.id === moveFrom)?.available ?? 0)})
                </p>
                <p className="text-muted-foreground">
                  {poolOptions.find(p => p.id === moveTo)?.label}: {fmt((poolOptions.find(p => p.id === moveTo)?.available ?? 0) + parseFloat(moveAmount))}
                  {' '}(was {fmt(poolOptions.find(p => p.id === moveTo)?.available ?? 0)})
                </p>
              </div>
            )}

            <Button onClick={handleMoveFunds} className="w-full" disabled={!moveFrom || !moveTo || !moveAmount}>
              Move {moveAmount ? fmt(parseFloat(moveAmount) || 0) : 'Funds'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
