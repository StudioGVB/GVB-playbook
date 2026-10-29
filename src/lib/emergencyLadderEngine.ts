import { FinanceGoal } from '@/hooks/useFinanceData';
import { differenceInDays, format, parseISO } from 'date-fns';

export interface LadderMilestone {
  month: number;
  amount: number;
  status: 'achieved' | 'active_floor' | 'next_milestone' | 'upcoming' | 'ultimate_target';
  label: string;
}

export interface CompetingPot {
  id: string;
  name: string;
  targetAmount: number;
  assignedAmount: number;
  remainingAmount: number;
  deadline: string | null;
  daysRemaining: number | null;
  weeklyPace: number;
  isHolidayOrTrip: boolean;
}

export interface EmergencyLadderState {
  activeMonths: number;
  targetMonths: number;
  progressPercent: number;
  monthlySurvival: number;
  currentFloor: number;
  ultimateFloor: number;
  costPerMonth: number;
  nextMonth: number | null;
  nextMonthFloor: number | null;
  additionalCostForNextMonth: number;
  unallocatedCash: number;
  canAffordNextMonthNow: boolean;
  shortfallForNextMonth: number;
  activeCompetingPots: CompetingPot[];
  totalWeeklyCommittedToPots: number;
  totalMonthlyCommittedToPots: number;
  isBlockedByActivePots: boolean;
  projectedUnlockDate: string | null;
  projectedUnlockPotName: string | null;
  milestones: LadderMilestone[];
  recentlyCompletedPots: Array<{ name: string; completedAt?: string }>;
}

export function computeEmergencyLadder(params: {
  activeMonths: number;
  targetMonths?: number;
  monthlySurvival: number;
  totalLiquidCash: number;
  goals: FinanceGoal[];
  convertToBase: (amount: number, currency?: string) => number;
  monthlyLivingReserve?: number;
  now?: Date;
}): EmergencyLadderState {
  const {
    activeMonths = 2,
    targetMonths = 6,
    monthlySurvival = 0,
    totalLiquidCash = 0,
    goals = [],
    convertToBase,
    monthlyLivingReserve = 0,
    now = new Date(),
  } = params;

  const effectiveTargetMonths = Math.max(activeMonths, targetMonths);
  const costPerMonth = monthlySurvival * 1.2; // 20% contingency included in emergency buffer
  const currentFloor = costPerMonth * activeMonths;
  const ultimateFloor = costPerMonth * effectiveTargetMonths;

  const nextMonth = activeMonths < effectiveTargetMonths ? activeMonths + 1 : null;
  const nextMonthFloor = nextMonth ? costPerMonth * nextMonth : null;
  const additionalCostForNextMonth = costPerMonth;

  // Total allocated to all non-emergency goals
  let totalGoalAssigned = 0;
  const activeCompetingPots: CompetingPot[] = [];
  const recentlyCompletedPots: Array<{ name: string; completedAt?: string }> = [];

  for (const g of goals) {
    const isEmergency = (g as any).is_emergency || g.name.toLowerCase().includes('emergency');
    if (isEmergency) continue;

    const baseTarget = convertToBase(g.target_amount || 0, g.currency);
    const baseAssigned = convertToBase(g.assigned_amount || 0, g.currency);
    totalGoalAssigned += baseAssigned;

    const remaining = Math.max(0, baseTarget - baseAssigned);
    const isCompleted = baseTarget > 0 && remaining <= 0.01;

    let daysRemaining: number | null = null;
    let weeklyPace = 0;

    if (g.deadline) {
      try {
        const d = parseISO(String(g.deadline).split('T')[0]);
        daysRemaining = differenceInDays(d, now);
        if (daysRemaining > 0 && remaining > 0) {
          const weeks = Math.max(1, daysRemaining / 7);
          weeklyPace = remaining / weeks;
        }
      } catch {
        daysRemaining = null;
      }
    }

    const lowerName = g.name.toLowerCase();
    const isHolidayOrTrip = lowerName.includes('xmas') ||
      lowerName.includes('christmas') ||
      lowerName.includes('euro') ||
      lowerName.includes('trip') ||
      lowerName.includes('holiday') ||
      lowerName.includes('travel');

    if (baseTarget > 0 && !isCompleted) {
      activeCompetingPots.push({
        id: g.id,
        name: g.name,
        targetAmount: baseTarget,
        assignedAmount: baseAssigned,
        remainingAmount: remaining,
        deadline: g.deadline || null,
        daysRemaining,
        weeklyPace,
        isHolidayOrTrip,
      });
    } else if (isCompleted) {
      recentlyCompletedPots.push({ name: g.name });
    }
  }

  // Sort active competing pots: those with sooner deadlines first (e.g. Xmas, Euro)
  activeCompetingPots.sort((a, b) => {
    if (a.daysRemaining !== null && b.daysRemaining !== null) {
      return a.daysRemaining - b.daysRemaining;
    }
    if (a.daysRemaining !== null) return -1;
    if (b.daysRemaining !== null) return 1;
    return b.targetAmount - a.targetAmount;
  });

  const totalWeeklyCommittedToPots = activeCompetingPots.reduce((sum, p) => sum + p.weeklyPace, 0);
  const totalMonthlyCommittedToPots = totalWeeklyCommittedToPots * 4.33;

  // Liquid cash remaining after covering current active floor, existing assigned goal cash, AND next month's Living & Monthly Budget reserve
  const unallocatedCash = Math.max(0, totalLiquidCash - currentFloor - totalGoalAssigned - monthlyLivingReserve);
  const canAffordNextMonthNow = unallocatedCash >= additionalCostForNextMonth;
  const shortfallForNextMonth = Math.max(0, additionalCostForNextMonth - unallocatedCash);
  const isBlockedByActivePots = activeCompetingPots.length > 0 && !canAffordNextMonthNow;

  // Project unlock date based on the latest priority goal deadline (e.g. Christmas / Euro)
  let projectedUnlockDate: string | null = null;
  let projectedUnlockPotName: string | null = null;

  const potsWithDeadline = activeCompetingPots.filter(p => p.deadline && p.daysRemaining !== null && p.daysRemaining >= 0);
  if (potsWithDeadline.length > 0) {
    // Latest deadline among active priority pots
    const latestPot = [...potsWithDeadline].sort((a, b) => (b.daysRemaining || 0) - (a.daysRemaining || 0))[0];
    try {
      const d = parseISO(String(latestPot.deadline).split('T')[0]);
      projectedUnlockDate = format(d, 'MMMM yyyy');
      projectedUnlockPotName = latestPot.name;
    } catch {
      projectedUnlockDate = null;
    }
  }

  // Build the milestone ladder
  const milestones: LadderMilestone[] = [];
  for (let m = 1; m <= effectiveTargetMonths; m++) {
    const amount = costPerMonth * m;
    let status: LadderMilestone['status'] = 'upcoming';
    let label = `${m} Month${m > 1 ? 's' : ''}`;

    if (m < activeMonths) {
      status = 'achieved';
      label = `${m} Mo (Achieved)`;
    } else if (m === activeMonths) {
      status = 'active_floor';
      label = `${m} Mo (Active Floor)`;
    } else if (m === activeMonths + 1) {
      status = 'next_milestone';
      label = `${m} Mo (Next Goal)`;
    } else if (m === effectiveTargetMonths) {
      status = 'ultimate_target';
      label = `${m} Mo (North Star)`;
    }

    milestones.push({
      month: m,
      amount,
      status,
      label,
    });
  }

  const progressPercent = Math.min(100, (activeMonths / effectiveTargetMonths) * 100);

  return {
    activeMonths,
    targetMonths: effectiveTargetMonths,
    progressPercent,
    monthlySurvival,
    currentFloor,
    ultimateFloor,
    costPerMonth,
    nextMonth,
    nextMonthFloor,
    additionalCostForNextMonth,
    unallocatedCash,
    canAffordNextMonthNow,
    shortfallForNextMonth,
    activeCompetingPots,
    totalWeeklyCommittedToPots,
    totalMonthlyCommittedToPots,
    isBlockedByActivePots,
    projectedUnlockDate,
    projectedUnlockPotName,
    milestones,
    recentlyCompletedPots,
  };
}
