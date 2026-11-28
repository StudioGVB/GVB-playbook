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
  if ((g as any).is_stash || (g as any).is_emergency) return true;
  const lower = (g.name || '').trim().toLowerCase();
  if (lower.includes('stash') || lower.includes('emergency')) return true;
  if (lower === 'savings' || lower === 'core savings') return true;
  return false;
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
    remainingToSaveBase: number;
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
  /** Returns the full pot allocation schedule point for a specific month */
  getScheduleForMonth: (targetMonth?: Date) => {
    monthKey: string;
    total: number;
    totalScheduledMonthly: number;
    fixedTotal: number;
    dynamicTotal: number;
    contributions: MonthPotContribution[];
    point: MonthSeriesPoint;
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

  // Detect any months that have ALREADY been pre-allocated by a Gamma paycheck (persisted in tx.raw.paycheck_allocation_breakdown
  // or localStorage). For example, when the Dec 2026 paycheck lands on Nov 28th and auto-allocates £846.64 into the 7 pots,
  // each pot's `assigned_amount` in the database ALREADY includes December's contribution!
  // If we didn't lock December to its payday breakdown, the chart would think `Europe winter` & `Xmas & Gifts` needed £0 in Dec
  // and would try to schedule Jan–Apr's remaining balances back into Dec!
  const preAllocatedByMonthKey = new Map<string, Map<string, number>>();
  for (const tx of transactions) {
    if (!tx || tx.amount < 1000 || tx.is_transfer) continue;
    const rawObj = (tx.raw as any) || {};
    let breakdownObj = rawObj.paycheck_allocation_breakdown;
    if (!breakdownObj && typeof localStorage !== 'undefined' && tx.id) {
      try {
        const s = localStorage.getItem(`paycheck_allocation_snapshot_${tx.id}`);
        if (s) breakdownObj = JSON.parse(s);
      } catch {
        breakdownObj = null;
      }
    }
    if (!breakdownObj || !Array.isArray(breakdownObj.goalAllocations) || !(breakdownObj.totalGoalAllocations > 0)) {
      continue;
    }

    // Determine effective month of this Gamma paycheck (paychecks landing on 20th+ fund the next month)
    const rawDateStr = String(tx.posted_at || '').split('T')[0];
    const parts = rawDateStr.split('-').map(Number);
    if (parts.length !== 3 || isNaN(parts[0])) continue;
    const txDate = new Date(parts[0], parts[1] - 1, parts[2]);
    const effMonthDate = txDate.getDate() >= 20
      ? new Date(txDate.getFullYear(), txDate.getMonth() + 1, 1)
      : new Date(txDate.getFullYear(), txDate.getMonth(), 1);
    const effMonthKey = format(effMonthDate, 'yyyy-MM');

    if (!preAllocatedByMonthKey.has(effMonthKey)) {
      const goalMap = new Map<string, number>();
      for (const item of breakdownObj.goalAllocations) {
        if (item.goalId && Number(item.allocatedAmount) > 0.01) {
          goalMap.set(item.goalId, Number(item.allocatedAmount));
        }
      }
      if (goalMap.size > 0) {
        preAllocatedByMonthKey.set(effMonthKey, goalMap);
      }
    }
  }

  // Build a lookup of all pre-allocated amounts in months >= currentMonthStart for each goal
  const preAllocatedFutureSumByGoal = new Map<string, number>();
  preAllocatedByMonthKey.forEach((goalMap, mKey) => {
    const [y, m] = mKey.split('-').map(Number);
    const mStart = new Date(y, m - 1, 1);
    if (mStart >= currentMonthStart) {
      goalMap.forEach((amt, gId) => {
        preAllocatedFutureSumByGoal.set(gId, (preAllocatedFutureSumByGoal.get(gId) || 0) + amt);
      });
    }
  });

  const metas: ActiveGoalMeta[] = [];
  let maxMonthDate = addMonths(currentMonthStart, 5);

  eligibleGoals.forEach((g, idx) => {
    const targetBase = convertToBase(g.target_amount || 0, g.currency);
    const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
    const spentBase = spentByGoalTotal.get(g.id) || 0;
    const refillWhenSpent = Boolean(g.refill_when_spent);
    const effectiveFundedBase = refillWhenSpent ? assignedBase : assignedBase + spentBase;
    // Future remaining after any already-allocated payday transfers
    const remainingAfterPreAllocBase = Math.max(0, targetBase - effectiveFundedBase);
    const preAllocForGoal = preAllocatedFutureSumByGoal.get(g.id) || 0;
    // Total remaining to display across the schedule (includes the pre-allocated payday month so Dec 26 shows Europe winter & Xmas & Gifts!)
    const remainingToSaveBase = remainingAfterPreAllocBase + preAllocForGoal;

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

  const monthKeys = monthDates.map(mDate => format(mDate, 'yyyy-MM'));
  const isMonthPreAllocated = monthKeys.map(mKey => preAllocatedByMonthKey.has(mKey));

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
    let unallocatedActiveDays = 0;

    monthDates.forEach((mDate, mIdx) => {
      const mKey = monthKeys[mIdx];
      const preMap = preAllocatedByMonthKey.get(mKey);
      const mStart = startOfMonth(mDate);
      const mEnd = endOfMonth(mDate);
      const windowStart = meta.effectiveStart > mStart ? meta.effectiveStart : mStart;
      const windowEnd = meta.effectiveDeadline < mEnd ? meta.effectiveDeadline : mEnd;

      if (preMap) {
        // This month's payday allocation already happened!
        const lockedAmt = preMap.get(meta.goal.id) || 0;
        const activeDays = windowEnd >= windowStart
          ? Math.max(1, differenceInCalendarDays(windowEnd, windowStart) + 1)
          : (lockedAmt > 0 ? differenceInCalendarDays(mEnd, mStart) + 1 : 0);
        daysPerMonth[mIdx] = lockedAmt > 0 ? activeDays : 0;
        evenPerMonth[mIdx] = lockedAmt;
      } else if (windowEnd >= windowStart) {
        // If today's current month (mIdx === 0) is already in its final payday week (20th+) and next month is pre-allocated,
        // don't schedule extra savings into the remaining few days of currentMonth
        const isCurrentMonthAlreadyPastPayday =
          mIdx === 0 &&
          monthDates.length > 1 &&
          isMonthPreAllocated[1];
        if (isCurrentMonthAlreadyPastPayday) {
          daysPerMonth[mIdx] = 0;
          evenPerMonth[mIdx] = 0;
        } else {
          const activeDays = differenceInCalendarDays(windowEnd, windowStart) + 1;
          daysPerMonth[mIdx] = activeDays;
          evenPerMonth[mIdx] = 0;
          unallocatedActiveDays += activeDays;
        }
      } else {
        daysPerMonth[mIdx] = 0;
        evenPerMonth[mIdx] = 0;
      }
    });

    // Distribute only the REMAINING post-payday balance (`targetBase - effectiveFundedBase`) across non-pre-allocated active months
    const remainingForUnallocatedMonths = Math.max(0, meta.targetBase - meta.effectiveFundedBase);
    if (unallocatedActiveDays > 0 && remainingForUnallocatedMonths > 0) {
      monthDates.forEach((_, mIdx) => {
        if (!isMonthPreAllocated[mIdx] && daysPerMonth[mIdx] > 0) {
          evenPerMonth[mIdx] = (remainingForUnallocatedMonths * daysPerMonth[mIdx]) / unallocatedActiveDays;
        }
      });
    }

    activeDaysMatrix.set(meta.goal.id, daysPerMonth);
    evenAllocMatrix.set(meta.goal.id, evenPerMonth);
  }

  // PASS 1: Lock in all 'fixed' pots first (and all pre-allocated months) as the foundation layer
  const monthCommittedLoad = new Array(monthDates.length).fill(0);

  for (const meta of metas) {
    if (meta.pacingMode !== 'fixed') continue;
    const evenPerMonth = evenAllocMatrix.get(meta.goal.id)!;
    finalAllocMatrix.set(meta.goal.id, [...evenPerMonth]);
    evenPerMonth.forEach((amt, mIdx) => {
      monthCommittedLoad[mIdx] += amt;
    });
  }

  // Also add pre-allocated dynamic pot amounts into monthCommittedLoad for pre-allocated months
  for (const meta of metas) {
    if (meta.pacingMode !== 'dynamic') continue;
    const evenPerMonth = evenAllocMatrix.get(meta.goal.id)!;
    evenPerMonth.forEach((amt, mIdx) => {
      if (isMonthPreAllocated[mIdx]) {
        monthCommittedLoad[mIdx] += amt;
      }
    });
  }

  // PASS 2: Calculate all 'dynamic' pots OVER THE TOP of the fixed pots across non-pre-allocated months (in deadline order)
  for (const meta of metas) {
    if (meta.pacingMode !== 'dynamic') continue;

    const daysPerMonth = activeDaysMatrix.get(meta.goal.id)!;
    const evenPerMonth = evenAllocMatrix.get(meta.goal.id)!;
    const openActiveMonthIndices = daysPerMonth
      .map((d, idx) => (d > 0 && !isMonthPreAllocated[idx] ? idx : -1))
      .filter(idx => idx !== -1);

    const remainingForUnallocatedMonths = Math.max(0, meta.targetBase - meta.effectiveFundedBase);

    if (openActiveMonthIndices.length <= 1 || remainingForUnallocatedMonths <= 0.01) {
      finalAllocMatrix.set(meta.goal.id, [...evenPerMonth]);
      openActiveMonthIndices.forEach(idx => {
        monthCommittedLoad[idx] += evenPerMonth[idx];
      });
      continue;
    }

    const BASELINE_RATIO = 0.2;
    const baselinePerMonth = monthDates.map((_, mIdx) =>
      isMonthPreAllocated[mIdx] ? evenPerMonth[mIdx] : evenPerMonth[mIdx] * BASELINE_RATIO
    );
    const flexRemaining = remainingForUnallocatedMonths * (1 - BASELINE_RATIO);

    // Existing daily load u_m includes all FIXED pots + more-urgent DYNAMIC pots
    const dailyLoad = monthDates.map((_, mIdx) => {
      return (monthCommittedLoad[mIdx] + baselinePerMonth[mIdx]) / monthAvailableDays[mIdx];
    });

    let low = Math.min(...openActiveMonthIndices.map(mIdx => dailyLoad[mIdx]));
    let high =
      Math.max(...openActiveMonthIndices.map(mIdx => dailyLoad[mIdx])) +
      flexRemaining / Math.min(...openActiveMonthIndices.map(mIdx => Math.max(1, daysPerMonth[mIdx])));

    for (let iter = 0; iter < 45; iter++) {
      const mid = (low + high) / 2;
      let allocated = 0;
      for (const mIdx of openActiveMonthIndices) {
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
      if (isMonthPreAllocated[mIdx]) return evenPerMonth[mIdx];
      if (daysPerMonth[mIdx] <= 0) return 0;
      const flexAdd = daysPerMonth[mIdx] * Math.max(0, waterLevel - dailyLoad[mIdx]);
      return baselinePerMonth[mIdx] + flexAdd;
    });

    finalAllocMatrix.set(meta.goal.id, dynPerMonth);
    openActiveMonthIndices.forEach(mIdx => {
      monthCommittedLoad[mIdx] += dynPerMonth[mIdx];
    });
  }

  const cumulativeByGoal = new Map<string, number>();
  metas.forEach(m => {
    const preAlloc = preAllocatedFutureSumByGoal.get(m.goal.id) || 0;
    cumulativeByGoal.set(m.goal.id, Math.max(0, m.effectiveFundedBase - preAlloc));
  });

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

  // If the first month (e.g. Nov 26 after Dec 26's paycheck has already landed) has £0 left to schedule,
  // shift it off the front so the chart starts cleanly at Dec 26!
  while (series.length > 1 && series[0].total <= 0.01) {
    series.shift();
  }

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
    const mIdx = monthDates.findIndex(d => format(d, 'yyyy-MM') === targetKey);
    const targetMonthStart = startOfMonth(targetMonth);
    const isBeforeGoalStart = Boolean(meta.rawStart && targetMonthStart < startOfMonth(meta.rawStart));

    // CRITICAL: If this goal has 0 active days in targetMonth (e.g. it already finished in December or its deadline has passed),
    // NEVER fall back to `firstActive` (December) and repeat December's contribution in January, February, March, and April!
    if (mIdx === -1 || daysArr[mIdx] <= 0) {
      if (isBeforeGoalStart) {
        const firstActive = daysArr.findIndex(d => d > 0);
        if (firstActive !== -1) {
          const previewDays = Math.max(1, daysArr[firstActive] || 30.44);
          const previewWeeks = Math.max(1, previewDays / 7);
          const previewAmt = Math.min(meta.remainingToSaveBase, finalArr[firstActive] || 0);
          return {
            pacingMode: meta.pacingMode,
            remainingToSaveBase: meta.remainingToSaveBase,
            monthlyAmount: 0,
            weeklyPace: previewAmt / previewWeeks,
            evenMonthlyAmount: 0,
            evenWeeklyPace: previewAmt / previewWeeks,
            dynamicMonthlyAmount: 0,
            dynamicWeeklyPace: previewAmt / previewWeeks,
            activeMonthLabel: format(monthDates[firstActive], 'MMM'),
            isFutureStart: true,
            isLighterThisMonth: false,
            isBoostedThisMonth: false,
          };
        }
      }
      return null;
    }

    const activeDays = Math.max(1, daysArr[mIdx] || 30.44);
    const weeksInWindow = Math.max(1, activeDays / 7);
    const evenMonthlyAmount = Math.min(meta.remainingToSaveBase, evenArr[mIdx] || 0);
    const chosenMonthlyAmount = Math.min(meta.remainingToSaveBase, finalArr[mIdx] || 0);
    const evenWeeklyPace = evenMonthlyAmount / weeksInWindow;
    const chosenWeeklyPace = chosenMonthlyAmount / weeksInWindow;

    return {
      pacingMode: meta.pacingMode,
      remainingToSaveBase: meta.remainingToSaveBase,
      monthlyAmount: chosenMonthlyAmount,
      weeklyPace: chosenWeeklyPace,
      evenMonthlyAmount,
      evenWeeklyPace,
      dynamicMonthlyAmount: chosenMonthlyAmount,
      dynamicWeeklyPace: chosenWeeklyPace,
      activeMonthLabel: format(monthDates[mIdx], 'MMM'),
      isFutureStart: false,
      isLighterThisMonth:
        meta.pacingMode === 'dynamic' && chosenMonthlyAmount < evenMonthlyAmount * 0.88,
      isBoostedThisMonth:
        meta.pacingMode === 'dynamic' && chosenMonthlyAmount > evenMonthlyAmount * 1.12,
    };
  };

  const getScheduleForMonth = (targetMonth: Date = today) => {
    const targetKey = format(targetMonth, 'yyyy-MM');
    const found = series.find(s => s.monthKey === targetKey);
    if (!found) return null;
    return {
      monthKey: found.monthKey,
      total: found.total,
      totalScheduledMonthly: found.total,
      fixedTotal: found.fixedTotal,
      dynamicTotal: found.dynamicTotal,
      contributions: found.contributions,
      point: found,
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
    getScheduleForMonth,
  };
}
