import { useEffect, useState, useCallback } from 'react';
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

export type PotPacingMode = 'dynamic' | 'even';

const STORAGE_KEY = 'gvb_pot_pacing_mode';
const EVENT_NAME = 'gvb-pot-pacing-mode-change';

export function getPotPacingMode(): PotPacingMode {
  if (typeof window === 'undefined') return 'dynamic';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'even' ? 'even' : 'dynamic';
}

export function setPotPacingMode(mode: PotPacingMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mode }));
}

export function usePotPacingMode(): [PotPacingMode, (mode: PotPacingMode) => void] {
  const [mode, setModeState] = useState<PotPacingMode>(() => getPotPacingMode());

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<PotPacingMode>;
      setModeState(custom.detail || getPotPacingMode());
    };
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener('storage', () => setModeState(getPotPacingMode()));
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
    };
  }, []);

  const updateMode = useCallback((next: PotPacingMode) => {
    setModeState(next);
    setPotPacingMode(next);
  }, []);

  return [mode, updateMode];
}

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

export interface ActiveGoalMeta {
  goal: FinanceGoal;
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
  contributions: MonthPotContribution[];
  [goalId: string]: any;
}

export interface PotScheduleResult {
  pacingMode: PotPacingMode;
  activeGoalMetas: ActiveGoalMeta[];
  months: MonthSeriesPoint[];
  spentByGoalTotal: Map<string, number>;
  /** Returns a goal's planned contribution & weekly pace for the requested month (or first active month if future-start) */
  getGoalPlanForMonth: (
    goalId: string,
    targetMonth?: Date
  ) => {
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

export function computeMonthlyPotSchedule(params: {
  goals: FinanceGoal[];
  transactions?: FinanceTransaction[];
  categories?: FinanceCategory[];
  convertToBase: (amount: number, currency: string) => number;
  pacingMode?: PotPacingMode;
  referenceDate?: Date;
}): PotScheduleResult {
  const {
    goals,
    transactions = [],
    categories = [],
    convertToBase,
    pacingMode = getPotPacingMode(),
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

  // Sort active goals by deadline (soonest first) so urgent short-term goals claim capacity first
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
  const dynamicAllocMatrix = new Map<string, number[]>();

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

  // Urgency-ordered water-filling for Dynamic Smart Pace
  const monthCommittedLoad = new Array(monthDates.length).fill(0);

  for (const meta of metas) {
    const daysPerMonth = activeDaysMatrix.get(meta.goal.id)!;
    const evenPerMonth = evenAllocMatrix.get(meta.goal.id)!;
    const activeMonthIndices = daysPerMonth
      .map((d, idx) => (d > 0 ? idx : -1))
      .filter(idx => idx !== -1);

    if (activeMonthIndices.length <= 1) {
      dynamicAllocMatrix.set(meta.goal.id, [...evenPerMonth]);
      activeMonthIndices.forEach(idx => {
        monthCommittedLoad[idx] += evenPerMonth[idx];
      });
      continue;
    }

    const BASELINE_RATIO = 0.2;
    const baselinePerMonth = evenPerMonth.map(amt => amt * BASELINE_RATIO);
    const flexRemaining = meta.remainingToSaveBase * (1 - BASELINE_RATIO);

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

    dynamicAllocMatrix.set(meta.goal.id, dynPerMonth);
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
      contributions: [],
    };

    for (const meta of metas) {
      const activeDays = activeDaysMatrix.get(meta.goal.id)![mIdx];
      const evenAmt = evenAllocMatrix.get(meta.goal.id)![mIdx];
      const dynAmt = dynamicAllocMatrix.get(meta.goal.id)![mIdx];
      const chosenAmt = pacingMode === 'dynamic' ? dynAmt : evenAmt;

      if (activeDays > 0 && chosenAmt > 0.01) {
        const roundedAmt = Math.round(chosenAmt * 100) / 100;
        const roundedEven = Math.round(evenAmt * 100) / 100;
        const roundedDyn = Math.round(dynAmt * 100) / 100;
        const prevFunded = cumulativeByGoal.get(meta.goal.id) || 0;
        const projectedAfter = Math.min(meta.targetBase, prevFunded + roundedAmt);
        cumulativeByGoal.set(meta.goal.id, projectedAfter);

        const startsThisMonth = Boolean(meta.rawStart && isSameMonth(meta.rawStart, mDate));
        const endsThisMonth = Boolean(meta.rawDeadline && isSameMonth(meta.rawDeadline, mDate));
        const isBoosted = pacingMode === 'dynamic' && roundedAmt > roundedEven * 1.12;

        point[meta.goal.id] = roundedAmt;
        point.total += roundedAmt;
        point.contributions.push({
          goal: meta.goal,
          color: meta.color,
          amount: roundedAmt,
          evenAmount: roundedEven,
          dynamicAmount: roundedDyn,
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
    const dynArr = dynamicAllocMatrix.get(goalId);
    if (!daysArr || !evenArr || !dynArr) return null;

    const targetKey = format(targetMonth, 'yyyy-MM');
    let mIdx = monthDates.findIndex(d => format(d, 'yyyy-MM') === targetKey);
    if (mIdx === -1) mIdx = 0;

    // If only a few days are left in the current month (e.g. Nov 26–30) and the goal spans into next month,
    // or if the goal starts in a future month, use the first full/active month for its ongoing monthly/weekly rate display
    const isFutureStart = Boolean(meta.rawStart && meta.rawStart > today);
    let displayIdx = mIdx;
    if (daysArr[displayIdx] <= 0) {
      const firstActive = daysArr.findIndex(d => d > 0);
      if (firstActive !== -1) displayIdx = firstActive;
    } else if (
      displayIdx === 0 &&
      daysArr[0] < 14 &&
      monthDates.length > 1 &&
      daysArr[1] >= 14
    ) {
      // Use the first full month (e.g. December) when current month only has a few days remaining
      displayIdx = 1;
    }

    const activeDays = Math.max(1, daysArr[displayIdx] || 30.44);
    const weeksInWindow = Math.max(1, activeDays / 7);
    const evenMonthlyAmount = evenArr[displayIdx] || 0;
    const dynamicMonthlyAmount = dynArr[displayIdx] || 0;
    const evenWeeklyPace = evenMonthlyAmount / weeksInWindow;
    const dynamicWeeklyPace = dynamicMonthlyAmount / weeksInWindow;

    const monthlyAmount = pacingMode === 'dynamic' ? dynamicMonthlyAmount : evenMonthlyAmount;
    const weeklyPace = pacingMode === 'dynamic' ? dynamicWeeklyPace : evenWeeklyPace;

    return {
      monthlyAmount,
      weeklyPace,
      evenMonthlyAmount,
      evenWeeklyPace,
      dynamicMonthlyAmount,
      dynamicWeeklyPace,
      activeMonthLabel: format(monthDates[displayIdx], 'MMM'),
      isFutureStart,
      isLighterThisMonth: pacingMode === 'dynamic' && dynamicMonthlyAmount < evenMonthlyAmount * 0.88,
      isBoostedThisMonth: pacingMode === 'dynamic' && dynamicMonthlyAmount > evenMonthlyAmount * 1.12,
    };
  };

  return {
    pacingMode,
    activeGoalMetas: metas,
    months: series,
    spentByGoalTotal,
    getGoalPlanForMonth,
  };
}
