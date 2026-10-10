import { FinanceTransaction, FinanceCategory, FinanceGoal } from '@/hooks/useFinanceData';
import { baseAmt } from './financeUtils';
import { format, subMonths, startOfMonth, endOfMonth, differenceInCalendarDays, addDays } from 'date-fns';

export interface IncomeStreamEstimate {
  categoryId: string;
  name: string;
  color?: string;
  totalLast3Months: number;
  activeMonthsCount: number;
  estimatedMonthlyAmount: number;
}

export interface FeasibilityAssessment {
  requiredMonthlyPace: number;
  requiredWeeklyPace: number;
  estimatedMonthlyIncome: number;
  fixedMonthlyExpenses: number;
  variableMonthlyBudget: number;
  existingPoolsMonthlyCommitment: number;
  netMonthlySurplus: number;
  monthsRemaining: number;
  isFeasible: boolean;
  isTight: boolean; // net surplus capacity is tight (< 20% buffer above required pace)
  recommendedFeasibleDate: Date | null;
  recommendedFeasibleTarget: number;
  streamEstimates: IncomeStreamEstimate[];
}

/**
 * Calculates per-stream estimated monthly income using active-month averaging.
 * Prevents diluting new or single-occurrence main streams (like Gamma income).
 */
export function calculateStreamIncomeEstimates(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  now: Date = new Date()
): { totalEstimatedMonthlyIncome: number; streamEstimates: IncomeStreamEstimate[] } {
  const threeMonthsAgoStart = startOfMonth(subMonths(now, 2));
  const endOfCurrentMonth = endOfMonth(now);

  const incomeCategories = categories.filter(c => c.type === 'income');
  const streamMap: Record<string, { name: string; color?: string; total: number; months: Set<string> }> = {};

  // Initialize map for all known income categories
  for (const cat of incomeCategories) {
    streamMap[cat.id] = {
      name: cat.name,
      color: cat.color || undefined,
      total: 0,
      months: new Set<string>(),
    };
  }

  // Filter income transactions in the last 3 months window
  for (const tx of transactions) {
    if (tx.amount <= 0 || tx.is_reimbursable) continue;

    const txDate = new Date(tx.posted_at);
    if (txDate < threeMonthsAgoStart || txDate > endOfCurrentMonth) continue;

    const catId = tx.category_id;
    if (!catId || !streamMap[catId]) continue;

    const bAmt = baseAmt(tx);
    const monthKey = format(txDate, 'yyyy-MM');

    streamMap[catId].total += bAmt;
    streamMap[catId].months.add(monthKey);
  }

  const streamEstimates: IncomeStreamEstimate[] = [];
  let totalEstimatedMonthlyIncome = 0;

  for (const [catId, data] of Object.entries(streamMap)) {
    if (data.total <= 0) continue;

    // Active months rule: divide by months where stream was active (min 1)
    const activeMonthsCount = Math.max(1, data.months.size);
    const estimatedMonthlyAmount = data.total / activeMonthsCount;

    streamEstimates.push({
      categoryId: catId,
      name: data.name,
      color: data.color,
      totalLast3Months: data.total,
      activeMonthsCount,
      estimatedMonthlyAmount,
    });

    totalEstimatedMonthlyIncome += estimatedMonthlyAmount;
  }

  return {
    totalEstimatedMonthlyIncome,
    streamEstimates,
  };
}

/**
 * Evaluates the mathematical feasibility of a target pool given cashflow realities.
 */
export function evaluatePoolFeasibility(params: {
  targetAmount: number;
  currentAssigned: number;
  deadline?: string | null;
  startDate?: string | null;
  existingGoals: FinanceGoal[];
  evaluatingGoalId?: string | null;
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  fixedMonthlyExpenses: number;
  weeklyVariableBudget: number;
  convertToBase: (amount: number, currency?: string) => number;
  now?: Date;
}): FeasibilityAssessment {
  const {
    targetAmount,
    currentAssigned,
    deadline,
    startDate,
    existingGoals,
    evaluatingGoalId,
    transactions,
    categories,
    fixedMonthlyExpenses,
    weeklyVariableBudget,
    convertToBase,
    now = new Date(),
  } = params;

  // 1. Calculate Income Estimates
  const { totalEstimatedMonthlyIncome, streamEstimates } = calculateStreamIncomeEstimates(
    transactions,
    categories,
    now
  );

  // 2. Calculate Variable Spending Monthly Rate (weekly allowance * 4.33 weeks/mo)
  const variableMonthlyBudget = weeklyVariableBudget * 4.33;

  // 3. Calculate Existing Goal Pools Required Monthly Commitment
  let existingPoolsMonthlyCommitment = 0;
  for (const g of existingGoals) {
    if (g.id === evaluatingGoalId) continue;
    if ((g as any).is_emergency || (g as any).is_stash || g.name.toLowerCase().includes('stash') || g.name.toLowerCase().includes('emergency')) {
      continue;
    }

    const gTarget = convertToBase(g.target_amount || 0, g.currency);
    const gAssigned = convertToBase(g.assigned_amount || 0, g.currency);
    const gRemaining = Math.max(0, gTarget - gAssigned);
    if (gRemaining <= 0.01) continue;

    if (g.deadline) {
      const gDl = new Date(g.deadline);
      const daysLeft = Math.max(1, differenceInCalendarDays(gDl, now));
      const weeksLeft = daysLeft / 7;
      const gWeekly = gRemaining / weeksLeft;
      existingPoolsMonthlyCommitment += gWeekly * 4.33;
    } else if (g.percent_allocation && g.percent_allocation > 0) {
      existingPoolsMonthlyCommitment += (g.percent_allocation / 100) * 100 * 4.33;
    }
  }

  // 4. Calculate Net Monthly Surplus Capacity
  const netMonthlySurplus = Math.max(
    0,
    totalEstimatedMonthlyIncome - fixedMonthlyExpenses - variableMonthlyBudget - existingPoolsMonthlyCommitment
  );

  // 5. Calculate Required Pace for Target Pool
  const remainingNeeded = Math.max(0, targetAmount - currentAssigned);
  let monthsRemaining = 1;
  let requiredMonthlyPace = 0;
  let requiredWeeklyPace = 0;

  if (deadline) {
    const dlDate = new Date(deadline);
    const stDate = startDate ? new Date(startDate) : now;
    const calcFrom = stDate > now ? stDate : now;

    const daysRemaining = Math.max(1, differenceInCalendarDays(dlDate, calcFrom));
    const weeksRemaining = daysRemaining / 7;
    monthsRemaining = daysRemaining / 30.4375;

    requiredWeeklyPace = remainingNeeded / Math.max(1, weeksRemaining);
    requiredMonthlyPace = requiredWeeklyPace * 4.33;
  }

  // 6. Feasibility Decision
  const isFeasible = remainingNeeded <= 0.01 || !deadline || requiredMonthlyPace <= netMonthlySurplus + 0.01;
  const isTight = !isFeasible ? false : requiredMonthlyPace > netMonthlySurplus * 0.8 && requiredMonthlyPace > 0;

  // 7. Calculate Recommendations
  let recommendedFeasibleDate: Date | null = null;
  let recommendedFeasibleTarget = targetAmount;

  if (!isFeasible && netMonthlySurplus > 0) {
    // Recommend Date: How long to save `remainingNeeded` at `netMonthlySurplus` pace?
    const requiredMonths = remainingNeeded / netMonthlySurplus;
    const requiredDays = Math.ceil(requiredMonths * 30.4375);
    recommendedFeasibleDate = addDays(now, requiredDays);

    // Recommend Target: How much can be saved by `deadline` at `netMonthlySurplus` pace?
    recommendedFeasibleTarget = currentAssigned + netMonthlySurplus * monthsRemaining;
  }

  return {
    requiredMonthlyPace,
    requiredWeeklyPace,
    estimatedMonthlyIncome: totalEstimatedMonthlyIncome,
    fixedMonthlyExpenses,
    variableMonthlyBudget,
    existingPoolsMonthlyCommitment,
    netMonthlySurplus,
    monthsRemaining,
    isFeasible,
    isTight,
    recommendedFeasibleDate,
    recommendedFeasibleTarget,
    streamEstimates,
  };
}
