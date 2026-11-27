import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  getDate,
  getDaysInMonth,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { FinanceCategory, FinanceGoal, FinanceTransaction } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import type { WeekType } from '@/hooks/useWeekTypes';
import { baseAmt, parseUkDate } from './financeUtils';
import { deduplicateTransactions } from './deduplication';
import { computeMonthlyPotSchedule } from './potPacingEngine';
import {
  computeEssentialVariableMonthly,
  computeWeekVariableSpend,
  isInternalTransferTx,
} from './policyEngine';
import { parseCoverMeta } from './overspendCover';

export interface ExtraIncomeSpreadItem {
  txId: string;
  name: string;
  streamName: string;
  amount: number;
  postedDate: Date;
  dayOfMonth: number;
  remainingDaysInMonth: number;
  dailyBoostAmount: number;
}

export interface MonthDailyAllowancePlan {
  monthKey: string;
  monthLabel: string;
  monthStart: Date;
  monthEnd: Date;
  daysInMonth: number;
  gammaMonthlyIncome: number;
  fixedBillsMonthly: number;
  variableEssentialsMonthly: number;
  potSavingsMonthly: number;
  baseFunMonthly: number;
  baseMonthlySpendCap: number; // Variable Essentials + Base Fun Money
  baseDailySpendCap: number;   // BaseSpendCap / daysInMonth
  baseDailyEssential: number;  // VariableEssentials / daysInMonth
  baseDailyFun: number;        // BaseFunMoney / daysInMonth
  extraIncomeTotal: number;
  extraIncomeItems: ExtraIncomeSpreadItem[];
  totalMonthlySpendCap: number; // BaseSpendCap + ExtraIncomeTotal
  /** Array of length daysInMonth (index 0 = day 1 of month) */
  days: Array<{
    date: Date;
    dateKey: string;
    dayOfMonth: number;
    baseDailyCap: number;
    baseDailyEssential: number;
    baseDailyFun: number;
    extraDailyBoost: number;
    totalDailyAllowance: number;
    totalDailyFun: number;
  }>;
}

export interface WeekMonthSegment {
  monthKey: string;
  monthLabel: string;
  shortMonthLabel: string;
  daysCount: number;
  baseDailyCap: number;
  extraDailyAvg: number;
  totalDailyAvg: number;
  segmentTotalAllowance: number;
}

export interface WeekAllowanceFromDaysResult {
  weekStart: Date;
  weekEnd: Date;
  weekKey: string;
  isCrossMonthWeek: boolean;
  weeklyEssentialAllowance: number;
  weeklyBaseFunAllowance: number;
  weeklyExtraIncomeBoost: number;
  weeklyTotalFunAllowance: number;
  weeklyTotalSpendCap: number; // 7-day sum of (Essentials + Base Fun + Extra Income)
  segments: WeekMonthSegment[];
  activeExtraIncomeItems: ExtraIncomeSpreadItem[];
  days: Array<{
    date: Date;
    dateKey: string;
    monthKey: string;
    baseDailyEssential: number;
    baseDailyFun: number;
    extraDailyBoost: number;
    totalDailyAllowance: number;
  }>;
}

export interface MonthStashSweepSummary {
  sweptToStashTotal: number;
  closedWeeksInMonth: Array<{
    weekKey: string;
    daysInThisMonth: number;
    allowanceInMonth: number;
    spentInMonth: number;
    sweptToStash: number;
  }>;
  activeAndFutureAllowanceInMonth: number;
  activeWeekSpentInMonth: number;
  remainingSpendableInMonth: number;
}

/**
 * Classifies an income transaction into either:
 * - 'gamma': Base monthly Gamma salary (~£2,400), shifted to Month M+1 if paid on/after the 24th of Month M.
 * - 'extra': Any non-Gamma earned income (ElevenLabs, Venture Advisory, Back Pocket Games, Etsy, etc.)
 */
export function classifyIncomeTxForMonth(
  tx: FinanceTransaction,
  catById: Map<string, FinanceCategory>,
): {
  kind: 'gamma' | 'extra';
  streamName: string;
  amount: number;
  rawDate: Date;
  effectiveMonthDate: Date;
} | null {
  if (tx.amount <= 0 || tx.is_reimbursable || (tx as any).is_refund || (tx as any).is_kiri_payback) {
    return null;
  }
  const cat = tx.category_id ? catById.get(tx.category_id) : undefined;
  const isExplicitIncome = cat?.type === 'income';
  if (!isExplicitIncome && isInternalTransferTx(tx)) return null;
  if (cat && cat.type !== 'income') return null;

  const catName = cat?.name?.trim() || '';
  const catLower = catName.toLowerCase();
  const text = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();

  // Exclude peer reimbursements / Kiri paybacks
  if (text.includes('kiri') || text.includes('smyth')) return null;

  const amt = Math.abs(baseAmt(tx));
  const rawDate = parseUkDate(tx.posted_at);

  const isGamma =
    ((text.includes('gamma') && (!text.includes('gamma network') || amt >= 500)) ||
      catLower.includes('gamma') ||
      catLower.includes('salary')) &&
    amt >= 1000;

  if (isGamma) {
    // Gamma salary paid on/after the 24th of Month M funds Month M+1
    const effectiveMonthDate =
      rawDate.getDate() >= 24
        ? new Date(rawDate.getFullYear(), rawDate.getMonth() + 1, 1, 0, 0, 0, 0)
        : rawDate;
    return {
      kind: 'gamma',
      streamName: 'Gamma Salary',
      amount: amt,
      rawDate,
      effectiveMonthDate,
    };
  }

  let streamName = '';
  if (
    text.includes('eleven') ||
    text.includes('11labs') ||
    catLower.includes('eleven')
  ) {
    streamName = 'ElevenLabs';
  } else if (
    text.includes('venture') ||
    text.includes('batchbase') ||
    text.includes('batch base') ||
    text.includes('advisory') ||
    catLower.includes('venture') ||
    catLower.includes('batchbase') ||
    catLower.includes('advisory')
  ) {
    streamName = 'Venture Advisory';
  } else if (
    text.includes('back pocket') ||
    text.includes('bpg') ||
    catLower.includes('back pocket')
  ) {
    streamName = 'Back Pocket Games';
  } else if (text.includes('etsy') || catLower.includes('etsy')) {
    streamName = 'Etsy';
  } else if (isExplicitIncome && catLower !== 'income') {
    streamName = catName;
  } else {
    return null;
  }

  return {
    kind: 'extra',
    streamName,
    amount: amt,
    rawDate,
    effectiveMonthDate: rawDate,
  };
}

/**
 * Computes the complete daily allowance schedule for a single calendar month M:
 * 1. Gamma Salary (~£2,400)
 * 2. - Fixed Bills
 * 3. - Variable Essentials
 * 4. - Monthly Savings Pots (scheduled for Month M)
 * 5. = Base Fun Money
 * 6. Base Monthly Spend Cap = Variable Essentials + Base Fun Money
 * 7. Base Daily Rate = Base Monthly Spend Cap / DaysInMonth(M)
 * 8. Extra Income (ElevenLabs, Venture Advisory, Etsy, etc.) in Month M is spread across
 *    the remaining days left in Month M from the date it landed through the end of Month M.
 */
export function computeMonthDailyAllowancePlan(params: {
  monthDate: Date;
  assumptions: FinanceAssumptions;
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  goals: FinanceGoal[];
  convertToBase: (amount: number, currency: string) => number;
  fixedExpensesMonthly: number;
  weekTypeMap?: Map<string, WeekType>;
  trips?: FinanceTrip[];
}): MonthDailyAllowancePlan {
  const {
    monthDate,
    assumptions,
    transactions,
    categories,
    goals,
    convertToBase,
    fixedExpensesMonthly,
    weekTypeMap,
    trips = [],
  } = params;

  const mStart = startOfMonth(monthDate);
  const mEnd = endOfMonth(monthDate);
  const monthKey = format(mStart, 'yyyy-MM');
  const monthLabel = format(mStart, 'MMMM yyyy');
  const daysInMonth = getDaysInMonth(mStart);

  const catById = new Map(categories.map(c => [c.id, c]));
  const { cleaned: dedupedTxs } = deduplicateTransactions(transactions);

  // 1. Identify Gamma Salary for this calendar month (or fallback to expected_monthly_income / £2,400)
  const gammaCandidates: Array<{ amount: number; rawDate: Date; txId: string }> = [];
  const extraIncomeItems: ExtraIncomeSpreadItem[] = [];

  for (const tx of dedupedTxs) {
    const info = classifyIncomeTxForMonth(tx, catById);
    if (!info) continue;

    if (info.kind === 'gamma') {
      if (info.effectiveMonthDate >= mStart && info.effectiveMonthDate <= mEnd) {
        gammaCandidates.push({
          amount: info.amount,
          rawDate: info.rawDate,
          txId: tx.id,
        });
      }
    } else if (info.kind === 'extra') {
      if (info.rawDate >= mStart && info.rawDate <= mEnd) {
        const dayOfMonth = Math.max(1, Math.min(daysInMonth, getDate(info.rawDate)));
        const remainingDaysInMonth = Math.max(1, daysInMonth - dayOfMonth + 1);
        // To prevent late-month deposits (e.g. a weekly Venture Advisory deposit on Nov 25 with 5 days left)
        // from cramming 6x their normal daily rate into Week 4 and snowballing on top of earlier weeks' deposits,
        // divide by daysInMonth so each extra deposit contributes its true monthly daily rate from the day it lands.
        const dailyBoostAmount = info.amount / daysInMonth;
        extraIncomeItems.push({
          txId: tx.id,
          name: tx.merchant || tx.description || info.streamName,
          streamName: info.streamName,
          amount: info.amount,
          postedDate: startOfDay(info.rawDate),
          dayOfMonth,
          remainingDaysInMonth,
          dailyBoostAmount,
        });
      }
    }
  }

  // Pick the primary Gamma paycheck if landed, otherwise use expected_monthly_income (default £2,400)
  gammaCandidates.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
  const expectedGamma =
    assumptions.expected_monthly_income && assumptions.expected_monthly_income > 0
      ? assumptions.expected_monthly_income
      : 2400;
  const gammaMonthlyIncome =
    gammaCandidates.length > 0 ? gammaCandidates[0].amount : expectedGamma;

  // 2. Fixed Bills for Month M (committed fixed bills + any extra fixed bill overages in Month M)
  const extraFixedInMonth = dedupedTxs.reduce((sum, tx) => {
    const extra = Number((tx as any).extra_fixed_bill_amount) || 0;
    if (extra <= 0) return sum;
    return String(tx.posted_at || '').startsWith(monthKey) ? sum + extra : sum;
  }, 0);
  const fixedBillsMonthly = Math.max(0, (fixedExpensesMonthly || 0) + extraFixedInMonth);

  // 3. Variable Essentials for Month M
  const refForEssentials = isSameMonth(monthDate, new Date()) ? new Date() : mEnd;
  const essentialResult = computeEssentialVariableMonthly(
    dedupedTxs,
    categories,
    weekTypeMap,
    trips,
    startOfWeek(refForEssentials, { weekStartsOn: 1 }),
  );
  const variableEssentialsMonthly = Math.max(
    assumptions.estimated_essential_variable ?? 0,
    essentialResult.monthly,
  );

  // 4. Savings Pots for Month M
  // CRITICAL: Always anchor the monthly pot schedule to `mStart` (the 1st of Month M) so that
  // Month M's full 30/31-day pot savings requirement is deducted from Month M's £2,400 Gamma salary!
  // Never pass `today` (e.g. Nov 27 = 4 days left), which would only deduct 4 days of pot savings
  // and dump the other ~£700 of pot money into Fun Money!
  const potSchedule = computeMonthlyPotSchedule({
    goals,
    transactions: dedupedTxs,
    categories,
    convertToBase,
    referenceDate: mStart,
  });

  let scheduledPotSavings = 0;
  const targetPoint = potSchedule.months.find(m => m.monthKey === monthKey);
  if (targetPoint) {
    scheduledPotSavings = targetPoint.total;
  } else {
    for (const g of goals) {
      const lower = (g.name || '').trim().toLowerCase();
      if ((g as any).is_stash || (g as any).is_emergency) continue;
      if (lower.includes('stash') || lower.includes('emergency') || lower === 'savings' || lower === 'core savings') {
        continue;
      }
      const plan = potSchedule.getGoalPlanForMonth(g.id, mStart);
      if (plan && !plan.isFutureStart && plan.monthlyAmount > 0) {
        scheduledPotSavings += Math.min(plan.remainingToSaveBase, plan.monthlyAmount);
      }
    }
  }

  const incomeAfterFixedAndEssentials = Math.max(
    0,
    gammaMonthlyIncome - fixedBillsMonthly - variableEssentialsMonthly,
  );
  const potSavingsMonthly = Math.min(scheduledPotSavings, incomeAfterFixedAndEssentials);

  // 5. Fun Money = Gamma - Fixed Bills - Variable Essentials - Pot Savings
  const baseFunMonthly = Math.max(0, incomeAfterFixedAndEssentials - potSavingsMonthly);

  // 6. Monthly Base Spend Cap on Card = Variable Essentials + Base Fun Money
  const baseMonthlySpendCap = variableEssentialsMonthly + baseFunMonthly;

  // 7. Base Daily Total = Base Spend Cap / DaysInMonth
  const baseDailySpendCap = daysInMonth > 0 ? baseMonthlySpendCap / daysInMonth : 0;
  const baseDailyEssential = daysInMonth > 0 ? variableEssentialsMonthly / daysInMonth : 0;
  const baseDailyFun = daysInMonth > 0 ? baseFunMonthly / daysInMonth : 0;

  // 8. Build day-by-day array with Extra Income distributed across remaining days in the month
  const extraIncomeTotal = extraIncomeItems.reduce((sum, item) => sum + item.amount, 0);
  const days: MonthDailyAllowancePlan['days'] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(mStart.getFullYear(), mStart.getMonth(), d, 0, 0, 0, 0);
    const dateKey = format(curDate, 'yyyy-MM-dd');

    // Sum daily boost from all extra income items that landed on or before day `d` in this month
    let extraDailyBoost = 0;
    for (const item of extraIncomeItems) {
      if (d >= item.dayOfMonth) {
        extraDailyBoost += item.dailyBoostAmount;
      }
    }

    days.push({
      date: curDate,
      dateKey,
      dayOfMonth: d,
      baseDailyCap: baseDailySpendCap,
      baseDailyEssential,
      baseDailyFun,
      extraDailyBoost,
      totalDailyAllowance: baseDailySpendCap + extraDailyBoost,
      totalDailyFun: baseDailyFun + extraDailyBoost,
    });
  }

  return {
    monthKey,
    monthLabel,
    monthStart: mStart,
    monthEnd: mEnd,
    daysInMonth,
    gammaMonthlyIncome,
    fixedBillsMonthly,
    variableEssentialsMonthly,
    potSavingsMonthly,
    baseFunMonthly,
    baseMonthlySpendCap,
    baseDailySpendCap,
    baseDailyEssential,
    baseDailyFun,
    extraIncomeTotal,
    extraIncomeItems,
    totalMonthlySpendCap: baseMonthlySpendCap + extraIncomeTotal,
    days,
  };
}

/**
 * Computes the 7-day weekly spending allowance (Monday–Sunday) by summing the exact
 * daily allowance of each of the 7 calendar days.
 * Automatically handles split-month weeks (e.g. 3 days in November + 4 days in December).
 */
export function computeWeekAllowanceFromDays(params: {
  weekStartInput: Date;
  assumptions: FinanceAssumptions;
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  goals: FinanceGoal[];
  convertToBase: (amount: number, currency: string) => number;
  fixedExpensesMonthly: number;
  weekTypeMap?: Map<string, WeekType>;
  trips?: FinanceTrip[];
}): WeekAllowanceFromDaysResult {
  const {
    weekStartInput,
    assumptions,
    transactions,
    categories,
    goals,
    convertToBase,
    fixedExpensesMonthly,
    weekTypeMap,
    trips = [],
  } = params;

  const ws = startOfWeek(weekStartInput, { weekStartsOn: 1 });
  const we = endOfWeek(ws, { weekStartsOn: 1 });
  const weekKey = format(ws, 'yyyy-MM-dd');

  // Cache month plans for the 1 or 2 calendar months touched by this 7-day week
  const monthPlans = new Map<string, MonthDailyAllowancePlan>();
  const getPlan = (d: Date): MonthDailyAllowancePlan => {
    const mKey = format(d, 'yyyy-MM');
    let plan = monthPlans.get(mKey);
    if (!plan) {
      plan = computeMonthDailyAllowancePlan({
        monthDate: d,
        assumptions,
        transactions,
        categories,
        goals,
        convertToBase,
        fixedExpensesMonthly,
        weekTypeMap,
        trips,
      });
      monthPlans.set(mKey, plan);
    }
    return plan;
  };

  let weeklyEssentialAllowance = 0;
  let weeklyBaseFunAllowance = 0;
  let weeklyExtraIncomeBoost = 0;
  const days: WeekAllowanceFromDaysResult['days'] = [];
  const segmentMap = new Map<
    string,
    {
      monthKey: string;
      monthLabel: string;
      shortMonthLabel: string;
      daysCount: number;
      baseCapSum: number;
      extraSum: number;
      totalSum: number;
    }
  >();
  const activeExtraItemsMap = new Map<string, ExtraIncomeSpreadItem>();

  for (let i = 0; i < 7; i++) {
    const curDate = addDays(ws, i);
    const plan = getPlan(curDate);
    const dayOfMonth = getDate(curDate);
    const dayEntry = plan.days[dayOfMonth - 1] || {
      date: curDate,
      dateKey: format(curDate, 'yyyy-MM-dd'),
      dayOfMonth,
      baseDailyCap: plan.baseDailySpendCap,
      baseDailyEssential: plan.baseDailyEssential,
      baseDailyFun: plan.baseDailyFun,
      extraDailyBoost: 0,
      totalDailyAllowance: plan.baseDailySpendCap,
      totalDailyFun: plan.baseDailyFun,
    };

    weeklyEssentialAllowance += dayEntry.baseDailyEssential;
    weeklyBaseFunAllowance += dayEntry.baseDailyFun;
    weeklyExtraIncomeBoost += dayEntry.extraDailyBoost;

    for (const item of plan.extraIncomeItems) {
      if (dayOfMonth >= item.dayOfMonth) {
        activeExtraItemsMap.set(item.txId, item);
      }
    }

    days.push({
      date: curDate,
      dateKey: dayEntry.dateKey,
      monthKey: plan.monthKey,
      baseDailyEssential: dayEntry.baseDailyEssential,
      baseDailyFun: dayEntry.baseDailyFun,
      extraDailyBoost: dayEntry.extraDailyBoost,
      totalDailyAllowance: dayEntry.totalDailyAllowance,
    });

    const existingSeg = segmentMap.get(plan.monthKey);
    if (existingSeg) {
      existingSeg.daysCount += 1;
      existingSeg.baseCapSum += dayEntry.baseDailyCap;
      existingSeg.extraSum += dayEntry.extraDailyBoost;
      existingSeg.totalSum += dayEntry.totalDailyAllowance;
    } else {
      segmentMap.set(plan.monthKey, {
        monthKey: plan.monthKey,
        monthLabel: plan.monthLabel,
        shortMonthLabel: format(curDate, 'MMM'),
        daysCount: 1,
        baseCapSum: dayEntry.baseDailyCap,
        extraSum: dayEntry.extraDailyBoost,
        totalSum: dayEntry.totalDailyAllowance,
      });
    }
  }

  const segments: WeekMonthSegment[] = Array.from(segmentMap.values()).map(seg => ({
    monthKey: seg.monthKey,
    monthLabel: seg.monthLabel,
    shortMonthLabel: seg.shortMonthLabel,
    daysCount: seg.daysCount,
    baseDailyCap: seg.daysCount > 0 ? seg.baseCapSum / seg.daysCount : 0,
    extraDailyAvg: seg.daysCount > 0 ? seg.extraSum / seg.daysCount : 0,
    totalDailyAvg: seg.daysCount > 0 ? seg.totalSum / seg.daysCount : 0,
    segmentTotalAllowance: seg.totalSum,
  }));

  const weeklyTotalFunAllowance = weeklyBaseFunAllowance + weeklyExtraIncomeBoost;
  const weeklyTotalSpendCap = weeklyEssentialAllowance + weeklyTotalFunAllowance;

  return {
    weekStart: ws,
    weekEnd: we,
    weekKey,
    isCrossMonthWeek: segments.length > 1,
    weeklyEssentialAllowance,
    weeklyBaseFunAllowance,
    weeklyExtraIncomeBoost,
    weeklyTotalFunAllowance,
    weeklyTotalSpendCap,
    segments,
    activeExtraIncomeItems: Array.from(activeExtraItemsMap.values()),
    days,
  };
}

/**
 * Computes how much of a calendar month's spending cap has already been swept into
 * Savings Stash from completed weeks, so that:
 * 1. Past weeks' unspent allowance NEVER shows as "underspend / left to spend" in the Monthly total.
 * 2. Remaining spendable money in the month strictly reflects the active week's remaining allowance
 *    plus any future days in the month after the active week.
 */
export function computeMonthStashSweepSummary(params: {
  monthPlan: MonthDailyAllowancePlan;
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  goals: FinanceGoal[];
  trips?: FinanceTrip[];
  today?: Date;
}): MonthStashSweepSummary {
  const {
    monthPlan,
    transactions,
    categories,
    goals,
    trips = [],
    today = new Date(),
  } = params;

  const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const stashes = goals.filter(
    g => (g as any).is_stash === true || (g.name || '').toLowerCase().includes('stash'),
  );
  const stashGoal = stashes.find(g => (g.assigned_amount || 0) > 0) || stashes[0] || null;
  const stashMeta = parseCoverMeta((stashGoal as any)?.description);

  // Group all days in this month by their Monday weekStart key
  const daysByWeek = new Map<string, { weekStart: Date; days: MonthDailyAllowancePlan['days'] }>();
  for (const dayObj of monthPlan.days) {
    const ws = startOfWeek(dayObj.date, { weekStartsOn: 1 });
    const wkKey = format(ws, 'yyyy-MM-dd');
    const existing = daysByWeek.get(wkKey);
    if (existing) {
      existing.days.push(dayObj);
    } else {
      daysByWeek.set(wkKey, { weekStart: ws, days: [dayObj] });
    }
  }

  let sweptToStashTotal = 0;
  let activeAndFutureAllowanceInMonth = 0;
  let activeWeekSpentInMonth = 0;
  const closedWeeksInMonth: MonthStashSweepSummary['closedWeeksInMonth'] = [];

  for (const [wkKey, grp] of daysByWeek.entries()) {
    const allowanceInMonth = grp.days.reduce((s, d) => s + d.totalDailyAllowance, 0);
    const isPastClosedWeek = grp.weekStart < currentWeekStart;

    if (isPastClosedWeek) {
      // Check if we have a locked closed_week record or compute actual spend in this week's days inside the month
      const weekSummary = computeWeekVariableSpend(transactions, categories, grp.weekStart, trips);
      const closedRecord = stashMeta.closed_weeks?.[wkKey];
      const fractionOfWeekInMonth = grp.days.length / 7;

      // Attribute spend in this week to the days that fall inside this month
      const spentInMonth = grp.days.reduce((sum, d) => {
        const dayIdx = Math.min(6, Math.max(0, differenceInCalendarDays(d.date, grp.weekStart)));
        return sum + (weekSummary.daily[dayIdx]?.total || 0);
      }, 0);

      let sweptForMonthPortion = Math.max(0, allowanceInMonth - spentInMonth);
      if (closedRecord && typeof closedRecord.netDifference === 'number' && closedRecord.netDifference > 0) {
        // If full week is inside this month, use exact closed netDifference
        if (grp.days.length === 7) {
          sweptForMonthPortion = Math.max(0, closedRecord.netDifference);
        } else {
          sweptForMonthPortion = Math.max(0, closedRecord.netDifference * fractionOfWeekInMonth);
        }
      }

      sweptToStashTotal += sweptForMonthPortion;
      closedWeeksInMonth.push({
        weekKey: wkKey,
        daysInThisMonth: grp.days.length,
        allowanceInMonth,
        spentInMonth,
        sweptToStash: sweptForMonthPortion,
      });
    } else {
      activeAndFutureAllowanceInMonth += allowanceInMonth;
      if (format(grp.weekStart, 'yyyy-MM-dd') === format(currentWeekStart, 'yyyy-MM-dd')) {
        const weekSummary = computeWeekVariableSpend(transactions, categories, grp.weekStart, trips);
        activeWeekSpentInMonth = grp.days.reduce((sum, d) => {
          const dayIdx = Math.min(6, Math.max(0, differenceInCalendarDays(d.date, grp.weekStart)));
          return sum + (weekSummary.daily[dayIdx]?.total || 0);
        }, 0);
      }
    }
  }

  const remainingSpendableInMonth = Math.max(
    0,
    activeAndFutureAllowanceInMonth - activeWeekSpentInMonth,
  );

  return {
    sweptToStashTotal,
    closedWeeksInMonth,
    activeAndFutureAllowanceInMonth,
    activeWeekSpentInMonth,
    remainingSpendableInMonth,
  };
}
