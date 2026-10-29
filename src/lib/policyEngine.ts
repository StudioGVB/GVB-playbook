import { FinanceTransaction, FinanceCategory, FinanceAccount, FinanceGoal } from '@/hooks/useFinanceData';
import { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import { startOfWeek, endOfWeek, subWeeks, differenceInCalendarDays, format, startOfMonth } from 'date-fns';
import type { WeekType } from '@/hooks/useWeekTypes';
import { isExcludedSpendDate, weekOverlapsExclusion, baseAmt, parseUkDate } from './financeUtils';
import { calcTakeHome } from './ukTakeHome';
import { deduplicateTransactions } from './deduplication';


// ---- Trip helpers ----

/** Returns the trip whose window contains the given date (first match), or null */
export function getActiveTripOn(date: Date, trips: FinanceTrip[]): FinanceTrip | null {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (const t of trips) {
    if (!t.start_date || !t.end_date) continue;
    const s = new Date(t.start_date);
    const e = new Date(t.end_date);
    const ss = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const ee = new Date(e.getFullYear(), e.getMonth(), e.getDate());
    if (d >= ss && d <= ee) return t;
  }
  return null;
}

/** Returns true if today falls inside ANY trip window */
export function isInAnyTrip(date: Date, trips: FinanceTrip[]): boolean {
  return getActiveTripOn(date, trips) !== null;
}

/** Total weeks across all trip windows from `from` onwards (clamps past portions) */
export function computeRemainingTripWeeks(from: Date, trips: FinanceTrip[]): number {
  let total = 0;
  for (const t of trips) {
    if (!t.start_date || !t.end_date) continue;
    const s = new Date(t.start_date);
    const e = new Date(t.end_date);
    if (e < from) continue;
    const startCount = s > from ? s : from;
    const ms = e.getTime() - startCount.getTime();
    if (ms > 0) total += ms / (1000 * 60 * 60 * 24 * 7);
  }
  return total;
}

/** Sum of pool reserved (linked goal assigned_amount minus spent so far) for all not-yet-finished trips */
export function computeTotalTripPoolReserved(
  trips: FinanceTrip[],
  goals: FinanceGoal[],
  transactions: FinanceTransaction[],
  now: Date,
): number {
  let total = 0;
  for (const t of trips) {
    if (!t.end_date) continue;
    const end = new Date(t.end_date);
    if (end < now) continue; // past trip — no reservation needed
    const goal = t.goal_id ? goals.find(g => g.id === t.goal_id) : null;
    const pool = goal?.assigned_amount || 0;
    const spent = computeTripSpent(transactions, t.id, t.start_date, t.end_date);
    total += Math.max(0, pool - spent);
  }
  return total;
}

export function computeTripSpent(
  transactions: FinanceTransaction[],
  tripId: string,
  tripStart?: string | Date | null,
  tripEnd?: string | Date | null,
): number {
  let total = 0;
  const s = tripStart ? parseUkDate(tripStart) : null;
  const e = tripEnd ? parseUkDate(tripEnd) : null;
  if (s) s.setHours(0, 0, 0, 0);
  if (e) e.setHours(23, 59, 59, 999);

  for (const tx of transactions) {
    if (tx.is_transfer || tx.is_reimbursable || tx.is_fixed) continue;
    if (tx.amount >= 0) continue;
    
    // Explicitly excluded from travel spend by user
    if ((tx as any).is_travel_spend === false) continue;

    const txTripId = (tx as any).trip_id;
    const isExplicitForThisTrip = txTripId === tripId || (tx as any).is_travel_spend === true;
    const isExplicitForAnotherTrip = txTripId && txTripId !== tripId;

    if (isExplicitForAnotherTrip) continue;

    let isDateMatch = false;
    if (!txTripId && s && e) {
      const d = parseUkDate(tx.posted_at);
      isDateMatch = d >= s && d <= e;
    }

    if (isExplicitForThisTrip || isDateMatch) {
      total += Math.abs(baseAmt(tx));
    }
  }
  return total;
}

// ---- Core Policy Calculations ----

export interface OtherIncomeItem {
  name: string;
  amount: number;
  date: Date;
  weeksSpread: number;
  perWeek: number;
}

export interface IncomeStreamBreakdownItem {
  name: string;
  amount: number;
  count: number;
}

export interface ActualSpendingIncome {
  total: number;            // total actual deposits in the current month (matches Income page)
  gamma: number;            // Gamma salary deposits in this month/cycle
  gammaDate: Date | null;   // payday of latest Gamma pay
  cycleStart: Date;         // start of the active month/cycle
  nextPayday: Date | null;  // end of the active month/cycle
  isLate: boolean;          // true if falling back to previous month before payday lands
  venture: number;          // actual VA deposits in this month/cycle
  ventureLast4Weeks: number;
  otherWeeklyBonus: number; // kept at 0 for backwards compatibility (all streams included in total)
  otherItems: OtherIncomeItem[];
  streams: IncomeStreamBreakdownItem[];
}

function isInternalTransferTx(tx: FinanceTransaction): boolean {
  const text = `${tx.merchant || ''} ${tx.description || ''} ${(tx as any).raw?.message || ''}`.toLowerCase();
  if (text.includes('batchbase') || text.includes('batch base')) return false;
  if (text.includes('venture') || text.includes('advisory')) return false;
  if (text.includes('gabriella') && tx.amount > 0 && !(tx as any).transfer_group_id) return false;

  if (tx.is_transfer) return true;
  if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') return true;

  return (
    text.includes('transfer from savings') ||
    text.includes('transfer to savings') ||
    text.includes('savings transfer') ||
    text.includes('internal transfer')
  );
}

/**
 * Actual monthly deposits model (matches the Income page):
 *  - Sums all actual earned income deposits in the current calendar month
 *    (Gamma Salary, Venture Advisory, Back Pocket Games, ElevenLabs, Etsy, etc.).
 *  - If no income/salary has landed yet at the very start of a new month, falls back
 *    to the previous calendar month until payday lands.
 */
export function computeActualSpendingIncome(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  now: Date = new Date(),
): ActualSpendingIncome {
  const DAY = 86400000;
  const catById = new Map(categories.map(c => [c.id, c]));

  const resolveStreamName = (tx: FinanceTransaction): { streamName: string; kind: 'gamma' | 'venture' | 'other' } | null => {
    if (tx.amount <= 0 || tx.is_reimbursable || (tx as any).is_refund) return null;
    const cat = tx.category_id ? catById.get(tx.category_id) : undefined;
    const isExplicitIncome = cat?.type === 'income';
    if (!isExplicitIncome && isInternalTransferTx(tx)) return null;
    if (cat && cat.type !== 'income') return null;

    const catName = cat?.name?.trim() || '';
    const catLower = catName.toLowerCase();
    const text = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();

    if (
      (text.includes('gamma') && (!text.includes('gamma network') || Math.abs(baseAmt(tx)) >= 500)) ||
      catLower.includes('gamma') ||
      catLower.includes('salary')
    ) {
      return { streamName: 'Gamma Salary', kind: 'gamma' };
    }
    if (
      text.includes('venture') ||
      text.includes('batchbase') ||
      text.includes('batch base') ||
      text.includes('advisory') ||
      catLower.includes('venture') ||
      catLower.includes('batchbase') ||
      catLower.includes('advisory')
    ) {
      return { streamName: 'Venture Advisory', kind: 'venture' };
    }
    if (text.includes('back pocket') || text.includes('bpg') || catLower.includes('back pocket')) {
      return { streamName: 'Back Pocket Games', kind: 'other' };
    }
    if (text.includes('eleven') || text.includes('11labs') || catLower.includes('eleven')) {
      return { streamName: 'ElevenLabs', kind: 'other' };
    }
    if (text.includes('etsy') || catLower.includes('etsy')) {
      return { streamName: 'Etsy', kind: 'other' };
    }

    if (isExplicitIncome) {
      // Generic unsorted "Income" category is ignored until tagged to a specific stream
      if (catLower === 'income') return null;
      return { streamName: catName, kind: 'other' };
    }

    return null;
  };

  const { cleaned: dedupedTxs } = deduplicateTransactions(transactions);
  const allClassified = dedupedTxs
    .map(tx => {
      const info = resolveStreamName(tx);
      return info ? { tx, ...info, date: parseUkDate(tx.posted_at) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const curMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  let monthItems = allClassified.filter(x => x.date >= curMonthStart && x.date <= curMonthEnd);
  let isLate = false;
  let cycleStart = curMonthStart;
  let cycleEnd = curMonthEnd;
  let nextPayday = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  // If no Gamma pay has landed yet this month (e.g. in November when November's payday was Oct 29),
  // carry forward the previous month's latest Gamma paycheck + any deposits since that payday,
  // while keeping all current-month Venture & side-income deposits.
  const hasCurrentMonthGamma = monthItems.some(x => x.kind === 'gamma' && baseAmt(x.tx) >= 1000);
  if (!hasCurrentMonthGamma) {
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const prevItems = allClassified.filter(x => x.date >= prevMonthStart && x.date <= prevMonthEnd);
    const prevGammaItems = prevItems
      .filter(x => x.kind === 'gamma' && baseAmt(x.tx) >= 1000)
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    if (prevGammaItems.length > 0) {
      const latestPrevGamma = prevGammaItems[0];
      // If previous month's Gamma salary landed on/after the 24th (funding current month),
      // combine that paycheck (and any post-payday items) with current month's deposits
      if (latestPrevGamma.date.getDate() >= 24) {
        const postPaydayPrevItems = prevItems.filter(
          x => x.tx.id === latestPrevGamma.tx.id || (x.kind !== 'gamma' && x.date > latestPrevGamma.date)
        );
        monthItems = [...postPaydayPrevItems, ...monthItems];
        cycleStart = latestPrevGamma.date;
      } else {
        monthItems = prevItems;
        isLate = true;
        cycleStart = prevMonthStart;
        cycleEnd = prevMonthEnd;
        nextPayday = new Date(now.getFullYear(), now.getMonth(), 0);
      }
    }
  }

  // If a late-month Gamma salary (>= 24th, e.g. Oct 29 for November) has landed in the current month,
  // it starts the new pay cycle: exclude earlier deposits from Oct 1–28 so old October income
  // (+£1,000) doesn't get added on top of the new November paycheck and inflate Fun Money.
  const gammaSalaryItems = monthItems
    .filter(x => x.kind === 'gamma' && baseAmt(x.tx) >= 1000)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  if (gammaSalaryItems.length > 0) {
    const latestGamma = gammaSalaryItems[0];
    if (latestGamma.date.getDate() >= 24) {
      cycleStart = latestGamma.date;
      monthItems = monthItems.filter(
        x => x.tx.id === latestGamma.tx.id || (x.kind !== 'gamma' && x.date > latestGamma.date)
      );
    } else if (gammaSalaryItems.length > 1) {
      const keepGammaTxId = latestGamma.tx.id;
      monthItems = monthItems.filter(
        x => !(x.kind === 'gamma' && baseAmt(x.tx) >= 1000 && x.tx.id !== keepGammaTxId)
      );
    }
  }

  let gamma = 0;
  let gammaDate: Date | null = null;
  let venture = 0;
  const streamMap = new Map<string, { amount: number; count: number }>();

  const refWeekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const lastWeekStartOfMonth = startOfWeek(cycleEnd, { weekStartsOn: 1 });
  const otherItems: OtherIncomeItem[] = [];
  let otherWeeklyBonus = 0;

  for (const item of monthItems) {
    const amt = baseAmt(item.tx);
    if (item.kind === 'gamma') {
      gamma += amt;
      if (!gammaDate || item.date > gammaDate) gammaDate = item.date;
    } else if (item.kind === 'venture') {
      venture += amt;
    } else if (item.kind === 'other') {
      // Only include extra side-income payments that have landed on or before the week being viewed,
      // and divide each payment by the number of weeks left in the month from the week it landed.
      if (item.date <= refWeekEnd) {
        const txWeekStart = startOfWeek(item.date, { weekStartsOn: 1 });
        const weeksSpread = Math.max(
          1,
          Math.round((lastWeekStartOfMonth.getTime() - txWeekStart.getTime()) / (7 * DAY)) + 1
        );
        const perWeek = amt / weeksSpread;
        otherWeeklyBonus += perWeek;
        otherItems.push({
          name: item.streamName || item.tx.merchant || item.tx.description || 'Extra income',
          amount: amt,
          date: item.date,
          weeksSpread,
          perWeek,
        });
      }
    }

    // Track streams that have landed up to the viewed week (or all baseline streams)
    if (item.kind !== 'other' || item.date <= refWeekEnd) {
      const existing = streamMap.get(item.streamName) || { amount: 0, count: 0 };
      existing.amount += amt;
      existing.count += 1;
      streamMap.set(item.streamName, existing);
    }
  }

  // Baseline monthly income for the waterfall (Fixed Bills -> Variable Essentials -> Saving Goals -> Base Fun)
  // is strictly Gamma Salary + Venture Advisory. Extra side income is paced weekly via otherWeeklyBonus.
  const total = gamma + venture;

  const streams: IncomeStreamBreakdownItem[] = Array.from(streamMap.entries())
    .map(([name, data]) => ({ name, amount: data.amount, count: data.count }))
    .sort((a, b) => b.amount - a.amount);

  return {
    total,
    gamma,
    gammaDate,
    cycleStart,
    nextPayday,
    isLate,
    venture,
    ventureLast4Weeks: venture,
    otherWeeklyBonus,
    otherItems,
    streams,
  };
}

export interface PolicySnapshot {
  // Totals
  totalLiquidCash: number;
  emergencyFloor: number;
  totalGoalAllocations: number;
  livingPool: number;
  targetSavings: number;
  spendablePool: number;

  // Drawdown
  isDrawdownMode: boolean;
  weeksUntilIncome: number;
  weeklyGross: number;
  weeklyFixedCosts: number;
  weeklyEssentialBudget: number;
  baseWeeklyFun: number;

  // Weekly adjustments
  boostAmount: number;
  rollover: number;
  essentialSpentThisWeek: number;
  essentialOverspend: number;
  funOverspend: number;
  spentThisWeek: number;
  remainingEssentials: number;
  remainingWeeklyFun: number;

  // Derived
  availableSavings: number;
  bufferMonths: number;
  currentBufferMonths: number;
  computedEssentialVariable: number;
  survivalCostMonthly: number;
  emergencySurvivalMonthly: number;

  // Rolling average metadata
  normalWeeksUsed: number;
  excludedWeeksCount: number;

  // Runway projection
  projectedEndBalance: number;
  actualWeeklyBurn: number;
  totalWeeklyBurn: number;
  runwayWeeks: number;
  runwayWithEmergencyWeeks: number;
  incomeStartDate: Date | null;
  weeksUntilIncomeStart: number | null;

  // Carry-forward debt
  carryForwardDebt: number;

  // Travel mode (aggregated across all trips)
  isTravelWeek: boolean;
  activeTrip: FinanceTrip | null;
  upcomingTrips: FinanceTrip[];
  // Legacy single-window compat (derived from active trip when present)
  travelStartDate: Date | null;
  travelEndDate: Date | null;
  travelPoolAmount: number;
  travelPoolSpent: number;
  travelPoolRemaining: number;

  // Legacy compat
  weeklyFunBudget: number;
  baseBudgetBeforeRollover: number;
  split: MoneySplit;
}

/** @deprecated single-trip helper kept for backwards compat — always returns false */
export function isDateInTravelWindow(_date: Date, _assumptions: FinanceAssumptions): boolean {
  return false;
}

/** @deprecated use computeTripSpent(transactions, tripId) instead */
export function computeTravelPoolSpent(
  _transactions: FinanceTransaction[],
  _assumptions: FinanceAssumptions,
): number {
  return 0;
}

/** Compute rolling average of essential spending over last N normal weeks, returned as monthly */
export function computeEssentialVariableMonthly(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  weekTypeMap?: Map<string, WeekType>,
  trips: FinanceTrip[] = [],
  referenceDate: Date = new Date(),
): { monthly: number; normalWeeksUsed: number; excludedWeeksCount: number } {
  const now = startOfWeek(referenceDate, { weekStartsOn: 1 });
  const catMap = new Map(categories.map(c => [c.id, c]));
  const essentialCatIds = new Set(
    categories
      .filter(c => c.is_essential && c.type === 'variable')
      .map(c => c.id),
  );

  if (essentialCatIds.size === 0) return { monthly: 0, normalWeeksUsed: 0, excludedWeeksCount: 0 };

  // Collect last 12 weeks of data prior to `now`, pick last 4 normal ones
  const weeklyTotals: { weekKey: string; total: number; isNormal: boolean }[] = [];
  let excludedCount = 0;

  for (let w = 1; w <= 12; w++) {
    const ws = startOfWeek(subWeeks(now, w), { weekStartsOn: 1 });
    const we = startOfWeek(subWeeks(now, w - 1), { weekStartsOn: 1 });
    const weekKey = format(ws, 'yyyy-MM-dd');
    const resolveWeekType = (key: string): WeekType => {
      if (!weekTypeMap) return 'normal';
      if (typeof (weekTypeMap as any).get === 'function') return (weekTypeMap as any).get(key) || 'normal';
      if (typeof (weekTypeMap as any) === 'function') {
        try {
          const map = (weekTypeMap as any)();
          return map?.get?.(key) || 'normal';
        } catch { return 'normal'; }
      }
      return 'normal';
    };
    const wType = resolveWeekType(weekKey);
    const overlapsExclusion = weekOverlapsExclusion(ws, we);
    const overlapsTrip = trips.some(t => {
      if (!t.start_date || !t.end_date) return false;
      const ts = parseUkDate(t.start_date);
      const te = parseUkDate(t.end_date);
      return ws < te && we > ts;
    });

    const isNormal = wType === 'normal' && !overlapsExclusion && !overlapsTrip;
    if (!isNormal) excludedCount++;

    let weekTotal = 0;
    for (const tx of transactions) {
      if (tx.is_transfer || tx.is_reimbursable || tx.is_fixed || (tx as any).fixed_expense_id) continue;
      if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed' || isInternalTransferTx(tx)) continue;
      if ((tx as any).goal_id || (tx as any).is_travel_spend || (tx as any).trip_id) continue;
      if (!tx.category_id || !essentialCatIds.has(tx.category_id)) continue;
      const cat = catMap.get(tx.category_id);
      if (cat?.exclude_from_reports || cat?.type === 'fixed' || cat?.type === 'income' || cat?.type === 'transfer') continue;
      const d = parseUkDate(tx.posted_at);
      if (isExcludedSpendDate(d)) continue;
      if (isInAnyTrip(d, trips)) continue; // Auto-exclude transactions on trip dates
      if (d >= ws && d < we) {
        if ((tx as any).is_refund && tx.amount > 0) {
          weekTotal -= Math.abs(baseAmt(tx));
        } else if (tx.amount < 0) {
          weekTotal += Math.abs(baseAmt(tx));
        }
      }
    }
    weeklyTotals.push({ weekKey, total: Math.max(0, weekTotal), isNormal });
  }

  const normalWeeks = weeklyTotals.filter(w => w.isNormal);
  const last4Normal = normalWeeks.slice(0, 4);
  
  if (last4Normal.length === 0) return { monthly: 0, normalWeeksUsed: 0, excludedWeeksCount: excludedCount };

  const weeklyAvg = last4Normal.reduce((s, w) => s + w.total, 0) / last4Normal.length;
  return { monthly: weeklyAvg * 4.33, normalWeeksUsed: last4Normal.length, excludedWeeksCount: excludedCount };
}

export function computePolicySnapshot(
  assumptions: FinanceAssumptions,
  accounts: FinanceAccount[],
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  goals: FinanceGoal[],
  convertToBase: (amount: number, currency: string) => number,
  fixedExpensesMonthly?: number,
  weeklyBoostAmount?: number,
  weekTypeMap?: Map<string, WeekType>,
  trips: FinanceTrip[] = [],
  fixedExpensesMonthlyAll?: number,
  referenceDate: Date = new Date(),
): PolicySnapshot {
  const now = referenceDate;
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  // Essential variable: rolling average of normal weeks prior to the reference week
  const essentialResult = computeEssentialVariableMonthly(transactions, categories, weekTypeMap, trips, weekStart);
  const computedEssentialVariable = essentialResult.monthly;
  // Use the higher of manual estimate or computed actual
  const essentialVariable = Math.max(
    assumptions.estimated_essential_variable ?? 0,
    computedEssentialVariable,
  );
  
  // Survival cost = actual fixed bills + essential variable (pools use Up-only bills)
  const fixedMonthly = fixedExpensesMonthly ?? 0;
  const survivalCostMonthly = fixedMonthly + essentialVariable;
  // Emergency floor should cover ALL bills you must pay if income stops —
  // including rent even if it's currently paid from an external account.
  const emergencySurvivalMonthly = (fixedExpensesMonthlyAll ?? fixedMonthly) + essentialVariable;
  const emergencyFloor = emergencySurvivalMonthly * assumptions.buffer_months * 1.2; // 20% contingency
  
  const totalLiquidCash = accounts
    .filter(acc => !(acc as any).exclude_from_totals)
    .reduce((sum, acc) => sum + convertToBase(acc.balance, acc.currency), 0);
  const availableSavings = Math.max(totalLiquidCash - emergencyFloor, 0);
  // assigned_amount already reflects deductions made by handlePoolAssign,
  // so we just sum non-emergency goal pots directly — emergency reserve is tracked via emergencyFloor.
  const isEmergencyGoal = (g: FinanceGoal) =>
    (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency');
  const totalGoalAllocations = goals
    .filter(g => !isEmergencyGoal(g))
    .reduce((s, g) => s + convertToBase(g.assigned_amount || 0, g.currency), 0);

  // Target savings
  const targetSavings = assumptions.target_savings ?? 0;

  // Determine drawdown mode
  // Spending income = REAL Gamma + Venture deposits that hit the account this calendar month.
  // If no Gamma pay has landed yet this month, use last month's Gamma + Venture deposits.
  const actualIncome = computeActualSpendingIncome(transactions, categories, now);
  const monthlyIncome = actualIncome.total;
  const isDrawdownMode = monthlyIncome === 0;

  // Core pools
  const livingPool = Math.max(0, totalLiquidCash - emergencyFloor - totalGoalAllocations);
  const spendablePool = Math.max(0, livingPool - targetSavings);

  let weeklyGross = 0;
  let weeksUntilIncome = 0;
  let weeklyFixedCosts = fixedMonthly / 4.33;
  let weeklyEssentialBudget = essentialVariable / 4.33;
  let baseWeeklyFun = 0;
  let split: MoneySplit;

  if (isDrawdownMode) {
    // Fun money is the user-configured weekly amount (default $100/wk)
    baseWeeklyFun = assumptions.weekly_fun_budget > 0 ? assumptions.weekly_fun_budget : 100;
    // Calculate required goal savings even in drawdown mode so active goals with deadlines are not zeroed out
    const drawdownGoalSavings = computeRequiredGoalSavingsMonthly(goals, convertToBase, weekStart, 0);
    // Weekly gross = all weekly costs combined
    weeklyGross = weeklyFixedCosts + weeklyEssentialBudget + (drawdownGoalSavings / 4.33) + baseWeeklyFun;
    // Runway-based weeks (how long living pool lasts at this burn rate)
    weeksUntilIncome = weeklyGross > 0 ? spendablePool / weeklyGross : 0;

    split = {
      mandatoryPercent: 0, mandatoryAmount: fixedMonthly,
      baseSavingsPercent: 0, baseSavingsAmount: 0,
      goalSavingsPercent: 0, goalSavingsAmount: drawdownGoalSavings,
      funPercent: 100, funAmount: baseWeeklyFun * 4.33,
      weeklyFunAmount: baseWeeklyFun,
      monthlyIncome: 0,
    };
  } else {
    split = computeMoneySplit(
      assumptions,
      transactions,
      categories,
      goals,
      convertToBase,
      fixedExpensesMonthlyAll ?? fixedMonthly,
      monthlyIncome,
      weekTypeMap,
      trips,
      weekStart,
    );
    baseWeeklyFun = split.weeklyFunAmount;
    weeklyGross = split.monthlyIncome / 4.33;
  }

  // Apply weekly boost
  const boostAmount = weeklyBoostAmount ?? 0;
  let weeklyFunBudget = baseWeeklyFun + boostAmount + (!isDrawdownMode ? actualIncome.otherWeeklyBonus : 0);

  const spentThisWeek = computeWeeklyFunSpend(transactions, categories, weekStart, undefined, trips);

  // ===== Travel mode (multi-trip union) =====
  const activeTrip = getActiveTripOn(now, trips);
  const isTravelWeek = activeTrip !== null;
  const upcomingTrips = trips
    .filter(t => t.start_date && t.end_date && new Date(t.end_date) >= now)
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

  // Active-trip pool numbers (for legacy fields)
  const activeGoal = activeTrip?.goal_id ? goals.find(g => g.id === activeTrip.goal_id) : null;
  const travelPoolAmount = activeGoal?.assigned_amount || 0;
  const travelPoolSpent = activeTrip ? computeTripSpent(transactions, activeTrip.id, activeTrip.start_date, activeTrip.end_date) : 0;
  const travelPoolRemaining = Math.max(0, travelPoolAmount - travelPoolSpent);
  const travelStartDate = activeTrip?.start_date ? new Date(activeTrip.start_date) : null;
  const travelEndDate = activeTrip?.end_date ? new Date(activeTrip.end_date) : null;

  if (isTravelWeek) {
    // While traveling: no essentials/fun budget, only fixed bills run
    weeklyEssentialBudget = 0;
    baseWeeklyFun = 0;
    weeklyFunBudget = 0;
  }

  // Last week performance & overspend deduction
  const lastWeekStart = subWeeks(weekStart, 1);
  const lastWeekFunSpent = computeWeeklyFunSpend(transactions, categories, lastWeekStart, weekStart, trips);
  const lastWeekEssentialSpent = computeWeeklyEssentialSpend(transactions, categories, lastWeekStart, weekStart, trips);
  const lastWeekOverspend = Math.max(
    0,
    (lastWeekEssentialSpent + lastWeekFunSpent) - (weeklyEssentialBudget + baseWeeklyFun),
  );

  // Carry-forward debt: only applies to the week matching assumptions.last_debt_week,
  // or to the current active week before auto-settle runs. Never retroactively deduct from past weeks!
  const currentWeekKey = format(weekStart, 'yyyy-MM-dd');
  const todayWeekKey = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const isViewingCurrentWeek = currentWeekKey === todayWeekKey;
  const debtAppliesThisWeek = assumptions.last_debt_week === currentWeekKey;
  const storedDebt = debtAppliesThisWeek ? (assumptions.carry_forward_debt ?? 0) : 0;
  const carryForwardDebt = debtAppliesThisWeek
    ? storedDebt
    : (isViewingCurrentWeek ? lastWeekOverspend : 0);
  const effectiveDebt = !isTravelWeek ? carryForwardDebt : 0;

  // Deduct last week's overspend from this week's fun budget
  weeklyFunBudget = Math.max(0, weeklyFunBudget - effectiveDebt);

  // Underspent rollover is NOT added to weeklyFunBudget (it is swept into Savings Stash by auto-settle)
  const rollover = Math.max(0, (weeklyEssentialBudget + baseWeeklyFun) - (lastWeekEssentialSpent + lastWeekFunSpent));

  // Bidirectional overspend: each category's excess eats into the other
  const essentialSpentThisWeek = computeWeeklyEssentialSpend(transactions, categories, weekStart, undefined, trips);
  const essentialOverspend = Math.max(0, essentialSpentThisWeek - weeklyEssentialBudget);
  const funOverspend = Math.max(0, spentThisWeek - weeklyFunBudget);

  // Remaining fun = budget - spent - essential overspend (clamped to 0)
  const remainingWeeklyFun = weeklyFunBudget - spentThisWeek - essentialOverspend;
  // Remaining essentials = budget - spent - fun overspend
  const remainingEssentials = weeklyEssentialBudget - essentialSpentThisWeek - funOverspend;

  const currentBufferMonths = emergencySurvivalMonthly > 0 ? totalLiquidCash / emergencySurvivalMonthly : Infinity;

  // Runway projection: piecewise across the union of all trip windows
  const fullWeeklyBurn = weeklyFixedCosts + weeklyEssentialBudget + baseWeeklyFun;
  const fixedOnlyBurn = weeklyFixedCosts;
  const totalWeeklyBurn = isTravelWeek ? fixedOnlyBurn : fullWeeklyBurn;

  // Total weeks remaining across ALL future/active trip windows
  const travelWeeksRemaining = computeRemainingTripWeeks(now, trips);

  // Actual spend pace: rolling 4-week average of ALL real spend (fixed+essential+fun)
  const rollingActualWeeklySpend = computeRollingWeeklySpend(transactions, categories, weekStart, 4);

  // This-week pace (annualized)
  const dayOfWeek = Math.max(1, (now.getDay() || 7)); // 1=Mon, 7=Sun
  const fractionOfWeekElapsed = Math.max(0.15, dayOfWeek / 7);
    const thisWeekVariablePace = (spentThisWeek + essentialSpentThisWeek) / fractionOfWeekElapsed;
    const thisWeekPace = thisWeekVariablePace + weeklyFixedCosts;

  // Blend rolling average with this week's pace (more weight to rolling for stability)
  const actualWeeklyBurn = rollingActualWeeklySpend > 0
    ? rollingActualWeeklySpend * 0.7 + thisWeekPace * 0.3
    : thisWeekPace;

  const burnForProjection = Math.max(totalWeeklyBurn, actualWeeklyBurn);

  // Weeks until income kicks in (job start). If no job start set, fall back to
  // the pool-derived weeksUntilIncome so downstream math still works.
  const incomeStartDate = assumptions.income_start_date ? new Date(assumptions.income_start_date) : null;
  const weeksUntilIncomeStart = incomeStartDate
    ? Math.max(0, (incomeStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 7))
    : null;

  // Project ending balance at the moment income actually starts (not when the
  // spendable pool runs dry — that's runway, a different question).
  const projectionWeeks = weeksUntilIncomeStart ?? weeksUntilIncome;
  const projectedEndBalance = isDrawdownMode
    ? totalLiquidCash - (burnForProjection * projectionWeeks)
    : totalLiquidCash;

  // Runway: includes Emergency Reserve + unallocated cash, strictly excluding all
  // non-emergency savings pots (Euro pot, Xmas & Gifts, etc.).
  // Uses survival burn (fixed bills + essentials, with travel weeks burning fixed-only).
  const runwayCash = Math.max(0, totalLiquidCash - totalGoalAllocations);
  const survivalWeeklyBurn = weeklyFixedCosts + (essentialVariable / 4.33);
  let runwayWeeks: number;
  if (travelWeeksRemaining > 0 && survivalWeeklyBurn > 0) {
    const travelPhaseSpend = travelWeeksRemaining * fixedOnlyBurn;
    if (runwayCash <= travelPhaseSpend) {
      runwayWeeks = fixedOnlyBurn > 0 ? runwayCash / fixedOnlyBurn : 0;
    } else {
      const remainder = runwayCash - travelPhaseSpend;
      runwayWeeks = travelWeeksRemaining + (remainder / survivalWeeklyBurn);
    }
  } else {
    const effectiveBurn = Math.max(survivalWeeklyBurn, 1);
    runwayWeeks = runwayCash / effectiveBurn;
  }

  const runwayWithEmergencyWeeks = runwayWeeks;


  return {
    totalLiquidCash,
    emergencyFloor,
    totalGoalAllocations,
    livingPool,
    targetSavings,
    spendablePool,
    isDrawdownMode,
    weeksUntilIncome,
    weeklyGross,
    weeklyFixedCosts,
    weeklyEssentialBudget,
    baseWeeklyFun,
    boostAmount,
    rollover,
    essentialSpentThisWeek,
    essentialOverspend,
    funOverspend,
    spentThisWeek,
    remainingWeeklyFun,
    remainingEssentials,
    availableSavings,
    bufferMonths: assumptions.buffer_months,
    currentBufferMonths: isFinite(currentBufferMonths) ? currentBufferMonths : 999,
    computedEssentialVariable,
    survivalCostMonthly,
    emergencySurvivalMonthly,
    normalWeeksUsed: essentialResult.normalWeeksUsed,
    excludedWeeksCount: essentialResult.excludedWeeksCount,
    projectedEndBalance,
    actualWeeklyBurn,
    totalWeeklyBurn,
    runwayWeeks,
    runwayWithEmergencyWeeks,
    incomeStartDate,
    weeksUntilIncomeStart,
    carryForwardDebt: effectiveDebt,
    isTravelWeek,
    activeTrip,
    upcomingTrips,
    travelStartDate,
    travelEndDate,
    travelPoolAmount,
    travelPoolSpent,
    travelPoolRemaining,
    // Legacy compat
    weeklyFunBudget,
    baseBudgetBeforeRollover: baseWeeklyFun + boostAmount,
    split,
  };
}

// ---- Decision Engine ----

export type DecisionVerdict = 'yes' | 'yes_savings' | 'not_recommended' | 'hard_no';

export interface DecisionResult {
  verdict: DecisionVerdict;
  amountFromWeeklyFun: number;
  amountFromSavings: number;
  remainingWeeklyFunAfter: number;
  emergencyMonthsAfter: number;
  breaksEmergencyFloor: boolean;
  newWeeklyBudget?: number;
}

export function evaluateExpense(
  snapshot: PolicySnapshot,
  expense: number,
  allowSavings: boolean,
  monthlySurvivalCost: number,
): DecisionResult {
  const cashAfter = snapshot.totalLiquidCash - expense;
  const emergencyMonthsAfter = monthlySurvivalCost > 0
    ? cashAfter / monthlySurvivalCost
    : Infinity;
  const breaksEmergencyFloor = cashAfter < snapshot.emergencyFloor;

  let newWeeklyBudget: number | undefined;
  if (snapshot.isDrawdownMode && snapshot.weeksUntilIncome > 0) {
    const newSpendablePool = Math.max(0, snapshot.spendablePool - expense);
    newWeeklyBudget = newSpendablePool / snapshot.weeksUntilIncome;
  }

  if (expense <= snapshot.remainingWeeklyFun) {
    return {
      verdict: 'yes',
      amountFromWeeklyFun: expense,
      amountFromSavings: 0,
      remainingWeeklyFunAfter: snapshot.remainingWeeklyFun - expense,
      emergencyMonthsAfter: isFinite(emergencyMonthsAfter) ? emergencyMonthsAfter : 999,
      breaksEmergencyFloor,
      newWeeklyBudget,
    };
  }

  if (
    allowSavings &&
    expense <= (snapshot.remainingWeeklyFun + snapshot.availableSavings) &&
    !breaksEmergencyFloor
  ) {
    const fromFun = snapshot.remainingWeeklyFun;
    const fromSavings = expense - fromFun;
    return {
      verdict: 'yes_savings',
      amountFromWeeklyFun: fromFun,
      amountFromSavings: fromSavings,
      remainingWeeklyFunAfter: 0,
      emergencyMonthsAfter: isFinite(emergencyMonthsAfter) ? emergencyMonthsAfter : 999,
      breaksEmergencyFloor,
      newWeeklyBudget,
    };
  }

  if (breaksEmergencyFloor) {
    return {
      verdict: 'hard_no',
      amountFromWeeklyFun: 0,
      amountFromSavings: 0,
      remainingWeeklyFunAfter: snapshot.remainingWeeklyFun,
      emergencyMonthsAfter: isFinite(emergencyMonthsAfter) ? emergencyMonthsAfter : 999,
      breaksEmergencyFloor: true,
      newWeeklyBudget,
    };
  }

  return {
    verdict: 'not_recommended',
    amountFromWeeklyFun: 0,
    amountFromSavings: 0,
    remainingWeeklyFunAfter: snapshot.remainingWeeklyFun,
    emergencyMonthsAfter: isFinite(emergencyMonthsAfter) ? emergencyMonthsAfter : 999,
    breaksEmergencyFloor,
    newWeeklyBudget,
  };
}

// ---- Money Split Engine ----

export interface MoneySplit {
  mandatoryPercent: number;
  mandatoryAmount: number;
  baseSavingsPercent: number;
  baseSavingsAmount: number;
  goalSavingsPercent: number;
  goalSavingsAmount: number;
  funPercent: number;
  funAmount: number;
  weeklyFunAmount: number;
  monthlyIncome: number;
}

/**
 * Calculates the required monthly savings across all active goals/pools with deadlines or percentages.
 */
export function computeRequiredGoalSavingsMonthly(
  goals: FinanceGoal[],
  convertToBase: (amount: number, currency: string) => number,
  now: Date = new Date(),
  monthlyIncome: number = 0,
): number {
  const anchorNow = startOfWeek(now, { weekStartsOn: 1 });
  let poolSavingsMonthly = 0;
  for (const g of (goals || [])) {
    if ((g as any)?.is_stash || (g.name || '').toLowerCase().includes('stash')) continue;
    if ((g as any)?.is_emergency === true || (g.name || '').toLowerCase().includes('emergency')) continue;
    if (g.start_date && new Date(g.start_date) > anchorNow) continue;
    const targetBase = convertToBase ? convertToBase(g.target_amount || 0, g.currency) : (g.target_amount || 0);
    const assignedBase = convertToBase ? convertToBase(g.assigned_amount || 0, g.currency) : (g.assigned_amount || 0);
    const remainingBase = Math.max(0, targetBase - assignedBase);

    // Rule: If pot has reached or exceeded target amount, it receives £0.00 even if deadline is upcoming
    if (remainingBase <= 0.01) continue;

    if (g.deadline) {
      const dl = new Date(g.deadline);
      const daysLeft = Math.max(1, Math.ceil((dl.getTime() - anchorNow.getTime()) / (1000 * 60 * 60 * 24)));
      const weeksLeft = Math.max(1, daysLeft / 7);
      // Cap monthly requirement at remainingBase (matching MonthlyPotPlanner & paycheckEngine)
      // so a goal with <4.33 weeks left never deducts up to 4.33x its remaining balance in a single month
      const monthlyTarget = Math.min(remainingBase, (remainingBase / weeksLeft) * 4.33);
      poolSavingsMonthly += monthlyTarget;
    } else if (g.percent_allocation && g.percent_allocation > 0 && monthlyIncome > 0) {
      poolSavingsMonthly += Math.min(remainingBase, (g.percent_allocation / 100) * monthlyIncome);
    }
  }
  return poolSavingsMonthly;
}

export function computeMoneySplit(
  assumptions: FinanceAssumptions,
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  goals: FinanceGoal[],
  convertToBase: (amount: number, currency: string) => number,
  fixedExpensesMonthly?: number,
  overrideMonthlyIncome?: number,
  weekTypeMap?: Map<string, WeekType>,
  trips: FinanceTrip[] = [],
  referenceDate: Date = new Date(),
): MoneySplit {
  const now = startOfWeek(referenceDate, { weekStartsOn: 1 });

  // 1. Calculate effective net monthly income (Net Salary via PAYE Tax/NI + Venture Advisory £70/wk)
  const salaryTakeHome = calcTakeHome({
    grossAnnual: assumptions.gross_annual_salary || 0,
    pensionPercent: assumptions.pension_percent || 0,
    studentLoanPlan: null, // Gabriella has no student loan
  }).netMonthly;
  const ventureSideMonthly = (70 * 52) / 12; // ~£303.33/mo
  const baseNetIncome = salaryTakeHome > 0 ? salaryTakeHome + ventureSideMonthly : 0;
  void baseNetIncome;
  
  const monthlyIncome = (overrideMonthlyIncome && overrideMonthlyIncome > 0)
    ? overrideMonthlyIncome
    : computeActualSpendingIncome(transactions, categories, referenceDate).total;

  // 2. Committed fixed bills (use passed fixed expenses if provided, else historic average)
  let monthlyMandatory = fixedExpensesMonthly ?? 0;
  if (!fixedExpensesMonthly) {
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const mandatoryCategories = categories.filter(c => c.type === 'fixed');
    const mandatoryCatIds = new Set(mandatoryCategories.map(c => c.id));
    let mandatorySpend = 0;
    const relevantTxs = transactions.filter(tx => {
      const d = parseUkDate(tx.posted_at);
      return d >= threeMonthsAgo && d <= referenceDate;
    });
    for (const tx of relevantTxs) {
      if (tx.is_transfer || tx.is_reimbursable) continue;
      if (tx.amount < 0 && (tx.is_fixed || (tx as any).fixed_expense_id || (tx.category_id && mandatoryCatIds.has(tx.category_id)))) {
        mandatorySpend += Math.abs(baseAmt(tx));
      }
    }
    const daysCovered = Math.max(1, (referenceDate.getTime() - threeMonthsAgo.getTime()) / (1000 * 60 * 60 * 24));
    monthlyMandatory = mandatorySpend / (daysCovered / 30.44);
  }

  const effectiveIncome = monthlyIncome;
  const mandatoryPercent = effectiveIncome > 0 ? (monthlyMandatory / effectiveIncome) * 100 : 0;

  // 3. Essential variable spending (using same weekTypeMap, trips, and referenceDate as computePolicySnapshot)
  const essentialResult = computeEssentialVariableMonthly(transactions, categories, weekTypeMap, trips, now);
  const essentialVariable = Math.max(
    assumptions.estimated_essential_variable ?? 0,
    essentialResult.monthly,
  );

  // 4. Goal pool savings requirements
  const poolSavingsMonthly = computeRequiredGoalSavingsMonthly(goals, convertToBase, now, effectiveIncome);

  const goalSavingsAmount = poolSavingsMonthly;
  const goalSavingsPercent = effectiveIncome > 0 ? (goalSavingsAmount / effectiveIncome) * 100 : 0;

  // 5. Fun Money = Genuine Leftover (Income - Fixed Bills - Essential Living - Pool Savings)
  const calculatedFunMonthly = Math.max(0, effectiveIncome - monthlyMandatory - essentialVariable - goalSavingsAmount);
  
  // Strictly enforce true dynamic cashflow leftover so that 100% of savings goals and bills are protected first
  const weeklyFunAmount = calculatedFunMonthly / 4.33;

  const funAmount = weeklyFunAmount * 4.33;
  const funPercent = effectiveIncome > 0 ? (funAmount / effectiveIncome) * 100 : 0;

  return {
    mandatoryPercent,
    mandatoryAmount: monthlyMandatory,
    baseSavingsPercent: 0,
    baseSavingsAmount: 0,
    goalSavingsPercent,
    goalSavingsAmount,
    funPercent,
    funAmount,
    weeklyFunAmount,
    monthlyIncome: effectiveIncome,
  };
}

// ---- Helpers ----

export interface WeekVariableSpendSummary {
  essentialSpent: number;
  funSpent: number;
  totalSpent: number;
  daily: { essential: number; fun: number; total: number }[];
  byCategory: Map<string, number>;
  txns: FinanceTransaction[];
}

/**
 * Single source of truth for variable spending in any Monday–Sunday week.
 * Used across Home, Weekly Budget, Spending History, Monday Weekly Review, and Policy Engine.
 */
export function computeWeekVariableSpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  weekStartInput: Date,
  trips: FinanceTrip[] = [],
): WeekVariableSpendSummary {
  const ws = startOfWeek(weekStartInput, { weekStartsOn: 1 });
  const we = endOfWeek(ws, { weekStartsOn: 1 });
  const catMap = new Map(categories.map(c => [c.id, c]));
  const essentialCatIds = new Set(
    categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id),
  );

  let essentialSpent = 0;
  let funSpent = 0;
  const daily = Array.from({ length: 7 }, () => ({ essential: 0, fun: 0, total: 0 }));
  const byCategory = new Map<string, number>();
  const matchedTxns: FinanceTransaction[] = [];

  // Filter out any settlement duplicates (Amazon, weekend-to-Monday clearing, same-day double records)
  const { cleaned: dedupedTxs } = deduplicateTransactions(txs);

  for (const tx of dedupedTxs) {
    if (tx.is_transfer || tx.is_reimbursable || tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
    if (isInternalTransferTx(tx)) continue;
    if ((tx as any).goal_id) continue;
    if ((tx as any).is_travel_spend || (tx as any).trip_id) continue;
    if (tx.is_fixed || (tx as any).fixed_expense_id) continue;

    const catId = tx.category_id || '__uncategorised';
    const cat = catMap.get(catId);
    if (cat?.exclude_from_reports) continue;
    if (cat?.type === 'transfer' || cat?.type === 'fixed' || cat?.type === 'income') continue;

    const d = parseUkDate(tx.posted_at);
    if (d < ws || d > we) continue;
    if (isInAnyTrip(d, trips)) continue;

    const isEssential = essentialCatIds.has(catId);
    const dayIdx = Math.min(6, Math.max(0, differenceInCalendarDays(d, ws)));
    const amt = Math.abs(baseAmt(tx));

    if ((tx as any).is_refund && tx.amount > 0) {
      if (isEssential) {
        essentialSpent -= amt;
        daily[dayIdx].essential = Math.max(0, daily[dayIdx].essential - amt);
      } else {
        funSpent -= amt;
        daily[dayIdx].fun = Math.max(0, daily[dayIdx].fun - amt);
      }
      daily[dayIdx].total = daily[dayIdx].essential + daily[dayIdx].fun;
      byCategory.set(catId, Math.max(0, (byCategory.get(catId) || 0) - amt));
      continue;
    }

    if (tx.amount >= 0) continue;

    if (isEssential) {
      essentialSpent += amt;
      daily[dayIdx].essential += amt;
    } else {
      funSpent += amt;
      daily[dayIdx].fun += amt;
    }
    daily[dayIdx].total = daily[dayIdx].essential + daily[dayIdx].fun;
    byCategory.set(catId, (byCategory.get(catId) || 0) + amt);
    matchedTxns.push(tx);
  }

  essentialSpent = Math.max(0, essentialSpent);
  funSpent = Math.max(0, funSpent);

  return {
    essentialSpent,
    funSpent,
    totalSpent: essentialSpent + funSpent,
    daily,
    byCategory,
    txns: matchedTxns,
  };
}

function computeWeeklyFunSpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  weekStart: Date,
  _weekEnd?: Date,
  trips: FinanceTrip[] = [],
): number {
  return computeWeekVariableSpend(txs, categories, weekStart, trips).funSpent;
}

function computeWeeklyEssentialSpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  weekStart: Date,
  _weekEnd?: Date,
  trips: FinanceTrip[] = [],
): number {
  return computeWeekVariableSpend(txs, categories, weekStart, trips).essentialSpent;
}

/** Compute rolling average weekly spend over last N complete weeks (ALL non-transfer spend) */
function computeRollingWeeklySpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  currentWeekStart: Date,
  weeksBack: number = 4,
  trips: FinanceTrip[] = [],
): number {
  const weeklyTotals: number[] = [];

  for (let w = 1; w <= weeksBack; w++) {
    const ws = startOfWeek(subWeeks(currentWeekStart, w), { weekStartsOn: 1 });
    const we = startOfWeek(subWeeks(currentWeekStart, w - 1), { weekStartsOn: 1 });

    // Skip weeks that overlap a hard-coded exclusion window or a trip window
    if (weekOverlapsExclusion(ws, we)) continue;
    const overlapsTrip = trips.some(t => {
      if (!t.start_date || !t.end_date) return false;
      const ts = parseUkDate(t.start_date);
      const te = parseUkDate(t.end_date);
      return ws < te && we > ts;
    });
    if (overlapsTrip) continue;

    let weekTotal = 0;
    for (const tx of txs) {
      if (tx.amount >= 0) continue;
      if (tx.is_transfer || tx.is_reimbursable || tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
      if ((tx as any).goal_id) continue;
      if ((tx as any).is_travel_spend || (tx as any).trip_id) continue;
      const cat = categories.find(c => c.id === tx.category_id);
      if (cat?.exclude_from_reports) continue;
      if (cat?.type === 'transfer') continue;
      const d = parseUkDate(tx.posted_at);
      if (isExcludedSpendDate(d)) continue;
      if (isInAnyTrip(d, trips)) continue;
      if (d >= ws && d < we) {
        weekTotal += Math.abs(baseAmt(tx));
      }
    }
    weeklyTotals.push(weekTotal);
  }

  if (weeklyTotals.length === 0) return 0;
  return weeklyTotals.reduce((s, v) => s + v, 0) / weeklyTotals.length;
}

