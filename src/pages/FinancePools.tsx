import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, ShoppingCart, Target, Wallet, Lock, ArrowRightLeft, Trash2, Palette, Plane, Car, Home, GraduationCap, Heart, Gift, Laptop, Baby, PiggyBank, Briefcase, UtensilsCrossed, Dumbbell, Music, Gamepad2, BookOpen, Sparkles, Pencil, AlertCircle, RotateCcw, AlertTriangle, ChevronRight, HelpCircle, CheckCircle2, Milestone, ArrowUpRight, Check, Shield, type LucideIcon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import MonthlyPotPlanner from '@/components/finance/MonthlyPotPlanner';
import FinanceBalanceSheet from '@/pages/FinanceBalanceSheet';
import WeeklyPoolSavingsCard from '@/components/finance/WeeklyPoolSavingsCard';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { detectPaycheck, calculatePaycheckWaterfall, isPaycheckProcessed, markPaycheckProcessed, unmarkPaycheckProcessed, savePaycheckAllocationMeta, getPaycheckAllocationMeta } from '@/lib/paycheckEngine';
import { baseAmt } from '@/lib/financeUtils';
import { evaluatePoolFeasibility } from '@/lib/feasibilityEngine';
import { computeEmergencyLadder } from '@/lib/emergencyLadderEngine';
import EmergencyLadderModal from '@/components/finance/EmergencyLadderModal';
import FeasibilityAlert from '@/components/finance/FeasibilityAlert';
import OverspendCoverPanel from '@/components/finance/OverspendCoverPanel';
import FeasibilityBreakdownDialog from '@/components/finance/FeasibilityBreakdownDialog';
import PurchaseTimingEvaluator from '@/components/finance/PurchaseTimingEvaluator';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';


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
const EMERGENCY_VIRTUAL = '__emergency_virtual__';
const isVirtualPool = (id: PoolId) => id === UNALLOCATED || id === LIVING_POOL || id === EMERGENCY_VIRTUAL;

interface CapOverflowInfo {
  goalId: string | null;
  isEmergencyVirtual?: boolean;
  goalName: string;
  currency: string;
  currentAssignedNative: number;
  currentTargetNative: number;
  deltaNative: number;
  newTargetNative: number;
  moveValBase: number;
  sourceLabel: string;
}

export default function FinancePoolsPage() {
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading, update: updateAssumptions } = useFinanceAssumptions();
  const { monthlyTotalInternal: fixedMonthlyTotal, monthlyTotal: fixedMonthlyTotalAll } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap } = useWeekTypes();
  const { trips } = useFinanceTrips();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'pools';

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
  const [newDescription, setNewDescription] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCurrency, setNewCurrency] = useState('AUD');
  const [newColor, setNewColor] = useState(POOL_COLORS[0]);
  const [newPercentAllocation, setNewPercentAllocation] = useState('0');
  const [newStartDate, setNewStartDate] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  // Move funds dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFrom, setMoveFrom] = useState<PoolId>('');
  const [moveTo, setMoveTo] = useState<PoolId>('');
  const [moveAmount, setMoveAmount] = useState('');
  // Capacity overflow dialog
  const [capOverflowOpen, setCapOverflowOpen] = useState(false);
  const [capOverflowData, setCapOverflowData] = useState<CapOverflowInfo | null>(null);
  const [customNewTarget, setCustomNewTarget] = useState<string>('');
  // Edit goal dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editGoalId, setEditGoalId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editCurrency, setEditCurrency] = useState('AUD');
  const [editColor, setEditColor] = useState(POOL_COLORS[0]);
  const [editIsStash, setEditIsStash] = useState(false);
  const [editPercentAllocation, setEditPercentAllocation] = useState('0');
  const [editStartDate, setEditStartDate] = useState('');
  const [editDeadline, setEditDeadline] = useState('');

  // Feasibility breakdown dialog
  const [feasibilityDialogOpen, setFeasibilityDialogOpen] = useState(false);
  const [selectedFeasibilityGoal, setSelectedFeasibilityGoal] = useState<typeof finance.goals[0] | null>(null);
  const [selectedFeasibilityAssessment, setSelectedFeasibilityAssessment] = useState<any>(null);

  const openFeasibilityDialog = (goal: typeof finance.goals[0], assessment: any) => {
    setSelectedFeasibilityGoal(goal);
    setSelectedFeasibilityAssessment(assessment);
    setFeasibilityDialogOpen(true);
  };

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);
  const wtMap = useMemo(() => weekTypeMap(), [weekTypeMap]);

  // Auto-consolidate duplicate stashes if any exist
  const consolidateRef = useRef(false);
  useEffect(() => {
    if (finance.loading || consolidateRef.current) return;
    const stashes = finance.goals.filter(
      g => (g as any).is_stash === true || g.name.toLowerCase().includes('stash')
    );
    if (stashes.length > 1) {
      consolidateRef.current = true;
      const primary = stashes[0];
      const duplicates = stashes.slice(1);
      const extraAssigned = duplicates.reduce((sum, d) => sum + (d.assigned_amount || 0), 0);

      const runConsolidation = async () => {
        await finance.updateGoal(primary.id, {
          assigned_amount: (primary.assigned_amount || 0) + extraAssigned,
          is_stash: true,
        } as any);

        for (const dup of duplicates) {
          await finance.deleteGoal(dup.id);
        }
        toast.success(`Consolidated ${stashes.length} Savings Stashes into 1 pool`);
      };
      runConsolidation();
    } else if (stashes.length === 1 && !(stashes[0] as any).is_stash) {
      finance.updateGoal(stashes[0].id, { is_stash: true } as any);
    }
  }, [finance.goals, finance.loading]);

  const snapshot = useMemo(() => {
    if (!assumptions || finance.loading) return null;
    const now = new Date();
    const poolRefDate = now.getDate() >= 24
      ? new Date(now.getFullYear(), now.getMonth() + 1, 15)
      : now;
    return computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions, finance.categories,
      finance.goals, finance.convertToBase, fixedMonthlyTotal, undefined, wtMap, [], fixedMonthlyTotalAll,
      poolRefDate,
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, finance.loading, fixedMonthlyTotal, fixedMonthlyTotalAll, wtMap]);

  const totalCash = snapshot?.totalLiquidCash ?? 0;
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
  const rawBufferMonths = assumptions?.buffer_months ?? 1;
  const actualMonthlySurvival = snapshot?.emergencySurvivalMonthly ?? snapshot?.survivalCostMonthly ?? (fixedMonthlyTotal + essentialVariable);

  // Living & Monthly Budget Pool target (Priority #1: must be ring-fenced before Emergency Fund ladder upgrades)
  const effectiveFixedMonthly = fixedMonthlyTotalAll || fixedMonthlyTotal;
  const monthlyFunAllowance = (snapshot?.baseWeeklyFun ?? 0) * 4.33;
  const monthlyLivingTarget = effectiveFixedMonthly + essentialVariable + monthlyFunAllowance;

  const nonEmergencyGoalTotalEarly = useMemo(() => {
    return finance.goals
      .filter(g => !(g as any).is_emergency && !g.name.toLowerCase().includes('emergency'))
      .reduce((s, g) => s + finance.convertToBase(g.assigned_amount || 0, g.currency), 0);
  }, [finance.goals, finance.convertToBase]);

  // Max emergency months affordable AFTER reserving next month's Living & Monthly Budget Pool and active Goal Pools
  const costPerEmergencyMonth = actualMonthlySurvival * 1.2;
  const cashAvailableForEmergencyAfterLiving = Math.max(0, totalCash - nonEmergencyGoalTotalEarly - monthlyLivingTarget);
  const maxAffordableBufferMonths = costPerEmergencyMonth > 0
    ? Math.max(1, Math.floor((cashAvailableForEmergencyAfterLiving + 0.01) / costPerEmergencyMonth))
    : 1;
  const bufferMonths = Math.min(rawBufferMonths, maxAffordableBufferMonths);
  const emergencyFloor = bufferMonths * costPerEmergencyMonth;

  // Auto-sync buffer_months down if a prior ladder upgrade encroached on the Living & Monthly Budget Pool
  useEffect(() => {
    if (!assumptions || finance.loading || !updateAssumptions) return;
    if (totalCash > 0 && rawBufferMonths > maxAffordableBufferMonths) {
      updateAssumptions({ buffer_months: maxAffordableBufferMonths });
    }
  }, [assumptions, finance.loading, totalCash, rawBufferMonths, maxAffordableBufferMonths, updateAssumptions]);

  const [ladderDialogOpen, setLadderDialogOpen] = useState(false);
  const [ladderBannerDismissed, setLadderBannerDismissed] = useState(false);

  const targetMonthsVal = parseInt(
    String((finance.settings?.fx_rates as any)?.target_buffer_months || localStorage.getItem('gvb_target_buffer_months') || '6')
  ) || 6;

  const ladderState = useMemo(() => {
    return computeEmergencyLadder({
      activeMonths: bufferMonths,
      targetMonths: targetMonthsVal,
      monthlySurvival: actualMonthlySurvival,
      totalLiquidCash: totalCash,
      goals: finance.goals,
      convertToBase: finance.convertToBase,
      monthlyLivingReserve: monthlyLivingTarget,
    });
  }, [bufferMonths, targetMonthsVal, actualMonthlySurvival, totalCash, finance.goals, finance.convertToBase, monthlyLivingTarget]);

  const handleLevelUpEmergencyMonth = async () => {
    if (!updateAssumptions) return;
    const nextVal = bufferMonths + 1;
    await updateAssumptions({
      buffer_months: nextVal,
    });
    toast.success(`🎉 Emergency reserve successfully increased to ${nextVal} months!`);
  };

  // Sub-breakdown of living/spending pool
  const fixedReserve = isDrawdown && weeksUntilIncome > 0
    ? (fixedMonthlyTotal / 4.33) * weeksUntilIncome
    : fixedMonthlyTotal;
  const essentialReserve = isDrawdown && weeksUntilIncome > 0
    ? (essentialVariable / 4.33) * weeksUntilIncome
    : essentialVariable;
  const funMoney = Math.max(0, spendablePool - fixedReserve - essentialReserve);

  // Identify existing Emergency Reserve goal if any
  const emergencyGoal = useMemo(() => {
    return finance.goals.find(g => (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency'));
  }, [finance.goals]);

  // Real-time feasibility assessments for Create & Edit Pool dialogs
  const expectedMonthlyIncomeVal = (assumptions?.expected_monthly_income && assumptions.expected_monthly_income > 0)
    ? assumptions.expected_monthly_income
    : undefined;

  const activeFeasibilityAssessment = useMemo(() => {
    if (!selectedFeasibilityGoal) return null;
    return evaluatePoolFeasibility({
      targetAmount: finance.convertToBase(selectedFeasibilityGoal.target_amount || 0, selectedFeasibilityGoal.currency),
      currentAssigned: finance.convertToBase(selectedFeasibilityGoal.assigned_amount || 0, selectedFeasibilityGoal.currency),
      deadline: selectedFeasibilityGoal.deadline || null,
      startDate: selectedFeasibilityGoal.start_date || null,
      existingGoals: finance.goals,
      evaluatingGoalId: selectedFeasibilityGoal.id,
      transactions: finance.transactions,
      categories: finance.categories,
      fixedMonthlyExpenses: fixedMonthlyTotal,
      weeklyVariableBudget: essentialVariable / 4.33,
      expectedMonthlyIncome: expectedMonthlyIncomeVal,
      convertToBase: finance.convertToBase,
    });
  }, [selectedFeasibilityGoal, finance.goals, finance.transactions, finance.categories, fixedMonthlyTotal, essentialVariable, expectedMonthlyIncomeVal, finance.convertToBase]);

  const createFeasibility = useMemo(() => {
    const targetVal = finance.convertToBase(parseFloat(newName ? newAmount : '0') || 0, newCurrency);
    return evaluatePoolFeasibility({
      targetAmount: targetVal,
      currentAssigned: 0,
      deadline: newDeadline || null,
      startDate: newStartDate || null,
      existingGoals: finance.goals,
      transactions: finance.transactions,
      categories: finance.categories,
      fixedMonthlyExpenses: fixedMonthlyTotal,
      weeklyVariableBudget: essentialVariable / 4.33,
      expectedMonthlyIncome: expectedMonthlyIncomeVal,
      convertToBase: finance.convertToBase,
    });
  }, [newAmount, newCurrency, newDeadline, newStartDate, newName, finance.goals, finance.transactions, finance.categories, fixedMonthlyTotal, essentialVariable, assumptions, expectedMonthlyIncomeVal, finance.convertToBase]);

  const editFeasibility = useMemo(() => {
    const targetVal = finance.convertToBase(parseFloat(editTarget) || 0, editCurrency);
    const goal = editGoalId ? finance.goals.find(g => g.id === editGoalId) : null;
    const assignedVal = goal ? finance.convertToBase(goal.assigned_amount || 0, goal.currency) : 0;

    return evaluatePoolFeasibility({
      targetAmount: targetVal,
      currentAssigned: assignedVal,
      deadline: editDeadline || null,
      startDate: editStartDate || null,
      existingGoals: finance.goals,
      evaluatingGoalId: editGoalId,
      transactions: finance.transactions,
      categories: finance.categories,
      fixedMonthlyExpenses: fixedMonthlyTotal,
      weeklyVariableBudget: essentialVariable / 4.33,
      expectedMonthlyIncome: expectedMonthlyIncomeVal,
      convertToBase: finance.convertToBase,
    });
  }, [editTarget, editCurrency, editDeadline, editStartDate, editGoalId, finance.goals, finance.transactions, finance.categories, fixedMonthlyTotal, essentialVariable, assumptions, expectedMonthlyIncomeVal, finance.convertToBase]);

  const emergencyGoalAssigned = useMemo(() => {
    if (!emergencyGoal) return 0;
    return finance.convertToBase(emergencyGoal.assigned_amount || 0, emergencyGoal.currency);
  }, [emergencyGoal, finance.convertToBase]);

  const otherGoalSegments = useMemo(() => {
    return finance.goals
      .filter(g => !(g as any).is_emergency && !g.name.toLowerCase().includes('emergency'))
      .filter(g => (g.assigned_amount || 0) > 0)
      .map(g => ({
        label: g.name,
        amount: finance.convertToBase(g.assigned_amount || 0, g.currency),
        color: g.color || '#4558ff',
      }));
  }, [finance.goals, finance.convertToBase]);

  const sortedNonEmergencyGoals = useMemo(() => {
    const nonEmergency = finance.goals.filter(
      g => !(g as any).is_emergency && !g.name.toLowerCase().includes('emergency')
    );
    return [...nonEmergency].sort((a, b) => {
      const aAssigned = a.assigned_amount || 0;
      const aTripInfo = goalTripSpent.get(a.id);
      const aSpent = aTripInfo?.spent || 0;
      const aRemaining = Math.max(0, aAssigned - aSpent);
      const aHit = a.target_amount > 0 && (aTripInfo ? aRemaining : aAssigned) >= a.target_amount;

      const bAssigned = b.assigned_amount || 0;
      const bTripInfo = goalTripSpent.get(b.id);
      const bSpent = bTripInfo?.spent || 0;
      const bRemaining = Math.max(0, bAssigned - bSpent);
      const bHit = b.target_amount > 0 && (bTripInfo ? bRemaining : bAssigned) >= b.target_amount;

      // 1. Completed / Fully funded goals go to the bottom (last)
      if (aHit !== bHit) {
        return aHit ? 1 : -1;
      }

      // 2. Soonest due date first
      const aHasDeadline = !!a.deadline;
      const bHasDeadline = !!b.deadline;

      if (aHasDeadline && bHasDeadline) {
        const aDate = new Date(String(a.deadline).split('T')[0] + 'T00:00:00').getTime();
        const bDate = new Date(String(b.deadline).split('T')[0] + 'T00:00:00').getTime();
        return aDate - bDate;
      }

      // Pools with deadlines come before pools without deadlines
      if (aHasDeadline !== bHasDeadline) {
        return aHasDeadline ? -1 : 1;
      }

      return (a.priority || 99) - (b.priority || 99);
    });
  }, [finance.goals, goalTripSpent]);

  const assignedOtherGoalsTotal = otherGoalSegments.reduce((s, seg) => s + seg.amount, 0);
  const unassignedCash = Math.max(0, totalCash - assignedOtherGoalsTotal);

  // Ring-fence Living & Monthly Budget Pool FIRST so next month's living is never starved
  const livingPoolReserved = Math.min(unassignedCash, monthlyLivingTarget);
  const cashAfterLivingReserve = Math.max(0, unassignedCash - livingPoolReserved);

  // Cash for emergency includes explicitly assigned emergency funds + remaining cash after Living Pool reserve
  const cashForEmergency = Math.max(emergencyGoalAssigned, cashAfterLivingReserve);
  const currentEmergencyFunded = Math.min(emergencyFloor, cashForEmergency);
  const emergencyShortfallAmt = Math.max(0, emergencyFloor - currentEmergencyFunded);
  const isEmergencyFull = emergencyShortfallAmt <= 0.01;

  // Stacked bar segments
  const goalSegments = finance.goals
    .filter(g => (g.assigned_amount || 0) > 0)
    .map(g => ({
      label: g.name,
      amount: finance.convertToBase(g.assigned_amount || 0, g.currency),
      color: g.color || '#4558ff',
    }));
  const assignedGoalsTotal = goalSegments.reduce((s, seg) => s + seg.amount, 0);

  const unallocatedSurplusCash = Math.max(0, unassignedCash - livingPoolReserved - currentEmergencyFunded);
  const unassignedCashAmount = livingPoolReserved + unallocatedSurplusCash;
  const livingPoolCash = unassignedCashAmount;

  // Build pool options for the move dialog — Living Pool reserve (monthlyLivingTarget) is untouchable; only surplus above it is movable
  const poolOptions: { id: PoolId; label: string; available: number; cap?: number }[] = useMemo(() => {
    const opts: { id: PoolId; label: string; available: number; cap?: number }[] = [];
    opts.push({
      id: LIVING_POOL,
      label: 'Living Pool Surplus (above Ring-Fenced Month Budget)',
      available: unallocatedSurplusCash,
    });
    if (unallocatedSurplusCash > 0.01) {
      opts.push({
        id: UNALLOCATED,
        label: 'Unallocated Surplus (above Living Budget)',
        available: unallocatedSurplusCash,
      });
    }

    // Emergency Reserve pool option
    const emId = emergencyGoal ? emergencyGoal.id : EMERGENCY_VIRTUAL;
    const emAvailable = emergencyGoal ? emergencyGoalAssigned : currentEmergencyFunded;
    opts.push({
      id: emId,
      label: 'Emergency Reserve',
      available: emAvailable,
      cap: emergencyFloor,
    });

    finance.goals.forEach(g => {
      if ((g as any).is_emergency || g.name.toLowerCase().includes('emergency')) return;
      opts.push({
        id: g.id,
        label: g.name,
        available: finance.convertToBase(g.assigned_amount || 0, g.currency),
        cap: finance.convertToBase(g.target_amount, g.currency),
      });
    });
    return opts;
  }, [finance.goals, livingPoolCash, unallocatedSurplusCash, emergencyGoal, emergencyGoalAssigned, currentEmergencyFunded, emergencyFloor, finance.convertToBase]);

  const emergencyMonthsCovered = actualMonthlySurvival > 0 ? (currentEmergencyFunded / actualMonthlySurvival) : 0;
  const isEmergencyShort = emergencyShortfallAmt > 0.01;
  const emergencySegColor = (isEmergencyShort || emergencyMonthsCovered < 2) ? '#f43f5e' : emergencyMonthsCovered < 3 ? '#f59e0b' : '#10b981';

  const segments = [
    ...(currentEmergencyFunded > 0 ? [{ label: 'Emergency Reserve', amount: currentEmergencyFunded, color: emergencySegColor }] : []),
    ...(livingPoolReserved > 0.01 ? [{ label: 'Living & Budget Pool', amount: livingPoolReserved, color: '#0ea5e9' }] : []),
    ...otherGoalSegments,
    ...(unallocatedSurplusCash > 0.01 ? [{ label: 'Unallocated Surplus', amount: unallocatedSurplusCash, color: '#FFB8E6' }] : []),
  ];
  const totalForBar = Math.max(totalCash, segments.reduce((s, seg) => s + seg.amount, 0)) || 1;

  // Paycheck Detection & Auto-Waterfall Engine
  const detectedPaycheck = useMemo(
    () => detectPaycheck(finance.transactions, finance.categories),
    [finance.transactions, finance.categories]
  );

  const targetMonthDate = useMemo(() => {
    const now = new Date();
    return now.getDate() >= 25 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : now;
  }, []);

  const targetMonthLabel = detectedPaycheck?.targetMonthName || format(targetMonthDate, 'MMMM yyyy');

  const paycheckTx = detectedPaycheck?.transaction || null;

  const [paycheckAllocated, setPaycheckAllocated] = useState(false);
  const [revertSecondsLeft, setRevertSecondsLeft] = useState<number>(0);
  const [isReverting, setIsReverting] = useState(false);

  useEffect(() => {
    if (!paycheckTx) return;
    const isProc = isPaycheckProcessed(paycheckTx);
    setPaycheckAllocated(isProc);

    // If marked processed locally, sync to database so mobile sees it as already sorted
    if (localStorage.getItem(`paycheck_processed_${paycheckTx.id}`) === 'true' && !paycheckTx.raw?.paycheck_allocated) {
      finance.updateTransaction(paycheckTx.id, {
        raw: {
          ...((paycheckTx.raw as any) || {}),
          paycheck_allocated: true,
          allocated_at: Date.now(),
        }
      });
    }

    if (isProc) {
      const meta = getPaycheckAllocationMeta(paycheckTx.id);
      if (meta) {
        const elapsedSec = Math.floor((Date.now() - meta.allocatedAt) / 1000);
        const remainingSec = Math.max(0, 120 - elapsedSec);
        setRevertSecondsLeft(remainingSec);
      } else {
        setRevertSecondsLeft(0);
      }
    } else {
      setRevertSecondsLeft(0);
    }
  }, [paycheckTx]);

  // Live 1-second countdown interval when revertSecondsLeft > 0
  useEffect(() => {
    if (!paycheckAllocated || revertSecondsLeft <= 0 || !paycheckTx) return;

    const interval = setInterval(() => {
      const meta = getPaycheckAllocationMeta(paycheckTx.id);
      if (meta) {
        const elapsedSec = Math.floor((Date.now() - meta.allocatedAt) / 1000);
        const remainingSec = Math.max(0, 120 - elapsedSec);
        setRevertSecondsLeft(remainingSec);
      } else {
        setRevertSecondsLeft(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [paycheckAllocated, revertSecondsLeft, paycheckTx]);

  const waterfallBreakdown = useMemo(() => {
    if (!paycheckTx) return null;
    const pAmt = baseAmt(paycheckTx);
    return calculatePaycheckWaterfall(
      pAmt,
      emergencyFloor,
      currentEmergencyFunded,
      finance.goals,
      fixedMonthlyTotal,
      essentialVariable,
      finance.convertToBase
    );
  }, [paycheckTx, emergencyFloor, currentEmergencyFunded, finance.goals, fixedMonthlyTotal, essentialVariable, finance.convertToBase]);

  const handleExecutePaycheckAllocation = async () => {
    if (!paycheckTx || !waterfallBreakdown || paycheckAllocated) return;
    try {
      // 1. Top up emergency fund if needed
      if (waterfallBreakdown.emergencyTopUp > 0) {
        const emergencyGoal = finance.goals.find(g => (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency'));
        if (emergencyGoal) {
          const oneInBase = finance.convertToBase(1, emergencyGoal.currency);
          const nativeTopUp = oneInBase === 0 ? waterfallBreakdown.emergencyTopUp : waterfallBreakdown.emergencyTopUp / oneInBase;
          await finance.updateGoal(emergencyGoal.id, {
            assigned_amount: (emergencyGoal.assigned_amount || 0) + nativeTopUp,
            is_emergency: true,
          } as any);
        } else {
          await finance.addGoal({
            name: 'Emergency Reserve',
            target_amount: emergencyFloor,
            currency: baseCurrency,
            priority: 1,
            safety_mode: 'balanced',
            assigned_amount: waterfallBreakdown.emergencyTopUp,
            color: '#ef6b6b',
            is_emergency: true,
          } as any);
        }
      }

      // 2. Fund goal pools with monthly targets
      for (const item of waterfallBreakdown.goalAllocations) {
        if (item.allocatedAmount <= 0) continue;
        const g = finance.goals.find(x => x.id === item.goalId);
        if (g) {
          const oneInBase = finance.convertToBase(1, g.currency);
          const nativeAdd = oneInBase === 0 ? item.allocatedAmount : item.allocatedAmount / oneInBase;
          await finance.updateGoal(g.id, {
            assigned_amount: (g.assigned_amount || 0) + nativeAdd,
          } as any);
        }
      }

      // 3. Save allocation metadata (for revert) & mark processed
      savePaycheckAllocationMeta(paycheckTx.id, waterfallBreakdown);
      markPaycheckProcessed(paycheckTx.id);
      await finance.updateTransaction(paycheckTx.id, {
        raw: {
          ...((paycheckTx.raw as any) || {}),
          paycheck_allocated: true,
          allocated_at: Date.now(),
        }
      });
      setPaycheckAllocated(true);
      setRevertSecondsLeft(120);

      toast.success(`Allocated ${fmt(paycheckTx.amount)} paycheck for ${detectedPaycheck?.targetMonthName || 'pools'}! 🚀 (Revert available for 2 mins)`);
    } catch (err) {
      console.error('Failed to allocate paycheck:', err);
      toast.error('Failed to allocate paycheck to pools');
    }
  };

  const handleRevertPaycheckAllocation = async () => {
    if (!paycheckTx || isReverting) return;
    const meta = getPaycheckAllocationMeta(paycheckTx.id);
    if (!meta) {
      toast.error('Allocation record expired or not found');
      return;
    }

    try {
      setIsReverting(true);
      const { breakdown } = meta;

      // 1. Revert emergency fund top-up
      if (breakdown.emergencyTopUp > 0) {
        const emergencyGoal = finance.goals.find(g => (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency'));
        if (emergencyGoal) {
          const oneInBase = finance.convertToBase(1, emergencyGoal.currency);
          const nativeTopUp = oneInBase === 0 ? breakdown.emergencyTopUp : breakdown.emergencyTopUp / oneInBase;
          const current = emergencyGoal.assigned_amount || 0;
          await finance.updateGoal(emergencyGoal.id, {
            assigned_amount: Math.max(0, current - nativeTopUp),
          } as any);
        }
      }

      // 2. Revert goal allocations
      for (const item of breakdown.goalAllocations) {
        if (item.allocatedAmount <= 0) continue;
        const g = finance.goals.find(x => x.id === item.goalId);
        if (g) {
          const oneInBase = finance.convertToBase(1, g.currency);
          const nativeDeduct = oneInBase === 0 ? item.allocatedAmount : item.allocatedAmount / oneInBase;
          const current = g.assigned_amount || 0;
          await finance.updateGoal(g.id, {
            assigned_amount: Math.max(0, current - nativeDeduct),
          } as any);
        }
      }

      // 3. Unmark paycheck processed
      unmarkPaycheckProcessed(paycheckTx.id);
      setPaycheckAllocated(false);
      setRevertSecondsLeft(0);

      toast.success('Paycheck allocation reverted successfully!');
    } catch (err) {
      console.error('Failed to revert paycheck allocation:', err);
      toast.error('Failed to revert paycheck allocation');
    } finally {
      setIsReverting(false);
    }
  };

  const handleEditGoal = async () => {
    if (!editGoalId || !editName.trim() || !editTarget) return;
    // If marking as stash, clear is_stash from any other goal first
    if (editIsStash) {
      const currentStash = finance.goals.find(g => (g as any).is_stash === true && g.id !== editGoalId);
      if (currentStash) {
        await finance.updateGoal(currentStash.id, { is_stash: false } as any);
      }
    }
    const existingGoal = finance.goals.find(g => g.id === editGoalId);
    const existingRawDesc = (existingGoal?.description || '').trim();
    const isInternalJson = existingRawDesc.startsWith('{');
    let nextDescription: string | null = editDescription.trim() || null;
    if (isInternalJson) {
      try {
        const parsed = JSON.parse(existingRawDesc);
        nextDescription = JSON.stringify({
          ...parsed,
          user_description: editDescription.trim() || 'Cash surplus',
        });
      } catch {
        nextDescription = existingRawDesc;
      }
    }
    await finance.updateGoal(editGoalId, {
      name: editName.trim(),
      description: nextDescription,
      target_amount: parseFloat(editTarget),
      currency: editCurrency,
      color: editColor,
      is_stash: editIsStash,
      percent_allocation: parseFloat(editPercentAllocation) || 0,
      start_date: editStartDate && editStartDate.trim() ? editStartDate.trim().split('T')[0] : null,
      deadline: editDeadline && editDeadline.trim() ? editDeadline.trim().split('T')[0] : null,
    } as any);
    toast.success('Pool updated');
    setEditOpen(false);
    setEditGoalId(null);
  };

  const openEditDialog = (goal: typeof finance.goals[0]) => {
    setEditGoalId(goal.id);
    setEditName(goal.name);
    const isStashGoal = (goal as any).is_stash === true || /stash/i.test(goal.name);
    const rawDesc = (goal.description || '').trim();
    if (rawDesc.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawDesc);
        setEditDescription(parsed?.user_description || (isStashGoal ? 'Cash surplus' : ''));
      } catch {
        setEditDescription(isStashGoal ? 'Cash surplus' : '');
      }
    } else {
      setEditDescription(rawDesc || (isStashGoal ? 'Cash surplus' : ''));
    }
    setEditTarget(String(goal.target_amount));
    setEditCurrency(goal.currency);
    setEditColor(goal.color || POOL_COLORS[0]);
    setEditIsStash((goal as any).is_stash === true);
    setEditPercentAllocation(String(goal.percent_allocation || 0));
    const rawStart = (goal as any).start_date;
    const rawDeadline = goal.deadline;
    setEditStartDate(rawStart ? String(rawStart).split('T')[0].split(' ')[0] : '');
    setEditDeadline(rawDeadline ? String(rawDeadline).split('T')[0].split(' ')[0] : '');
    setEditOpen(true);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newAmount) return;
    await finance.addGoal({
      name: newName.trim(),
      description: newDescription.trim() || null,
      target_amount: parseFloat(newAmount),
      currency: newCurrency,
      priority: finance.goals.length + 1,
      safety_mode: 'balanced',
      color: newColor,
      percent_allocation: parseFloat(newPercentAllocation) || 0,
      start_date: newStartDate || null,
      deadline: newDeadline || null,
    } as any);
    setNewName(''); setNewDescription(''); setNewAmount(''); setNewColor(POOL_COLORS[0]); setNewPercentAllocation('0'); setNewStartDate(''); setNewDeadline(''); setCreateOpen(false);
  };

  const handleMoveFunds = async (bypassCapCheck = false) => {
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

    // Helper: convert base-currency amount back to a goal's native currency
    const toGoalCurrency = (baseAmt: number, currency: string) => {
      const oneInBase = finance.convertToBase(1, currency);
      return oneInBase === 0 ? baseAmt : baseAmt / oneInBase;
    };

    const dest = poolOptions.find(p => p.id === moveTo);
    const destGoal = !isVirtualPool(moveTo) ? finance.goals.find(g => g.id === moveTo) : null;

    if (!bypassCapCheck) {
      if (destGoal) {
        const deltaNative = toGoalCurrency(val, destGoal.currency);
        const currentAssignedNative = destGoal.assigned_amount || 0;
        const newAssignedNative = currentAssignedNative + deltaNative;
        const targetNative = destGoal.target_amount || 0;

        if (newAssignedNative > targetNative + 0.001) {
          const calculatedNewTarget = Math.round(newAssignedNative * 100) / 100;
          setCapOverflowData({
            goalId: destGoal.id,
            goalName: destGoal.name,
            currency: destGoal.currency,
            currentAssignedNative,
            currentTargetNative: targetNative,
            deltaNative,
            newTargetNative: calculatedNewTarget,
            moveValBase: val,
            sourceLabel: source?.label || '',
          });
          setCustomNewTarget(String(calculatedNewTarget));
          setCapOverflowOpen(true);
          return;
        }
      } else if (moveTo === EMERGENCY_VIRTUAL || (emergencyGoal && moveTo === emergencyGoal.id)) {
        const currentEmAssigned = emergencyGoal ? (emergencyGoal.assigned_amount || 0) : currentEmergencyFunded;
        if (currentEmAssigned + val > emergencyFloor + 0.001) {
          const calculatedNewTarget = Math.round((currentEmAssigned + val) * 100) / 100;
          setCapOverflowData({
            goalId: emergencyGoal ? emergencyGoal.id : null,
            isEmergencyVirtual: !emergencyGoal,
            goalName: 'Emergency Reserve',
            currency: baseCurrency,
            currentAssignedNative: currentEmAssigned,
            currentTargetNative: emergencyFloor,
            deltaNative: val,
            newTargetNative: calculatedNewTarget,
            moveValBase: val,
            sourceLabel: source?.label || '',
          });
          setCustomNewTarget(String(calculatedNewTarget));
          setCapOverflowOpen(true);
          return;
        }
      }
    }

    // Execute: decrease source, increase destination
    const updates: Promise<any>[] = [];

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

    if (moveTo === EMERGENCY_VIRTUAL) {
      updates.push(
        finance.addGoal({
          name: 'Emergency Reserve',
          target_amount: emergencyFloor,
          currency: baseCurrency,
          priority: 1,
          safety_mode: 'balanced',
          assigned_amount: val,
          color: '#ef6b6b',
          is_emergency: true,
        } as any)
      );
    } else if (!isVirtualPool(moveTo)) {
      const goal = finance.goals.find(g => g.id === moveTo);
      if (goal) {
        const deltaNative = toGoalCurrency(val, goal.currency);
        updates.push(
          finance.updateGoal(goal.id, { assigned_amount: (goal.assigned_amount || 0) + deltaNative } as any)
        );
      }
    }
    // Virtual destinations (like Fun Money) are derived — only source needs write.

    await Promise.all(updates);
    toast.success(`Moved ${fmt(val)} from ${source?.label} → ${dest?.label}`);
    setMoveOpen(false);
    setMoveFrom('');
    setMoveTo('');
    setMoveAmount('');
  };

  const handleConfirmCapOverflow = async () => {
    if (!capOverflowData) return;
    const targetVal = parseFloat(customNewTarget) || capOverflowData.newTargetNative;
    if (targetVal < capOverflowData.newTargetNative) {
      toast.error(`Goal amount must be at least ${formatCurrency(capOverflowData.newTargetNative, capOverflowData.currency)} to accommodate this transfer.`);
      return;
    }

    const { goalId, isEmergencyVirtual, goalName, currency } = capOverflowData;

    try {
      if (goalId) {
        await finance.updateGoal(goalId, {
          target_amount: targetVal,
        } as any);
      } else if (isEmergencyVirtual) {
        await finance.addGoal({
          name: 'Emergency Reserve',
          target_amount: targetVal,
          currency: baseCurrency,
          priority: 1,
          safety_mode: 'balanced',
          assigned_amount: 0,
          color: '#ef6b6b',
          is_emergency: true,
        } as any);
      }

      setCapOverflowOpen(false);
      await handleMoveFunds(true);
      toast.success(`Goal for ${goalName} updated to ${formatCurrency(targetVal, currency)}!`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update goal amount');
    }
  };

  if (finance.loading || assumptionsLoading) {
    return (
      <div className="space-y-6 w-full font-body">
        <h1 className="text-2xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Money Pools</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full font-body">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Money Pools</h1>
          <p className="text-muted-foreground text-xs sm:text-sm">Every dollar has a job — allocate your cash into pools</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 sm:h-9 text-xs"
          onClick={() => setMoveOpen(true)}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" /> Move Funds
        </Button>
      </div>

      <Tabs defaultValue={initialTab} className="space-y-5">
        <div className="overflow-x-auto touch-scroll max-w-full">
          <TabsList className="bg-white/90 backdrop-blur-md p-1 rounded-xl inline-flex min-w-max h-auto shadow-xs border border-slate-200/80 gap-1">
            <TabsTrigger
              value="pools"
              className="px-3 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all whitespace-nowrap"
            >
              Money Pools
            </TabsTrigger>
            <TabsTrigger
              value="balance-sheet"
              className="px-3 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all whitespace-nowrap"
            >
              Balance Sheet & Net Worth
            </TabsTrigger>
            <TabsTrigger
              value="allocate"
              className="px-3 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all whitespace-nowrap"
            >
              Allocate Leftover
            </TabsTrigger>
            <TabsTrigger
              value="can-i-buy"
              className="px-3 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all whitespace-nowrap"
            >
              Can I Buy This?
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="pools" className="space-y-6">
          {/* Paycheck Landed Auto-Allocation Banner */}
          {paycheckTx && waterfallBreakdown && detectedPaycheck && (!paycheckAllocated || revertSecondsLeft > 0) && (
            <Card className="bg-gradient-to-r from-emerald-50 via-white to-sky-50 border-2 border-emerald-300 shadow-[6px_6px_0px_0px_rgba(16,185,129,0.12)] font-body transition-all duration-300">
              <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-600 text-white font-display font-bold text-xs px-2.5 py-0.5 rounded-full">
                      🎉 {detectedPaycheck.isNextMonthPaycheck ? `${detectedPaycheck.targetMonthName} Paycheck Landed` : 'Paycheck Landed'}
                    </Badge>
                    <span className="text-xs text-slate-500 font-semibold">
                      {format(new Date(paycheckTx.posted_at), 'd MMM yyyy')} · {paycheckTx.merchant || paycheckTx.description || 'Income Deposit'}
                    </span>
                  </div>
                  <h2 className="text-2xl font-display font-black text-slate-900 tracking-tight">
                    +{fmt(paycheckTx.amount)} for {detectedPaycheck.targetMonthName}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-700">
                    <span className="bg-amber-100 text-amber-900 font-semibold px-2 py-0.5 rounded-md border border-amber-200">
                      1. Living Reserve: {fmt(waterfallBreakdown.totalLivingCostReserve)}
                    </span>
                    <span className="bg-rose-100 text-rose-900 font-semibold px-2 py-0.5 rounded-md border border-rose-200">
                      2. Emergency Top-up: {fmt(waterfallBreakdown.emergencyTopUp)}
                    </span>
                    <span className="bg-purple-100 text-purple-900 font-semibold px-2 py-0.5 rounded-md border border-purple-200">
                      3. Goal Pools: {fmt(waterfallBreakdown.totalGoalAllocations)}
                    </span>
                    <span className="bg-emerald-100 text-emerald-900 font-bold px-2 py-0.5 rounded-md border border-emerald-200">
                      4. Fun Money: {fmt(waterfallBreakdown.funMoneyLeftover)}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {paycheckAllocated ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="bg-emerald-100/70 text-emerald-800 border-emerald-300 font-display font-bold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        Allocated to Pools
                      </Badge>
                      {revertSecondsLeft > 0 && (
                        <Button
                          onClick={handleRevertPaycheckAllocation}
                          disabled={isReverting}
                          variant="outline"
                          className="bg-amber-50 hover:bg-amber-100 text-amber-900 border-2 border-amber-300 font-display font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all hover:scale-105"
                          title="Click to revert pool allocations back to pre-allocation amounts"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 text-amber-600 ${isReverting ? 'animate-spin' : ''}`} />
                          {isReverting ? 'Reverting...' : `Revert (${Math.floor(revertSecondsLeft / 60)}:${(revertSecondsLeft % 60).toString().padStart(2, '0')})`}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          markPaycheckProcessed(paycheckTx.id);
                          setPaycheckAllocated(true);
                          await finance.updateTransaction(paycheckTx.id, {
                            raw: {
                              ...((paycheckTx.raw as any) || {}),
                              paycheck_allocated: true,
                              allocated_at: Date.now(),
                            }
                          });
                          toast.success('Marked paycheck as already sorted! ✓');
                        }}
                        className="border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold px-3 py-2 rounded-xl"
                      >
                        Already Sorted ✓
                      </Button>
                      <Button
                        onClick={handleExecutePaycheckAllocation}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-display font-extrabold text-sm px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-600/25 flex items-center gap-2 cursor-pointer transition-all hover:scale-105"
                      >
                        <Sparkles className="w-4 h-4" />
                        Auto-Allocate to Pools
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

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

      {/* Smart Emergency Level-Up Opportunity Banner */}
      {ladderState.canAffordNextMonthNow && ladderState.nextMonth && !ladderBannerDismissed && (
        <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 via-teal-50/70 to-emerald-50 p-4 shadow-sm flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-900 text-sm">Emergency Fund Level-Up Opportunity</h4>
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-bold">Headroom Ready</Badge>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                You have enough liquid cashflow headroom to step your emergency cushion from <strong>{ladderState.activeMonths}</strong> to <strong>{ladderState.nextMonth} months</strong> (+{fmt(ladderState.additionalCostForNextMonth)}) without putting any active savings pots into deficit.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLadderBannerDismissed(true)}
              className="text-xs text-slate-500 hover:text-slate-800 h-8"
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              onClick={handleLevelUpEmergencyMonth}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 gap-1.5 shadow-xs"
            >
              <ArrowUpRight className="w-3.5 h-3.5" /> Level Up to {ladderState.nextMonth} Months
            </Button>
          </div>
        </div>
      )}

      {/* Pools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Emergency Fund */}
        {(() => {
          const currentFunded = currentEmergencyFunded;
          const shortfallAmt = emergencyShortfallAmt;
          const isShort = shortfallAmt > 0.01;
          const fundPct = emergencyFloor > 0 ? Math.min(100, (currentFunded / emergencyFloor) * 100) : 100;
          const monthsCovered = actualMonthlySurvival > 0 ? (currentFunded / actualMonthlySurvival) : 0;

          // Color tier logic:
          // Short of target floor / < 2 months: Red background & border
          // Fully funded for target floor, but < 3 months: Orange background & border
          // >= 3 months: Green background & border
          let cardStyle = 'bg-emerald-50/80 border-emerald-300 shadow-[4px_4px_0px_0px_rgba(16,185,129,0.15)]';
          let iconStyle = 'bg-emerald-100 text-emerald-600';
          let barStyle = 'bg-emerald-500';
          let badgeStyle = 'bg-emerald-100 text-emerald-700 border-emerald-200';
          let alertTextStyle = 'text-emerald-700';

          if (isShort || monthsCovered < 2) {
            cardStyle = 'bg-rose-50/80 border-rose-300 shadow-[4px_4px_0px_0px_rgba(244,63,94,0.15)]';
            iconStyle = 'bg-rose-100 text-rose-600';
            barStyle = 'bg-rose-500';
            badgeStyle = 'bg-rose-100 text-rose-700 border-rose-200';
            alertTextStyle = 'text-rose-600';
          } else if (monthsCovered < 3) {
            cardStyle = 'bg-amber-50/80 border-amber-300 shadow-[4px_4px_0px_0px_rgba(245,158,11,0.15)]';
            iconStyle = 'bg-amber-100 text-amber-700';
            barStyle = 'bg-amber-500';
            badgeStyle = 'bg-amber-100 text-amber-800 border-amber-300';
            alertTextStyle = 'text-amber-700';
          }

          return (
            <div className={`${cardStyle} rounded-2xl border-2 p-5 transition-all flex flex-col justify-between hover:scale-[1.01]`}>
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl ${iconStyle} flex items-center justify-center flex-shrink-0`}>
                      <Lock className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-base font-bold text-slate-900">Emergency Fund</h3>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground border-slate-200 bg-white/60">Auto-calculated</Badge>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLadderDialogOpen(true)}
                        className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 hover:text-emerald-950 bg-emerald-100/70 hover:bg-emerald-200/70 border border-emerald-300/80 px-2 py-0.5 rounded-md transition-all cursor-pointer"
                        title="Click to view 6-month staged expansion roadmap"
                      >
                        <Milestone className="w-3 h-3 text-emerald-700" />
                        Stage {ladderState.activeMonths} of {ladderState.targetMonths} Mo Ladder
                      </button>
                    </div>
                  </div>
                  {isShort ? (
                    <Badge className={`${badgeStyle} border font-display font-extrabold text-xs px-2.5 py-1 rounded-full shrink-0`}>
                      {fmt(shortfallAmt)} short
                    </Badge>
                  ) : (
                    <Badge className={`${badgeStyle} border font-display font-bold text-xs px-2.5 py-1 rounded-full shrink-0`}>
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
                  <div className="mt-2.5 w-full bg-slate-200/60 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all rounded-full ${barStyle}`}
                      style={{ width: `${fundPct}%` }}
                    />
                  </div>

                  {isShort && (
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className={`${alertTextStyle} font-display font-bold flex items-center gap-1`}>
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fmt(shortfallAmt)} short
                      </span>
                      <span className="text-slate-500 font-semibold">{fundPct.toFixed(0)}% saved</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[11px] text-slate-500 mt-4 pt-3 border-t border-slate-200/60 font-medium">
                  {monthsCovered.toFixed(1)}mo covered • ({bufferMonths}mo target × {fmt(actualMonthlySurvival)}/mo × 1.2 buffer)
                </p>

                {/* Staged Expansion Next-Step Advisor */}
                {ladderState.nextMonth && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200/60">
                    {ladderState.canAffordNextMonthNow ? (
                      <div className="p-2.5 rounded-xl bg-emerald-100/80 border border-emerald-300 text-xs flex items-center justify-between gap-2 shadow-2xs">
                        <div className="space-y-0.5">
                          <span className="font-extrabold text-emerald-950 flex items-center gap-1 text-[11px]">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                            Month {ladderState.nextMonth} Ready (+{fmt(ladderState.additionalCostForNextMonth)})
                          </span>
                          <p className="text-[10px] text-emerald-800 font-medium leading-tight">
                            Sufficient cash available without starving your active pots.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={handleLevelUpEmergencyMonth}
                          className="h-7 px-2.5 text-[11px] font-bold bg-emerald-700 hover:bg-emerald-800 text-white shrink-0 shadow-2xs"
                        >
                          Level Up
                        </Button>
                      </div>
                    ) : (
                      <div
                        onClick={() => setLadderDialogOpen(true)}
                        className="p-2.5 rounded-xl bg-amber-50/90 border border-amber-200/80 text-xs cursor-pointer hover:bg-amber-100/80 transition-all flex items-start justify-between gap-2 group"
                      >
                        <div className="space-y-0.5">
                          <span className="font-bold text-amber-950 flex items-center gap-1 text-[11px]">
                            <Lock className="w-3.5 h-3.5 text-amber-700" />
                            Month {ladderState.nextMonth} Staged (+{fmt(ladderState.additionalCostForNextMonth)})
                          </span>
                          <p className="text-[10px] text-amber-900 leading-tight">
                            {ladderState.isBlockedByActivePots ? (
                              <>
                                Protecting <strong>{ladderState.activeCompetingPots.length} active pots</strong>
                                {ladderState.projectedUnlockPotName ? ` (${ladderState.projectedUnlockPotName})` : ''}.
                                Unlocks once completed {ladderState.projectedUnlockDate ? `(~${ladderState.projectedUnlockDate})` : ''}.
                              </>
                            ) : (
                              <>Waiting for cashflow headroom before advancing.</>
                            )}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 mt-2 w-full">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-semibold gap-1.5 flex-1 border-slate-200/80 bg-white/80 hover:bg-white transition-colors"
                    onClick={() => {
                      const emId = emergencyGoal ? emergencyGoal.id : EMERGENCY_VIRTUAL;
                      const defaultSource = poolOptions.find(p => Boolean(p.available) && p.id !== emId)?.id || '';
                      setMoveFrom(defaultSource);
                      setMoveTo(emId);
                      setMoveAmount('');
                      setMoveOpen(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add funds
                  </Button>
                  {currentFunded > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs font-semibold gap-1 text-slate-600 hover:text-slate-900 transition-colors"
                      onClick={() => {
                        const emId = emergencyGoal ? emergencyGoal.id : EMERGENCY_VIRTUAL;
                        setMoveFrom(emId);
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
        })()}



        {/* Goal Pool Cards */}
        {sortedNonEmergencyGoals.map(goal => {
          const assigned = goal.assigned_amount || 0;
          const tripInfo = goalTripSpent.get(goal.id);
          const tripSpent = tripInfo?.spent || 0;
          const remaining = Math.max(0, assigned - tripSpent);
          const displayAmount = tripInfo ? remaining : assigned;
          const pct = goal.target_amount > 0 ? Math.min((displayAmount / goal.target_amount) * 100, 100) : 0;
          const isHit = goal.target_amount > 0 && displayAmount >= goal.target_amount;
          const iconColor = goal.color || '#4558ff';
          const goalColor = isHit ? '#10b981' : iconColor;
          const GoalIcon = getPoolIcon(goal.name);
          const cardFeasibility = goal.deadline ? evaluatePoolFeasibility({
            targetAmount: finance.convertToBase(goal.target_amount || 0, goal.currency),
            currentAssigned: finance.convertToBase(goal.assigned_amount || 0, goal.currency),
            deadline: goal.deadline || null,
            startDate: goal.start_date || null,
            existingGoals: finance.goals,
            evaluatingGoalId: goal.id,
            transactions: finance.transactions,
            categories: finance.categories,
            fixedMonthlyExpenses: fixedMonthlyTotal,
            weeklyVariableBudget: essentialVariable / 4.33,
            expectedMonthlyIncome: expectedMonthlyIncomeVal,
            convertToBase: finance.convertToBase,
          }) : null;

          return (
            <div
              key={goal.id}
              className={`rounded-2xl border-2 p-5 transition-all hover:scale-[1.01] flex flex-col justify-between ${
                isHit
                  ? 'bg-emerald-50/80 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800'
                  : 'bg-white'
              }`}
              style={{
                borderColor: isHit ? '#10b981' : `${goalColor}45`,
                boxShadow: isHit ? '4px 4px 0px 0px rgba(16,185,129,0.2)' : `4px 4px 0px 0px ${goalColor}12`,
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
                          style={{ backgroundColor: iconColor }}
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
                                outline: c === iconColor ? '2px solid hsl(var(--foreground))' : 'none',
                                outlineOffset: 2,
                              }}
                              onClick={() => finance.updateGoal(goal.id, { color: c } as any)}
                            />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <div className="min-w-0 flex flex-col">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900 truncate">{goal.name}</h3>
                        {tripInfo && <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-sky-200 text-sky-600 bg-sky-50">Trip</Badge>}
                        {isHit && <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-300 text-emerald-800 bg-emerald-100 font-bold">✓ Goal Hit!</Badge>}
                        {(goal as any).is_stash && <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-slate-100 text-slate-600 border border-slate-200">Stash</Badge>}
                        {cardFeasibility && cardFeasibility.isFeasible && cardFeasibility.requiredMonthlyPace > 0 && !isHit && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 border-emerald-300 text-emerald-800 bg-emerald-100 font-bold hover:bg-emerald-200 transition-colors cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              openFeasibilityDialog(goal, cardFeasibility);
                            }}
                            title="Feasible — click to view cashflow math"
                          >
                            Feasible
                          </Badge>
                        )}
                        {cardFeasibility && !cardFeasibility.isFeasible && cardFeasibility.requiredMonthlyPace > 0 && !isHit && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 border-rose-300 text-rose-800 bg-rose-100 font-bold hover:bg-rose-200 transition-colors cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              openFeasibilityDialog(goal, cardFeasibility);
                            }}
                            title="Click to view why this goal is unfeasible and see solutions"
                          >
                            Unfeasible
                          </Badge>
                        )}
                      </div>
                      {(() => {
                        const isStashGoal = (goal as any).is_stash === true || /stash/i.test(goal.name);
                        const rawDesc = (goal.description || '').trim();
                        const visibleDescription = rawDesc.startsWith('{')
                          ? (() => {
                              try {
                                const parsed = JSON.parse(rawDesc);
                                return parsed?.user_description || (isStashGoal ? 'Cash surplus' : '');
                              } catch {
                                return isStashGoal ? 'Cash surplus' : '';
                              }
                            })()
                          : (rawDesc || (isStashGoal ? 'Cash surplus' : ''));
                        return visibleDescription ? (
                          <p className="text-[11px] text-slate-500 font-normal mt-0.5 line-clamp-2 leading-tight">
                            {visibleDescription}
                          </p>
                        ) : null;
                      })()}
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

                {/* Start date, Due date & required allocation stats */}
                <div className="text-xs space-y-1.5 border-t border-slate-100 pt-3 mt-1">
                  {goal.start_date && (
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">Savings Start:</span>
                      <span className="font-bold text-indigo-600">
                        {format(new Date(String(goal.start_date).split('T')[0] + 'T00:00:00'), 'MMM d, yyyy')}
                        {new Date(String(goal.start_date).split('T')[0] + 'T00:00:00') > new Date() && ' (Upcoming)'}
                      </span>
                    </div>
                  )}
                  {goal.deadline ? (() => {
                    const dl = new Date(String(goal.deadline).split('T')[0] + 'T00:00:00');
                    const now = new Date();
                    const isFutureStart = !!goal.start_date && new Date(String(goal.start_date).split('T')[0] + 'T00:00:00') > now;
                    const daysRemaining = Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    const isOverdue = daysRemaining < 0;
                    const daysLabel = isOverdue 
                      ? 'Overdue' 
                      : daysRemaining === 0 
                        ? 'Due today' 
                        : `${daysRemaining}d left`;
                    const daysRemainingClamped = Math.max(1, daysRemaining);
                    const targetVal = finance.convertToBase(goal.target_amount || 0, goal.currency);
                    const assignedVal = finance.convertToBase(goal.assigned_amount || 0, goal.currency);
                    const remaining = Math.max(0, targetVal - assignedVal);

                    let weeklyRequired = 0;
                    if (isFutureStart) {
                      const st = new Date(goal.start_date!);
                      const daysBetween = Math.max(1, Math.ceil((dl.getTime() - st.getTime()) / (1000 * 60 * 60 * 24)));
                      const weeksBetween = daysBetween / 7;
                      weeklyRequired = remaining / weeksBetween;
                    } else {
                      const weeksRemaining = daysRemainingClamped / 7;
                      weeklyRequired = remaining / weeksRemaining;
                    }
                    
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
                            {formatCurrency(weeklyRequired, baseCurrency)}/wk {isFutureStart && `(from ${format(new Date(goal.start_date!), 'MMM d')})`}
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
                  })() : (() => {
                    const isStash = (goal as any).is_stash || goal.name.toLowerCase().includes('stash');
                    return (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-semibold">{isStash ? 'Funding Mode:' : 'Proportional Allocation:'}</span>
                          <span className="font-bold text-slate-800">
                            {isStash ? 'Week-end Surplus Sweep' : `${goal.percent_allocation || 0}%`}
                          </span>
                        </div>
                        {isStash && (
                          <div className="flex justify-between">
                            <span className="text-slate-500 font-semibold">Month-End Rule:</span>
                            <span className="font-bold text-emerald-700">Shifts to Savings Pool</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Unfeasible Shortfall Callout Banner with Click Handler */}
                {cardFeasibility && !cardFeasibility.isFeasible && cardFeasibility.requiredMonthlyPace > 0 && !isHit && (
                  <button
                    type="button"
                    onClick={() => openFeasibilityDialog(goal, cardFeasibility)}
                    className="w-full text-left p-2.5 rounded-xl bg-rose-50/90 hover:bg-rose-100/90 border border-rose-200/90 text-rose-900 transition-colors flex items-center justify-between text-xs cursor-pointer group shadow-2xs mt-2"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span className="truncate font-semibold text-[11px]">
                        Shortfall: <strong>{formatCurrency(cardFeasibility.shortfall, baseCurrency)}/mo</strong> needed
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-rose-700 underline group-hover:text-rose-900 shrink-0 ml-2 flex items-center gap-0.5">
                      See why & solutions <ChevronRight className="w-3 h-3" />
                    </span>
                  </button>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1 w-full">
                  <Button
                    size="sm" variant="outline" className="h-8 text-xs font-semibold gap-1.5 flex-1 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                    onClick={() => {
                      const defaultSource = poolOptions.find(p => p.available > 0 && p.id !== goal.id)?.id || (funMoney > 0 ? UNALLOCATED : '');
                      setMoveFrom(defaultSource);
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

      {/* Next Month / Monthly Living Budget (Dedicated Section Below Pools) */}
      <div className="mt-8 pt-6 border-t border-slate-200/80 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Shield className="w-5 h-5 text-sky-600" />
                {targetMonthLabel} Living & Monthly Budget
              </h2>
              <Badge variant="outline" className="text-[10px] font-bold px-2 py-0.5 text-sky-800 border-sky-300 bg-sky-50">
                🔒 Ring-Fenced
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Operational cashflow reserve for {targetMonthLabel} (bills, essentials & weekly fun money) — kept separate from your savings pots.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(() => {
            const isLivingCovered = livingPoolCash >= monthlyLivingTarget - 0.01;
            const isSurvivalCovered = livingPoolCash >= effectiveFixedMonthly + essentialVariable - 0.01;
            const livingShortfall = Math.max(0, monthlyLivingTarget - livingPoolCash);
            const livingPct = monthlyLivingTarget > 0 ? Math.min(100, (livingPoolCash / monthlyLivingTarget) * 100) : 100;

            let cardStyle = 'bg-sky-50/80 border-sky-300 shadow-[4px_4px_0px_0px_rgba(14,165,233,0.15)]';
            let iconStyle = 'bg-sky-500 text-white';
            let barStyle = 'bg-sky-500';
            let badgeStyle = 'bg-sky-100 text-sky-800 border-sky-300';

            if (isLivingCovered) {
              cardStyle = 'bg-emerald-50/80 border-emerald-300 shadow-[4px_4px_0px_0px_rgba(16,185,129,0.15)]';
              barStyle = 'bg-emerald-500';
              badgeStyle = 'bg-emerald-100 text-emerald-800 border-emerald-300';
            } else if (!isSurvivalCovered) {
              cardStyle = 'bg-amber-50/80 border-amber-300 shadow-[4px_4px_0px_0px_rgba(245,158,11,0.15)]';
              barStyle = 'bg-amber-500';
              badgeStyle = 'bg-amber-100 text-amber-800 border-amber-300';
            }

            return (
              <div className={`${cardStyle} rounded-2xl border-2 p-5 transition-all flex flex-col justify-between hover:scale-[1.01]`}>
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${iconStyle} flex items-center justify-center flex-shrink-0 shadow-xs`}>
                        <Lock className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900">Living & Monthly Budget</h3>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-sky-800 border-sky-300 bg-sky-100/80 font-bold">
                            🔒 Ring-Fenced ({targetMonthLabel})
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                          Untouchable reserve for {targetMonthLabel} Bills, Essentials & Weekly Budget
                        </p>
                      </div>
                    </div>
                    {isLivingCovered ? (
                      <Badge className={`${badgeStyle} border font-display font-bold text-[10px] px-2 py-0.5 rounded-full shrink-0`}>
                        ✓ {targetMonthLabel} Funded
                      </Badge>
                    ) : (
                      <Badge className={`${badgeStyle} border font-display font-bold text-[10px] px-2 py-0.5 rounded-full shrink-0`}>
                        {fmt(livingShortfall)} to full month
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="flex items-baseline justify-between flex-wrap gap-1 mb-2">
                      <div>
                        <span className="text-2xl font-display font-black text-slate-900 tracking-tight">
                          {fmt(livingPoolReserved)}
                        </span>
                        <span className="text-xs text-slate-500 ml-1 font-semibold">
                          / {fmt(monthlyLivingTarget)} locked for {targetMonthLabel}
                        </span>
                      </div>
                      <span className="text-xs font-bold tabular-nums text-sky-700">
                        {livingPct.toFixed(0)}%
                      </span>
                    </div>

                    <div className="w-full bg-slate-200/60 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all rounded-full ${barStyle}`}
                        style={{ width: `${livingPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Breakdown of what lives inside this untouchable pool */}
                  <div className="text-xs space-y-1.5 border-t border-slate-200/60 pt-3 mt-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">1. Fixed Bills Reserve:</span>
                      <span className="font-bold text-slate-800">
                        {fmt(effectiveFixedMonthly)}/mo ({fmt(effectiveFixedMonthly / 4.33)}/wk)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">2. Variable Essentials:</span>
                      <span className="font-bold text-slate-800">
                        {fmt(essentialVariable)}/mo ({fmt(essentialVariable / 4.33)}/wk)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">3. Fun Money Allowance:</span>
                      <span className="font-extrabold text-pink-600">
                        {fmt(monthlyFunAllowance)}/mo ({fmt(snapshot?.baseWeeklyFun ?? 0)}/wk)
                      </span>
                    </div>
                    {unallocatedSurplusCash > 0.01 ? (
                      <div className="flex justify-between pt-1 border-t border-slate-200/50">
                        <span className="text-emerald-700 font-bold">Unlocked Surplus Above Living:</span>
                        <span className="font-extrabold text-emerald-700">
                          +{fmt(unallocatedSurplusCash)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between pt-1 border-t border-slate-200/50">
                        <span className="text-slate-500 font-semibold">Protection Status:</span>
                        <span className="font-bold text-emerald-700">🔒 Locked for Living (Untouchable)</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-3 mt-2 w-full">
                  {unallocatedSurplusCash > 0.01 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-bold gap-1.5 flex-1 border-emerald-300 bg-white/90 text-emerald-800 hover:bg-emerald-50 transition-colors"
                      onClick={() => {
                        setMoveFrom(UNALLOCATED);
                        const firstGoal = sortedNonEmergencyGoals[0]?.id || '';
                        setMoveTo(firstGoal);
                        setMoveAmount(String(Math.floor(unallocatedSurplusCash)));
                        setMoveOpen(true);
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Allocate {fmt(unallocatedSurplusCash)} Surplus
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-semibold gap-1.5 flex-1 border-slate-200/80 bg-white/80 hover:bg-white transition-colors"
                      onClick={() => {
                        const defaultSource = poolOptions.find(p => p.available > 0 && p.id !== LIVING_POOL)?.id || '';
                        setMoveFrom(defaultSource);
                        setMoveTo(LIVING_POOL);
                        setMoveAmount('');
                        setMoveOpen(true);
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Top up from Pool
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Weekly Pool Savings Engine Card (Positioned Underneath Pools) */}
      <WeeklyPoolSavingsCard finance={finance} spendablePool={spendablePool} funMoney={funMoney} snapshot={snapshot} />
      </TabsContent>

        <TabsContent value="balance-sheet" className="space-y-6">
          <FinanceBalanceSheet />
        </TabsContent>

        <TabsContent value="allocate" className="space-y-6">
          <OverspendCoverPanel finance={finance} trips={trips} baseCurrency={baseCurrency} />
          <MonthlyPotPlanner
            transactions={finance.transactions}
            categories={finance.categories}
            goals={finance.goals}
            convertToBase={finance.convertToBase}
            updateGoal={finance.updateGoal}
            addGoal={finance.addGoal}
            baseCurrency={baseCurrency}
            assumptions={assumptions}
            fixedMonthlyTotal={fixedMonthlyTotal}
            essentialVariable={essentialVariable}
            emergencyFloor={emergencyFloor}
            currentEmergencyFunded={currentEmergencyFunded}
            onUpdateExpectedIncome={async (val) => {
              await updateAssumptions({ expected_monthly_income: val });
            }}
          />
        </TabsContent>

        <TabsContent value="can-i-buy" className="space-y-4">
          {assumptions && (
            <PurchaseTimingEvaluator
              finance={finance}
              assumptions={assumptions}
              fixedExpensesMonthly={fixedMonthlyTotal}
              fixedExpensesMonthlyAll={fixedMonthlyTotalAll}
              totalBoost={totalBoostThisWeek}
              weekTypeMap={typeof wtMap === 'function' ? (wtMap as any)() : wtMap}
              trips={trips}
            />
          )}
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
            <div className="space-y-2">
              <Label>Description / Purpose (Optional)</Label>
              <Input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="What is this fund for? (e.g. Flight to Tokyo and accommodation)" />
              <p className="text-[10px] text-muted-foreground">Included in AI financial summaries so your AI knows what the fund is for.</p>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Savings Start Date (Optional)</Label>
                <Input type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Contributions begin on/after this date.</p>
              </div>
              <div className="space-y-2">
                <Label>Target Date / Due Date (Optional)</Label>
                <Input type="date" value={newDeadline} onChange={e => setNewDeadline(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Calculates exact pace to hit goal in time.</p>
              </div>
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
            {newDeadline && parseFloat(newAmount) > 0 && (
              <FeasibilityAlert
                assessment={createFeasibility}
                currency={newCurrency}
                onApplyRecommendedDate={d => setNewDeadline(d)}
                onApplyRecommendedTarget={t => setNewAmount(String(t))}
              />
            )}
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
            <div className="space-y-2">
              <Label>Description / Purpose (Optional)</Label>
              <Input value={editDescription} onChange={e => setEditDescription(e.target.value)} placeholder="What is this fund for?" />
              <p className="text-[10px] text-muted-foreground">Included in AI financial summaries so your AI knows what the fund is for.</p>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Savings Start Date (Optional)</Label>
                <Input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Contributions begin on/after this date.</p>
              </div>
              <div className="space-y-2">
                <Label>Target Date / Due Date (Optional)</Label>
                <Input type="date" value={editDeadline} onChange={e => setEditDeadline(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Calculates exact pace to hit goal in time.</p>
              </div>
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
            {editDeadline && parseFloat(editTarget) > 0 && (
              <FeasibilityAlert
                assessment={editFeasibility}
                currency={editCurrency}
                onApplyRecommendedDate={d => setEditDeadline(d)}
                onApplyRecommendedTarget={t => setEditTarget(String(t))}
              />
            )}
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
                      setMoveAmount(String(source.available));
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

            <Button onClick={() => handleMoveFunds(false)} className="w-full" disabled={!moveFrom || !moveTo || !moveAmount}>
              Move {moveAmount ? fmt(parseFloat(moveAmount) || 0) : 'Funds'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Capacity Overflow Confirmation Modal */}
      <AlertDialog open={capOverflowOpen} onOpenChange={setCapOverflowOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-slate-900 font-display">
              <AlertCircle className="w-5 h-5 text-amber-500" /> Do you want to change your goal amount?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2 text-slate-600 font-body text-sm">
              {capOverflowData && (
                <>
                  <p>
                    <strong>{capOverflowData.goalName}</strong> is currently at or near its target capacity of{' '}
                    <span className="font-semibold text-slate-900">{formatCurrency(capOverflowData.currentTargetNative, capOverflowData.currency)}</span>.
                  </p>
                  <p>
                    Transferring <strong>{formatCurrency(capOverflowData.deltaNative, capOverflowData.currency)}</strong> will bring the total saved in this pot to{' '}
                    <span className="font-semibold text-slate-900">{formatCurrency(capOverflowData.currentAssignedNative + capOverflowData.deltaNative, capOverflowData.currency)}</span>.
                  </p>
                  <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-amber-900 font-medium leading-relaxed">
                    Would you like to increase your goal target amount to accommodate this transfer?
                  </div>
                  <div className="pt-1 space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">New Goal Target ({capOverflowData.currency})</Label>
                    <Input
                      type="number"
                      step="any"
                      value={customNewTarget}
                      onChange={e => setCustomNewTarget(e.target.value)}
                      placeholder={String(capOverflowData.newTargetNative)}
                    />
                  </div>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 flex gap-2 justify-end">
            <AlertDialogCancel>No, Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                handleConfirmCapOverflow();
              }}
              className="bg-[#FF2EB8] hover:bg-[#e026a2] text-white font-semibold"
            >
              Yes, Update Goal & Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Feasibility Breakdown Dialog */}
      <FeasibilityBreakdownDialog
        open={feasibilityDialogOpen}
        onOpenChange={setFeasibilityDialogOpen}
        goal={selectedFeasibilityGoal}
        assessment={activeFeasibilityAssessment || selectedFeasibilityAssessment}
        currency={baseCurrency}
        totalLiquidCash={totalCash}
        allGoals={finance.goals}
        onEditGoal={(g) => openEditDialog(g)}
        onMoveFunds={(g, suggestedAmt) => {
          const defaultSource = poolOptions.find(p => p.available > 0 && p.id !== g.id)?.id || (funMoney > 0 ? UNALLOCATED : '');
          setMoveFrom(defaultSource);
          setMoveTo(g.id);
          setMoveAmount(suggestedAmt ? String(Math.ceil(suggestedAmt)) : '');
          setMoveOpen(true);
        }}
        onApplyRecommendedDate={(goalId, dateStr) => {
          finance.updateGoal(goalId, { deadline: dateStr } as any);
          toast.success(`Target date extended to ${dateStr}`);
        }}
        onApplyRecommendedTarget={(goalId, targetVal) => {
          finance.updateGoal(goalId, { target_amount: targetVal } as any);
          toast.success(`Target amount adjusted to ${formatCurrency(targetVal, baseCurrency)}`);
        }}
        hasManualIncomeOverride={Boolean(assumptions?.expected_monthly_income && assumptions.expected_monthly_income > 0)}
        onUpdateExpectedIncome={async (val) => {
          await updateAssumptions({ expected_monthly_income: val });
          toast.success(`Expected monthly income updated to ${formatCurrency(val, baseCurrency)}/mo`);
        }}
        onResetExpectedIncome={async () => {
          await updateAssumptions({ expected_monthly_income: null });
          toast.success('Reset to 3-month dynamic transaction average');
        }}
        transactions={finance.transactions}
        categories={finance.categories}
        accounts={finance.accounts}
        onUpdateTransaction={finance.updateTransaction}
      />

      {/* Emergency Fund Growth Ladder Modal */}
      <EmergencyLadderModal
        open={ladderDialogOpen}
        onOpenChange={setLadderDialogOpen}
        ladderState={ladderState}
        currency={baseCurrency}
        onLevelUp={handleLevelUpEmergencyMonth}
        onUpdateTargetMonths={async (months: number) => {
          localStorage.setItem('gvb_target_buffer_months', String(months));
          try {
            await (finance as any).updateSettings?.({
              fx_rates: {
                ...((finance.settings?.fx_rates as any) || {}),
                target_buffer_months: months,
              },
            });
          } catch (e) {
            console.error('Failed to sync target_buffer_months', e);
          }
          toast.success(`Target goal updated to ${months} months!`);
        }}
      />
    </div>
  );
}
