import { FinanceTransaction, FinanceCategory, FinanceAccount, FinanceGoal } from '@/hooks/useFinanceData';
import { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import { startOfWeek, subWeeks, format } from 'date-fns';
import type { WeekType } from '@/hooks/useWeekTypes';
import { isExcludedSpendDate, weekOverlapsExclusion, baseAmt } from './financeUtils';
import { calcTakeHome } from './ukTakeHome';


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

/** Sum of spend explicitly tagged to a specific trip (via trip_id).
 *  Untagged transactions that happen to fall within the trip's date window are NOT counted —
 *  users tag trip spend explicitly (bank tx assignment, Log trip expense, Bulk reconcile). */
export function computeTripSpent(
  transactions: FinanceTransaction[],
  tripId: string,
  _tripStart?: string | Date | null,
  _tripEnd?: string | Date | null,
): number {
  let total = 0;
  for (const tx of transactions) {
    if (tx.is_transfer || tx.is_reimbursable) continue;
    if (tx.amount >= 0) continue;
    if ((tx as any).trip_id !== tripId) continue;
    total += Math.abs(baseAmt(tx));
  }
  return total;
}

// ---- Core Policy Calculations ----

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
): { monthly: number; normalWeeksUsed: number; excludedWeeksCount: number } {
  const now = new Date();
  const essentialCatIds = new Set(
    categories
      .filter(c => c.is_essential && c.type === 'variable')
      .map(c => c.id),
  );

  if (essentialCatIds.size === 0) return { monthly: 0, normalWeeksUsed: 0, excludedWeeksCount: 0 };

  // Collect last 8 weeks of data, pick last 4 normal ones
  const weeklyTotals: { weekKey: string; total: number; isNormal: boolean }[] = [];
  let excludedCount = 0;

  for (let w = 1; w <= 12; w++) {
    const ws = startOfWeek(subWeeks(now, w), { weekStartsOn: 1 });
    const we = startOfWeek(subWeeks(now, w - 1), { weekStartsOn: 1 });
    const weekKey = format(ws, 'yyyy-MM-dd');
    const wType = weekTypeMap?.get(weekKey) || 'normal';
    const overlapsExclusion = weekOverlapsExclusion(ws, we);
    const isNormal = wType === 'normal' && !overlapsExclusion;
    if (!isNormal) excludedCount++;

    let weekTotal = 0;
    for (const tx of transactions) {
      if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) continue;
      if ((tx as any).is_travel_spend) continue;
      if (!tx.category_id || !essentialCatIds.has(tx.category_id)) continue;
      const d = new Date(tx.posted_at);
      if (isExcludedSpendDate(d)) continue;
      if (d >= ws && d < we) {
        weekTotal += Math.abs(baseAmt(tx));
      }
    }
    weeklyTotals.push({ weekKey, total: weekTotal, isNormal });

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
  // Essential variable: rolling average of normal weeks
  const essentialResult = computeEssentialVariableMonthly(transactions, categories, weekTypeMap);
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
  // so we just sum them directly — no need to subtract transactions again.
  const totalGoalAllocations = goals.reduce(
    (s, g) => s + convertToBase(g.assigned_amount || 0, g.currency),
    0,
  );

  // Target savings
  const targetSavings = assumptions.target_savings ?? 0;

  // Determine drawdown mode
  const now = referenceDate;
  const salaryTakeHome = calcTakeHome({
    grossAnnual: assumptions.gross_annual_salary || 0,
    pensionPercent: assumptions.pension_percent || 0,
    studentLoanPlan: assumptions.student_loan_plan as any,
  }).netMonthly;
  const monthlyIncome = assumptions.expected_monthly_income || salaryTakeHome || 0;
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
    // Weekly gross = all weekly costs combined
    weeklyGross = weeklyFixedCosts + weeklyEssentialBudget + baseWeeklyFun;
    // Runway-based weeks (how long living pool lasts at this burn rate)
    weeksUntilIncome = weeklyGross > 0 ? spendablePool / weeklyGross : 0;

    split = {
      mandatoryPercent: 0, mandatoryAmount: fixedMonthly,
      baseSavingsPercent: 0, baseSavingsAmount: 0,
      goalSavingsPercent: 0, goalSavingsAmount: 0,
      funPercent: 100, funAmount: baseWeeklyFun * 4.33,
      weeklyFunAmount: baseWeeklyFun,
      monthlyIncome: 0,
    };
  } else {
    split = computeMoneySplit(assumptions, transactions, categories, goals, convertToBase, fixedExpensesMonthlyAll ?? fixedMonthly);
    baseWeeklyFun = split.weeklyFunAmount;
    weeklyGross = split.monthlyIncome / 4.33;
  }

  // Apply weekly boost
  const boostAmount = weeklyBoostAmount ?? 0;
  let weeklyFunBudget = baseWeeklyFun + boostAmount;

  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const spentThisWeek = computeWeeklyFunSpend(transactions, categories, weekStart);

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

  // Carry-forward debt: deduct last week's overspend from this week's fun budget
  // Hard-capped at 100 (base currency) so a single bad week can't wipe out this week's allowance.
  const CARRY_FORWARD_CAP = 100;
  const carryForwardDebt = Math.min(assumptions.carry_forward_debt ?? 0, CARRY_FORWARD_CAP);
  const currentWeekKey = format(weekStart, 'yyyy-MM-dd');
  const debtAppliesThisWeek = assumptions.last_debt_week === currentWeekKey;
  const effectiveDebt = debtAppliesThisWeek && !isTravelWeek ? carryForwardDebt : 0;
  weeklyFunBudget = Math.max(0, weeklyFunBudget - effectiveDebt);

  // Rollover: disabled in drawdown mode (living pool already self-corrects)
  let rollover = 0;
  if (!isDrawdownMode) {
    const lastWeekStart = subWeeks(weekStart, 1);
    const lastWeekSpent = computeWeeklyFunSpend(transactions, categories, lastWeekStart, weekStart);
    rollover = Math.max(0, baseWeeklyFun + boostAmount - lastWeekSpent);
    weeklyFunBudget += rollover;
  }

  // Bidirectional overspend: each category's excess eats into the other
  const essentialSpentThisWeek = computeWeeklyEssentialSpend(transactions, categories, weekStart);
  const essentialOverspend = Math.max(0, essentialSpentThisWeek - weeklyEssentialBudget);
  const funOverspend = Math.max(0, spentThisWeek - weeklyFunBudget);

  // Remaining fun = budget - spent - essential overspend (clamped to 0)
  const remainingWeeklyFun = weeklyFunBudget - spentThisWeek - essentialOverspend;
  // Remaining essentials = budget - spent - fun overspend
  const remainingEssentials = weeklyEssentialBudget - essentialSpentThisWeek - funOverspend;

  const currentBufferMonths = emergencySurvivalMonthly > 0 ? totalLiquidCash / emergencySurvivalMonthly : Infinity;

  // Runway projection: piecewise across the union of all trip windows
  const fullWeeklyBurn = weeklyFixedCosts + (essentialVariable / 4.33) + (assumptions.weekly_fun_budget || 100);
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

  // Runway: piecewise — travel weeks burn fixed-only (essentials/fun paused),
  // then full burn after. Runway represents ALL available cash (minus goal
  // earmarks); the emergency fund IS the runway, not a hard reservation.
  const runwayCash = Math.max(0, totalLiquidCash - totalGoalAllocations);
  let runwayWeeks: number;
  if (travelWeeksRemaining > 0 && fullWeeklyBurn > 0) {
    const travelPhaseSpend = travelWeeksRemaining * fixedOnlyBurn;
    if (runwayCash <= travelPhaseSpend) {
      runwayWeeks = fixedOnlyBurn > 0 ? runwayCash / fixedOnlyBurn : 0;
    } else {
      const remainder = runwayCash - travelPhaseSpend;
      runwayWeeks = travelWeeksRemaining + (remainder / fullWeeklyBurn);
    }
  } else {
    const budgetedWeeklyBurn = Math.max(fullWeeklyBurn, 1);
    runwayWeeks = runwayCash / budgetedWeeklyBurn;
  }
  // Legacy: "with emergency" now equals runway (kept for compat)
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

export function computeMoneySplit(
  assumptions: FinanceAssumptions,
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  goals: FinanceGoal[],
  convertToBase: (amount: number, currency: string) => number,
  fixedExpensesMonthly?: number,
): MoneySplit {
  // 1. Calculate effective net monthly income
  const salaryTakeHome = calcTakeHome({
    grossAnnual: assumptions.gross_annual_salary || 0,
    pensionPercent: assumptions.pension_percent || 0,
    studentLoanPlan: assumptions.student_loan_plan as any,
  }).netMonthly;
  const monthlyIncome = assumptions.expected_monthly_income || salaryTakeHome || 0;

  // 2. Committed fixed bills (use passed fixed expenses if provided, else historic average)
  let monthlyMandatory = fixedExpensesMonthly ?? 0;
  if (!fixedExpensesMonthly) {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const mandatoryCategories = categories.filter(c => c.type === 'fixed');
    const mandatoryCatIds = new Set(mandatoryCategories.map(c => c.id));
    let mandatorySpend = 0;
    const relevantTxs = transactions.filter(tx => new Date(tx.posted_at) >= threeMonthsAgo);
    for (const tx of relevantTxs) {
      if (tx.is_transfer || tx.is_reimbursable) continue;
      if (tx.amount < 0 && (tx.is_fixed || (tx.category_id && mandatoryCatIds.has(tx.category_id)))) {
        mandatorySpend += Math.abs(baseAmt(tx));
      }
    }
    const daysCovered = Math.max(1, (Date.now() - threeMonthsAgo.getTime()) / (1000 * 60 * 60 * 24));
    monthlyMandatory = mandatorySpend / (daysCovered / 30.44);
  }

  const effectiveIncome = monthlyIncome;
  const mandatoryPercent = effectiveIncome > 0 ? (monthlyMandatory / effectiveIncome) * 100 : 0;

  // 3. Essential variable spending
  const essentialResult = computeEssentialVariableMonthly(transactions, categories);
  const essentialVariable = Math.max(
    assumptions.estimated_essential_variable ?? 0,
    essentialResult.monthly,
  );

  // 4. Goal pool savings requirements
  const now = new Date();
  let poolSavingsMonthly = 0;
  for (const g of (goals || [])) {
    if ((g as any)?.is_stash) continue;
    const targetBase = convertToBase ? convertToBase(g.target_amount || 0, g.currency) : (g.target_amount || 0);
    const assignedBase = convertToBase ? convertToBase(g.assigned_amount || 0, g.currency) : (g.assigned_amount || 0);
    const remainingBase = Math.max(0, targetBase - assignedBase);
    if (remainingBase <= 0.01) continue;
    if (g.deadline) {
      const daysLeft = Math.max(1, Math.ceil((new Date(g.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const weeksLeft = Math.max(1, daysLeft / 7);
      const weeklyRequired = remainingBase / weeksLeft;
      poolSavingsMonthly += weeklyRequired * 4.33;
    } else if (g.percent_allocation && g.percent_allocation > 0) {
      poolSavingsMonthly += (g.percent_allocation / 100) * effectiveIncome;
    }
  }

  const goalSavingsAmount = poolSavingsMonthly;
  const goalSavingsPercent = effectiveIncome > 0 ? (goalSavingsAmount / effectiveIncome) * 100 : 0;

  // 5. Fun Money = Genuine Leftover (Income - Fixed Bills - Essential Living - Pool Savings)
  const calculatedFunMonthly = Math.max(0, effectiveIncome - monthlyMandatory - essentialVariable - goalSavingsAmount);
  
  // If user has explicitly overridden weekly_fun_budget with a custom non-default amount (> 0 and != 100), respect it.
  // Otherwise use the calculated cash flow leftover divided by 4.33 weeks per month.
  const weeklyFunAmount = (assumptions.weekly_fun_budget && assumptions.weekly_fun_budget > 0 && assumptions.weekly_fun_budget !== 100)
    ? assumptions.weekly_fun_budget
    : calculatedFunMonthly / 4.33;

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

function computeWeeklyFunSpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  weekStart: Date,
  weekEnd?: Date,
): number {
  let total = 0;
  for (const tx of txs) {
    if (tx.is_transfer || tx.is_reimbursable || tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
    if (tx.goal_id) continue;
    if ((tx as any).is_travel_spend) continue;
    const cat = categories.find(c => c.id === tx.category_id);
    if (cat?.exclude_from_reports) continue;
    if (cat?.type === 'transfer') continue;
    const d = new Date(tx.posted_at);
    if (d < weekStart) continue;
    if (weekEnd && d >= weekEnd) continue;

    // Refunds (positive amounts flagged is_refund) reduce fun spend for the week
    if ((tx as any).is_refund && tx.amount > 0) {
      total -= Math.abs(baseAmt(tx));
      continue;
    }

    if (tx.amount >= 0) continue;
    if (tx.is_fixed || cat?.type === 'fixed' || cat?.type === 'income') continue;
    if (cat?.is_essential) continue;
    total += Math.abs(baseAmt(tx));
  }
  return total;
}

function computeWeeklyEssentialSpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  weekStart: Date,
  weekEnd?: Date,
): number {
  const essentialCatIds = new Set(
    categories
      .filter(c => c.is_essential && c.type === 'variable')
      .map(c => c.id),
  );
  if (essentialCatIds.size === 0) return 0;

  return txs
    .filter(tx => {
      if (tx.amount >= 0) return false;
      if (tx.is_transfer || tx.is_reimbursable) return false;
      if ((tx as any).goal_id) return false; // goal-funded spend draws from the goal pool, not weekly essentials
      if ((tx as any).is_travel_spend) return false;
      if (!tx.category_id || !essentialCatIds.has(tx.category_id)) return false;
      const d = new Date(tx.posted_at);
      if (d < weekStart) return false;
      if (weekEnd && d >= weekEnd) return false;
      return true;
    })
    .reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);
}

/** Compute rolling average weekly spend over last N complete weeks (ALL non-transfer spend) */
function computeRollingWeeklySpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  currentWeekStart: Date,
  weeksBack: number = 4,
): number {
  const weeklyTotals: number[] = [];

  for (let w = 1; w <= weeksBack; w++) {
    const ws = startOfWeek(subWeeks(currentWeekStart, w), { weekStartsOn: 1 });
    const we = startOfWeek(subWeeks(currentWeekStart, w - 1), { weekStartsOn: 1 });

    // Skip weeks that overlap a hard-coded exclusion window (e.g. heavy travel)
    if (weekOverlapsExclusion(ws, we)) continue;

    let weekTotal = 0;
    for (const tx of txs) {
      if (tx.amount >= 0) continue;
      if (tx.is_transfer || tx.is_reimbursable || tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
      if ((tx as any).goal_id) continue;
      if ((tx as any).is_travel_spend) continue;
      const cat = categories.find(c => c.id === tx.category_id);
      if (cat?.exclude_from_reports) continue;
      if (cat?.type === 'transfer') continue;
      const d = new Date(tx.posted_at);
      if (isExcludedSpendDate(d)) continue;
      if (d >= ws && d < we) {
        weekTotal += Math.abs(baseAmt(tx));
      }
    }
    weeklyTotals.push(weekTotal);
  }

  if (weeklyTotals.length === 0) return 0;
  return weeklyTotals.reduce((s, v) => s + v, 0) / weeklyTotals.length;
}

