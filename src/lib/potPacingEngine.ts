import {
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isSameMonth,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { baseAmt } from '@/lib/financeUtils';
import type { FinanceGoal, FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';

export type GoalPacingMode = 'fixed' | 'dynamic';

export const FALLBACK_POT_COLORS = [
  '#4558ff',
  '#FF2EB8',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#6366f1',
];

export const isProtectedSystemPot = (g?: Partial<FinanceGoal> | null) => {
  if (!g) return true;
  if ((g as any).is_emergency || (g as any).is_stash) return true;
  const lower = (g.name || '').trim().toLowerCase();
  return (
    lower.includes('emergency') ||
    lower.includes('stash') ||
    lower === 'savings' ||
    lower === 'core savings'
  );
};

/**
 * Resolves a goal's per-tile pacing mode ('fixed' vs 'dynamic').
 * Stored in goal.safety_mode ('fixed' | 'dynamic').
 * If a goal still has legacy 'balanced', Visa defaults to 'fixed' and other pots default to 'dynamic'.
 */
export function getGoalPacingMode(goal?: Partial<FinanceGoal> | null): GoalPacingMode {
  if (!goal) return 'dynamic';
  const mode = String(goal.safety_mode || '').toLowerCase().trim();
  if (mode === 'fixed' || mode === 'even' || mode === 'linear' || mode === 'strict') {
    return 'fixed';
  }
  if (mode === 'dynamic') {
    return 'dynamic';
  }
  // Legacy 'balanced' fallback: default Visa to fixed monthly, others to dynamic
  const nameLower = String(goal.name || '').toLowerCase().trim();
  if (nameLower.includes('visa')) {
    return 'fixed';
  }
  return 'dynamic';
}

export function isGoalFixedPace(goal?: Partial<FinanceGoal> | null): boolean {
  return getGoalPacingMode(goal) === 'fixed';
}

export interface ActiveGoalMeta {
  goal: FinanceGoal;
  pacingMode: GoalPacingMode;
  color: string;
  targetBase: number;
  assignedBase: number;
  spentBase: number;
  effectiveFundedBase: number;
  remainingToSaveBase: number;
  effectiveStart: Date;
  effectiveDeadline: Date;
  rawStart: Date | null;
  rawDeadline: Date | null;
  totalActiveDays: number;
}

export interface MonthPotContribution {
  goal: FinanceGoal;
  pacingMode: GoalPacingMode;
  color: string;
  amount: number;
  evenAmount: number;
  dynamicAmount: number;
  isBoosted: boolean;
  activeDays: number;
  weeklyPaceInMonth: number;
  projectedFundedAfterMonth: number;
  targetBase: number;
  startsThisMonth: boolean;
  endsThisMonth: boolean;
}

export interface MonthSeriesPoint {
  monthKey: string;
  monthLabel: string;
  shortLabel: string;
  monthDate: Date;
  isCurrentMonth: boolean;
  isNextMonth: boolean;
  total: number;
  fixedTotal: number;
  dynamicTotal: number;
  contributions: MonthPotContribution[];
  [goalId: string]: any;
}

export interface PotScheduleResult {
  activeGoalMetas: ActiveGoalMeta[];
  months: MonthSeriesPoint[];
  spentByGoalTotal: Map<string, number>;
  fixedCount: number;
  dynamicCount: number;
  /** Returns a goal's planned contribution & weekly pace for the requested month (or first active month if future-start) */
  getGoalPlanForMonth: (
    goalId: string,
    targetMonth?: Date
  ) => {
    pacingMode: GoalPacingMode;
    monthlyAmount: number;
    weeklyPace: number;
    evenMonthlyAmount: number;
    evenWeeklyPace: number;
    dynamicMonthlyAmount: number;
    dynamicWeeklyPace: number;
    activeMonthLabel: string;
    isFutureStart: boolean;
    isLighterThisMonth: boolean;
    isBoostedThisMonth: boolean;
  } | null;
}

export function computeSpentByGoalBase(
  goals: FinanceGoal[],
  transactions: FinanceTransaction[] = [],
  categories: FinanceCategory[] = [],
  convertToBase?: (amount: number, currency: string) => number
): Map<string, number> {
  const totalMap = new Map<string, number>();
  const catByLowerName = new Map<string, string>();
  categories.forEach(c => {
    if (c.name) catByLowerName.set(c.name.trim().toLowerCase(), c.id);
  });

  const goalByCatId = new Map<string, string>();
  goals.forEach(g => {
    if (isProtectedSystemPot(g)) return;
    const cid = catByLowerName.get((g.name || '').trim().toLowerCase());
    if (cid) goalByCatId.set(cid, g.id);
  });

  for (const tx of transactions) {
    if (!tx || tx.amount >= 0 || tx.is_transfer) continue;
    if ((tx as any).transfer_status === 'confirmed' || (tx as any).transfer_status === 'auto_confirmed') continue;
    const directGoalId = (tx as any).goal_id as string | undefined;
    const matchedGoalId = directGoalId || (tx.category_id ? goalByCatId.get(tx.category_id) : undefined);
    if (!matchedGoalId) continue;

    const amt = convertToBase
      ? Math.abs(convertToBase(Number(tx.amount) || 0, tx.currency || 'GBP'))
      : Math.abs(baseAmt(tx));
    totalMap.set(matchedGoalId, (totalMap.get(matchedGoalId) || 0) + amt);
  }

  return totalMap;
}

/**
 * Computes the monthly pot contribution schedule where:
 * 1. Every 'fixed' pot (e.g. Visa) locks in a constant daily/monthly rate across its active window first.
 * 2. Every 'dynamic' pot (e.g. Ski trip, Italy) is calculated OVER THE TOP of the fixed pots
 *    (and earlier-due dynamic pots), automatically putting less in busy months and ramping up as earlier pots finish.
 */
export function computeMonthlyPotSchedule(params: {
  goals: FinanceGoal[];
  transactions?: FinanceTransaction[];
  categories?: FinanceCategory[];
  convertToBase: (amount: number, currency: string) => number;
  referenceDate?: Date;
}): PotScheduleResult {
  const {
    goals,
    transactions = [],
    categories = [],
    convertToBase,
    referenceDate = new Date(),
  } = params;

  const today = startOfDay(referenceDate);
  const currentMonthStart = startOfMonth(today);

  const spentByGoalTotal = computeSpentByGoalBase(goals, transactions, categories, convertToBase);
  const eligibleGoals = goals.filter(g => !isProtectedSystemPot(g));

  const metas: ActiveGoalMeta[] = [];
  let maxMonthDate = addMonths(currentMonthStart, 5);

  eligibleGoals.forEach((g, idx) => {
    const targetBase = convertToBase(g.target_amount || 0, g.currency);
    const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
    const spentBase = spentByGoalTotal.get(g.id) || 0;
    const refillWhenSpent = Boolean(g.refill_when_spent);
    const effectiveFundedBase = refillWhenSpent ? assignedBase : assignedBase + spentBase;
    const remainingToSaveBase = Math.max(0, targetBase - effectiveFundedBase);

    if (remainingToSaveBase <= 0.01) return;

    const rawStart = g.start_date
      ? startOfDay(new Date(String(g.start_date).split('T')[0] + 'T00:00:00'))
      : null;
    const effectiveStart = rawStart && rawStart > today ? rawStart : today;

    const rawDeadline = g.deadline
      ? startOfDay(new Date(String(g.deadline).split('T')[0] + 'T00:00:00'))
      : null;

    const fallbackDeadline = endOfMonth(addMonths(effectiveStart, 5));
    const effectiveDeadline = rawDeadline
      ? rawDeadline < effectiveStart
        ? effectiveStart
        : rawDeadline
      : fallbackDeadline;

    const dlMonth = startOfMonth(effectiveDeadline);
    if (dlMonth > maxMonthDate) maxMonthDate = dlMonth;

    const totalActiveDays = Math.max(
      1,
      differenceInCalendarDays(effectiveDeadline, effectiveStart) + 1
    );

    metas.push({
      goal: g,
      pacingMode: getGoalPacingMode(g),
      color: g.color || FALLBACK_POT_COLORS[idx % FALLBACK_POT_COLORS.length],
      targetBase,
      assignedBase,
      spentBase,
      effectiveFundedBase,
      remainingToSaveBase,
      effectiveStart,
      effectiveDeadline,
      rawStart,
      rawDeadline,
      totalActiveDays,
    });
  });

  // Sort active goals by deadline (soonest first)
  metas.sort((a, b) => a.effectiveDeadline.getTime() - b.effectiveDeadline.getTime());

  // Cap horizon at 12 months forward
  const maxHorizon = addMonths(currentMonthStart, 11);
  if (maxMonthDate > maxHorizon) maxMonthDate = maxHorizon;

  const monthDates: Date[] = [];
  let cursor = currentMonthStart;
  while (cursor <= maxMonthDate) {
    monthDates.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  const monthAvailableDays = monthDates.map((mDate, mIdx) => {
    const mStart = startOfMonth(mDate);
    const mEnd = endOfMonth(mDate);
    const winStart = mIdx === 0 && today > mStart ? today : mStart;
    return Math.max(1, differenceInCalendarDays(mEnd, winStart) + 1);
  });

  const activeDaysMatrix = new Map<string, number[]>();
  const evenAllocMatrix = new Map<string, number[]>();
  const finalAllocMatrix = new Map<string, number[]>();

  for (const meta of metas) {
    const daysPerMonth: number[] = [];
    const evenPerMonth: number[] = [];

    monthDates.forEach((mDate, mIdx) => {
      const mStart = startOfMonth(mDate);
      const mEnd = endOfMonth(mDate);
      const windowStart = meta.effectiveStart > mStart ? meta.effectiveStart : mStart;
      const windowEnd = meta.effectiveDeadline < mEnd ? meta.effectiveDeadline : mEnd;

      if (windowEnd >= windowStart) {
        const activeDays = differenceInCalendarDays(windowEnd, windowStart) + 1;
        daysPerMonth[mIdx] = activeDays;
        evenPerMonth[mIdx] = (meta.remainingToSaveBase * activeDays) / meta.totalActiveDays;
      } else {
        daysPerMonth[mIdx] = 0;
        evenPerMonth[mIdx] = 0;
      }
    });

    activeDaysMatrix.set(meta.goal.id, daysPerMonth);
    evenAllocMatrix.set(meta.goal.id, evenPerMonth);
  }

  // PASS 1: Lock in all 'fixed' pots first as the foundation layer
  const monthCommittedLoad = new Array(monthDates.length).fill(0);

  for (const meta of metas) {
    if (meta.pacingMode !== 'fixed') continue;
    const evenPerMonth = evenAllocMatrix.get(meta.goal.id)!;
    finalAllocMatrix.set(meta.goal.id, [...evenPerMonth]);
    evenPerMonth.forEach((amt, mIdx) => {
      monthCommittedLoad[mIdx] += amt;
    });
  }

  // PASS 2: Calculate all 'dynamic' pots OVER THE TOP of the fixed pots (in deadline order)
  for (const meta of metas) {
    if (meta.pacingMode !== 'dynamic') continue;

    const daysPerMonth = activeDaysMatrix.get(meta.goal.id)!;
    const evenPerMonth = evenAllocMatrix.get(meta.goal.id)!;
    const activeMonthIndices = daysPerMonth
      .map((d, idx) => (d > 0 ? idx : -1))
      .filter(idx => idx !== -1);

    if (activeMonthIndices.length <= 1) {
      finalAllocMatrix.set(meta.goal.id, [...evenPerMonth]);
      activeMonthIndices.forEach(idx => {
        monthCommittedLoad[idx] += evenPerMonth[idx];
      });
      continue;
    }

    const BASELINE_RATIO = 0.2;
    const baselinePerMonth = evenPerMonth.map(amt => amt * BASELINE_RATIO);
    const flexRemaining = meta.remainingToSaveBase * (1 - BASELINE_RATIO);

    // Existing daily load u_m includes all FIXED pots + more-urgent DYNAMIC pots
    const dailyLoad = monthDates.map((_, mIdx) => {
      return (monthCommittedLoad[mIdx] + baselinePerMonth[mIdx]) / monthAvailableDays[mIdx];
    });

    let low = Math.min(...activeMonthIndices.map(mIdx => dailyLoad[mIdx]));
    let high =
      Math.max(...activeMonthIndices.map(mIdx => dailyLoad[mIdx])) +
      flexRemaining / Math.min(...activeMonthIndices.map(mIdx => Math.max(1, daysPerMonth[mIdx])));

    for (let iter = 0; iter < 45; iter++) {
      const mid = (low + high) / 2;
      let allocated = 0;
      for (const mIdx of activeMonthIndices) {
        if (mid > dailyLoad[mIdx]) {
          allocated += daysPerMonth[mIdx] * (mid - dailyLoad[mIdx]);
        }
      }
      if (allocated < flexRemaining) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const waterLevel = (low + high) / 2;
    const dynPerMonth = monthDates.map((_, mIdx) => {
      if (daysPerMonth[mIdx] <= 0) return 0;
      const flexAdd = daysPerMonth[mIdx] * Math.max(0, waterLevel - dailyLoad[mIdx]);
      return baselinePerMonth[mIdx] + flexAdd;
    });

    finalAllocMatrix.set(meta.goal.id, dynPerMonth);
    activeMonthIndices.forEach(mIdx => {
      monthCommittedLoad[mIdx] += dynPerMonth[mIdx];
    });
  }

  const cumulativeByGoal = new Map<string, number>();
  metas.forEach(m => cumulativeByGoal.set(m.goal.id, m.effectiveFundedBase));

  const series: MonthSeriesPoint[] = monthDates.map((mDate, mIdx) => {
    const mKey = format(mDate, 'yyyy-MM');

    const point: MonthSeriesPoint = {
      monthKey: mKey,
      monthLabel: format(mDate, 'MMMM yyyy'),
      shortLabel: format(mDate, 'MMM yy'),
      monthDate: mDate,
      isCurrentMonth: mIdx === 0,
      isNextMonth: mIdx === 1,
      total: 0,
      fixedTotal: 0,
      dynamicTotal: 0,
      contributions: [],
    };

    for (const meta of metas) {
      const activeDays = activeDaysMatrix.get(meta.goal.id)![mIdx];
      const evenAmt = evenAllocMatrix.get(meta.goal.id)![mIdx];
      const chosenAmt = finalAllocMatrix.get(meta.goal.id)![mIdx];

      if (activeDays > 0 && chosenAmt > 0.01) {
        const roundedAmt = Math.round(chosenAmt * 100) / 100;
        const roundedEven = Math.round(evenAmt * 100) / 100;
        const prevFunded = cumulativeByGoal.get(meta.goal.id) || 0;
        const projectedAfter = Math.min(meta.targetBase, prevFunded + roundedAmt);
        cumulativeByGoal.set(meta.goal.id, projectedAfter);

        const startsThisMonth = Boolean(meta.rawStart && isSameMonth(meta.rawStart, mDate));
        const endsThisMonth = Boolean(meta.rawDeadline && isSameMonth(meta.rawDeadline, mDate));
        const isBoosted = meta.pacingMode === 'dynamic' && roundedAmt > roundedEven * 1.12;

        point[meta.goal.id] = roundedAmt;
        point.total += roundedAmt;
        if (meta.pacingMode === 'fixed') {
          point.fixedTotal += roundedAmt;
        } else {
          point.dynamicTotal += roundedAmt;
        }

        point.contributions.push({
          goal: meta.goal,
          pacingMode: meta.pacingMode,
          color: meta.color,
          amount: roundedAmt,
          evenAmount: roundedEven,
          dynamicAmount: roundedAmt,
          isBoosted,
          activeDays,
          weeklyPaceInMonth: roundedAmt / Math.max(1, activeDays / 7),
          projectedFundedAfterMonth: projectedAfter,
          targetBase: meta.targetBase,
          startsThisMonth,
          endsThisMonth,
        });
      } else {
        point[meta.goal.id] = 0;
      }
    }

    point.total = Math.round(point.total * 100) / 100;
    point.fixedTotal = Math.round(point.fixedTotal * 100) / 100;
    point.dynamicTotal = Math.round(point.dynamicTotal * 100) / 100;
    return point;
  });

  while (series.length > 4 && series[series.length - 1].total <= 0.01) {
    series.pop();
  }

  const getGoalPlanForMonth = (goalId: string, targetMonth: Date = today) => {
    const meta = metas.find(m => m.goal.id === goalId);
    if (!meta) return null;

    const daysArr = activeDaysMatrix.get(goalId);
    const evenArr = evenAllocMatrix.get(goalId);
    const finalArr = finalAllocMatrix.get(goalId);
    if (!daysArr || !evenArr || !finalArr) return null;

    const targetKey = format(targetMonth, 'yyyy-MM');
    let mIdx = monthDates.findIndex(d => format(d, 'yyyy-MM') === targetKey);
    if (mIdx === -1) mIdx = 0;

    const isFutureStart = Boolean(meta.rawStart && meta.rawStart > today);
    let displayIdx = mIdx;
    if (daysArr[displayIdx] <= 0) {
      const firstActive = daysArr.findIndex(d => d > 0);
      if (firstActive !== -1) displayIdx = firstActive;
    }

    const activeDays = Math.max(1, daysArr[displayIdx] || 30.44);
    const weeksInWindow = Math.max(1, activeDays / 7);
    const evenMonthlyAmount = evenArr[displayIdx] || 0;
    const chosenMonthlyAmount = finalArr[displayIdx] || 0;
    const evenWeeklyPace = evenMonthlyAmount / weeksInWindow;
    const chosenWeeklyPace = chosenMonthlyAmount / weeksInWindow;

    return {
      pacingMode: meta.pacingMode,
      monthlyAmount: chosenMonthlyAmount,
      weeklyPace: chosenWeeklyPace,
      evenMonthlyAmount,
      evenWeeklyPace,
      dynamicMonthlyAmount: chosenMonthlyAmount,
      dynamicWeeklyPace: chosenWeeklyPace,
      activeMonthLabel: format(monthDates[displayIdx], 'MMM'),
      isFutureStart,
      isLighterThisMonth:
        meta.pacingMode === 'dynamic' && chosenMonthlyAmount < evenMonthlyAmount * 0.88,
      isBoostedThisMonth:
        meta.pacingMode === 'dynamic' && chosenMonthlyAmount > evenMonthlyAmount * 1.12,
    };
  };

  const fixedCount = metas.filter(m => m.pacingMode === 'fixed').length;
  const dynamicCount = metas.filter(m => m.pacingMode === 'dynamic').length;

  return {
    activeGoalMetas: metas,
    months: series,
    spentByGoalTotal,
    fixedCount,
    dynamicCount,
    getGoalPlanForMonth,
  };
}
