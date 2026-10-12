import { FinanceTransaction, FinanceCategory, FinanceGoal } from '@/hooks/useFinanceData';
import { baseAmt, parseUkDate } from './financeUtils';
import { format, subMonths, startOfMonth, endOfMonth, differenceInCalendarDays, addDays } from 'date-fns';

export interface IncomeStreamEstimate {
  categoryId: string;
  name: string;
  color?: string;
  totalLast3Months: number;
  activeMonthsCount: number;
  estimatedMonthlyAmount: number;
}

export interface CompetingGoalDetail {
  id: string;
  name: string;
  targetAmount: number;
  assignedAmount: number;
  remainingAmount: number;
  monthlyCommitment: number;
  weeklyPace: number;
  deadline?: string | null;
  daysRemaining?: number;
}

export interface FeasibilityAssessment {
  requiredMonthlyPace: number;
  requiredWeeklyPace: number;
  estimatedMonthlyIncome: number;
  fixedMonthlyExpenses: number;
  variableMonthlyBudget: number;
  totalMonthlySurplusBeforeGoals: number;
  existingPoolsMonthlyCommitment: number;
  netMonthlySurplus: number;
  shortfall: number;
  remainingNeeded: number;
  monthsRemaining: number;
  daysRemaining: number;
  isFeasible: boolean;
  isTight: boolean; // net surplus capacity is tight (< 20% buffer above required pace)
  recommendedFeasibleDate: Date | null;
  recommendedFeasibleTarget: number;
  recommendedDateWithSurplusBeforeGoals: Date | null;
  streamEstimates: IncomeStreamEstimate[];
  competingGoals: CompetingGoalDetail[];
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
  const currentMonthKey = format(now, 'yyyy-MM');

  const incomeCategories = categories.filter(c => c.type === 'income');
  const streamMap: Record<string, {
    name: string;
    color?: string;
    total: number;
    monthTotals: Record<string, number>;
  }> = {};

  // Initialize map for all known income categories
  for (const cat of incomeCategories) {
    streamMap[cat.id] = {
      name: cat.name,
      color: cat.color || undefined,
      total: 0,
      monthTotals: {},
    };
  }

  // Helper to match transaction to an income category or stream
  const findIncomeStream = (tx: FinanceTransaction): string | null => {
    if (tx.category_id && streamMap[tx.category_id]) return tx.category_id;
    const text = `${tx.merchant || ''} ${tx.description || ''} ${(tx.raw as any)?.message || ''}`.toLowerCase();

    if (text.includes('gamma')) {
      const g = incomeCategories.find(c => c.name.toLowerCase().includes('gamma'));
      if (g) return g.id;
    }
    const isGabriellaIncome = text.includes('gabriella') && tx.amount > 0 && !tx.transfer_group_id;
    if (text.includes('batchbase') || text.includes('batch base') || text.includes('venture') || text.includes('advisory') || isGabriellaIncome) {
      const v = incomeCategories.find(c => c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('batchbase'));
      if (v) return v.id;
      if (!streamMap['__venture_advisory']) {
        streamMap['__venture_advisory'] = {
          name: 'Venture Advisory',
          color: '#2563EB',
          total: 0,
          monthTotals: {},
        };
      }
      return '__venture_advisory';
    }
    if (text.includes('etsy')) {
      const e = incomeCategories.find(c => c.name.toLowerCase().includes('etsy'));
      if (e) return e.id;
    }
    if (text.includes('back pocket') || text.includes('bpg')) {
      const b = incomeCategories.find(c => c.name.toLowerCase().includes('pocket') || c.name.toLowerCase().includes('back'));
      if (b) return b.id;
    }
    if (!streamMap['__other_income']) {
      streamMap['__other_income'] = {
        name: 'Other Cleared Income',
        color: '#10B981',
        total: 0,
        monthTotals: {},
      };
    }
    return '__other_income';
  };

  // Filter income transactions in the last 3 months window
  for (const tx of transactions) {
    const text = `${tx.merchant || ''} ${tx.description || ''} ${(tx.raw as any)?.message || ''}`.toLowerCase();
    const isGabriellaIncome = text.includes('gabriella') && tx.amount > 0 && !tx.transfer_group_id;
    const isBatchbase = text.includes('batchbase') || text.includes('batch base') || text.includes('venture') || text.includes('advisory') || isGabriellaIncome;
    if (tx.amount <= 0 || (!isBatchbase && tx.is_transfer) || tx.is_reimbursable) continue;

    const txDate = parseUkDate(tx.posted_at);
    if (txDate < threeMonthsAgoStart || txDate > endOfCurrentMonth) continue;

    const streamId = findIncomeStream(tx);
    if (!streamId || !streamMap[streamId]) continue;

    const bAmt = baseAmt(tx);
    const monthKey = format(txDate, 'yyyy-MM');

    streamMap[streamId].total += bAmt;
    streamMap[streamId].monthTotals[monthKey] = (streamMap[streamId].monthTotals[monthKey] || 0) + bAmt;
  }

  const streamEstimates: IncomeStreamEstimate[] = [];
  let totalEstimatedMonthlyIncome = 0;

  for (const [catId, data] of Object.entries(streamMap)) {
    const monthEntries = Object.entries(data.monthTotals).filter(([_, amt]) => amt > 0);
    if (monthEntries.length === 0 && data.total <= 0) continue;

    const isGammaSalary = data.name.toLowerCase().includes('gamma') || data.name.toLowerCase().includes('salary');
    const completedMonths = monthEntries.filter(([m]) => m !== currentMonthKey);
    const currentMonthAmt = data.monthTotals[currentMonthKey] || 0;

    let estimatedMonthlyAmount = 0;
    let activeMonthsCount = 1;

    if (isGammaSalary) {
      // Monthly salary streams: A salary paycheck is a full monthly wage.
      // Do not dilute by an in-progress month before payday (e.g. October 12th).
      const maxMonthlyObserved = Math.max(...monthEntries.map(([_, a]) => a), 0);
      // Gabriella's standard Gamma net monthly salary benchmark is ~£2,896.67
      estimatedMonthlyAmount = Math.max(maxMonthlyObserved, 2896.67);
      activeMonthsCount = Math.max(1, monthEntries.length);
    } else {
      if (completedMonths.length > 0) {
        const completedSum = completedMonths.reduce((sum, [_, a]) => sum + a, 0);
        const completedAvg = completedSum / completedMonths.length;
        estimatedMonthlyAmount = Math.max(completedAvg, currentMonthAmt);
        activeMonthsCount = completedMonths.length;
      } else {
        estimatedMonthlyAmount = data.total;
        activeMonthsCount = 1;
      }
    }

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

  // Guaranteed inclusion: Gamma Salary benchmark (~£2,896.67/mo)
  const hasGammaStream = streamEstimates.some(s =>
    s.name.toLowerCase().includes('gamma') || s.name.toLowerCase().includes('salary')
  );
  if (!hasGammaStream) {
    const gammaMonthly = 2896.67;
    const gCat = incomeCategories.find(c => c.name.toLowerCase().includes('gamma') || c.name.toLowerCase().includes('salary'));
    streamEstimates.unshift({
      categoryId: gCat?.id || '__gamma_salary',
      name: 'Gamma Salary',
      color: '#DB2777',
      totalLast3Months: gammaMonthly * 3,
      activeMonthsCount: 3,
      estimatedMonthlyAmount: gammaMonthly,
    });
    totalEstimatedMonthlyIncome += gammaMonthly;
  }

  // Guaranteed inclusion: Venture Advisory side income is £70/wk (~£303.33/mo)
  const hasVentureStream = streamEstimates.some(s =>
    s.name.toLowerCase().includes('venture') || s.name.toLowerCase().includes('batchbase')
  );
  if (!hasVentureStream) {
    const ventureMonthly = (70 * 52) / 12; // ~£303.33/mo
    const vCat = incomeCategories.find(c => c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('batchbase'));
    streamEstimates.push({
      categoryId: vCat?.id || '__venture_advisory',
      name: 'Venture Advisory',
      color: '#2563EB',
      totalLast3Months: ventureMonthly * 3,
      activeMonthsCount: 3,
      estimatedMonthlyAmount: ventureMonthly,
    });
    totalEstimatedMonthlyIncome += ventureMonthly;
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
  expectedMonthlyIncome?: number;
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
    expectedMonthlyIncome,
    convertToBase,
    now = new Date(),
  } = params;

  // 1. Calculate Income Estimates (floored by £3,200/mo baseline if not explicitly specified)
  const streamIncome = calculateStreamIncomeEstimates(
    transactions,
    categories,
    now
  );
  const baselineIncome = 3200; // Gabriella's standard net monthly income (~£3.2k/mo)
  const totalEstimatedMonthlyIncome = (expectedMonthlyIncome && expectedMonthlyIncome > 0)
    ? expectedMonthlyIncome
    : Math.max(streamIncome.totalEstimatedMonthlyIncome, baselineIncome);
  const streamEstimates = streamIncome.streamEstimates;

  // 2. Calculate Variable Spending Monthly Rate (weekly allowance * 4.33 weeks/mo)
  const variableMonthlyBudget = weeklyVariableBudget * 4.33;

  // 3. Calculate Existing Goal Pools Required Monthly Commitment
  let existingPoolsMonthlyCommitment = 0;
  const competingGoals: CompetingGoalDetail[] = [];
  const evalStart = startDate ? new Date(startDate) : now;
  const evalDeadline = deadline ? new Date(deadline) : null;

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
      const gStart = g.start_date ? new Date(g.start_date) : now;

      // Timeline overlap check:
      // If g ends before evaluating goal starts, or g starts after evaluating goal ends, they do not compete!
      if (evalStart && gDl < evalStart) continue;
      if (evalDeadline && gStart > evalDeadline) continue;

      const calcFrom = gStart > now ? gStart : now;
      const daysLeft = Math.max(1, differenceInCalendarDays(gDl, calcFrom));
      const weeksLeft = daysLeft / 7;
      const gWeekly = gRemaining / weeksLeft;
      const gMonthly = gWeekly * 4.33;
      existingPoolsMonthlyCommitment += gMonthly;
      competingGoals.push({
        id: g.id,
        name: g.name,
        targetAmount: gTarget,
        assignedAmount: gAssigned,
        remainingAmount: gRemaining,
        monthlyCommitment: gMonthly,
        weeklyPace: gWeekly,
        deadline: g.deadline,
        daysRemaining: daysLeft,
      });
    } else if (g.percent_allocation && g.percent_allocation > 0) {
      const gMonthly = (g.percent_allocation / 100) * 100 * 4.33;
      existingPoolsMonthlyCommitment += gMonthly;
      competingGoals.push({
        id: g.id,
        name: g.name,
        targetAmount: gTarget,
        assignedAmount: gAssigned,
        remainingAmount: gRemaining,
        monthlyCommitment: gMonthly,
        weeklyPace: gMonthly / 4.33,
        deadline: null,
      });
    }
  }

  // Sort competing goals by monthly commitment descending (highest drain first)
  competingGoals.sort((a, b) => b.monthlyCommitment - a.monthlyCommitment);

  // 4. Calculate Total Savings Capacity & Net Monthly Surplus Capacity
  const totalMonthlySurplusBeforeGoals = Math.max(
    0,
    totalEstimatedMonthlyIncome - fixedMonthlyExpenses - variableMonthlyBudget
  );

  const netMonthlySurplus = Math.max(
    0,
    totalMonthlySurplusBeforeGoals - existingPoolsMonthlyCommitment
  );

  // 5. Calculate Required Pace for Target Pool
  const remainingNeeded = Math.max(0, targetAmount - currentAssigned);
  let monthsRemaining = 1;
  let daysRemaining = 0;
  let requiredMonthlyPace = 0;
  let requiredWeeklyPace = 0;

  if (deadline) {
    const dlDate = new Date(deadline);
    const stDate = startDate ? new Date(startDate) : now;
    const calcFrom = stDate > now ? stDate : now;

    daysRemaining = Math.max(1, differenceInCalendarDays(dlDate, calcFrom));
    const weeksRemaining = daysRemaining / 7;
    monthsRemaining = daysRemaining / 30.4375;

    requiredWeeklyPace = remainingNeeded / Math.max(1, weeksRemaining);
    requiredMonthlyPace = requiredWeeklyPace * 4.33;
  }

  // 6. Feasibility Decision
  const isFeasible = remainingNeeded <= 0.01 || !deadline || requiredMonthlyPace <= netMonthlySurplus + 0.01;
  const isTight = !isFeasible ? false : requiredMonthlyPace > netMonthlySurplus * 0.8 && requiredMonthlyPace > 0;
  const shortfall = Math.max(0, requiredMonthlyPace - netMonthlySurplus);

  // 7. Calculate Recommendations
  let recommendedFeasibleDate: Date | null = null;
  let recommendedFeasibleTarget = targetAmount;
  let recommendedDateWithSurplusBeforeGoals: Date | null = null;

  if (!isFeasible) {
    if (netMonthlySurplus > 0) {
      // Recommend Date: How long to save `remainingNeeded` at `netMonthlySurplus` pace?
      const requiredMonths = remainingNeeded / netMonthlySurplus;
      const requiredDays = Math.ceil(requiredMonths * 30.4375);
      recommendedFeasibleDate = addDays(now, requiredDays);

      // Recommend Target: How much can be saved by `deadline` at `netMonthlySurplus` pace?
      recommendedFeasibleTarget = currentAssigned + netMonthlySurplus * monthsRemaining;
    }

    if (totalMonthlySurplusBeforeGoals > 0) {
      const requiredMonthsBeforeGoals = remainingNeeded / totalMonthlySurplusBeforeGoals;
      const requiredDaysBeforeGoals = Math.ceil(requiredMonthsBeforeGoals * 30.4375);
      recommendedDateWithSurplusBeforeGoals = addDays(now, requiredDaysBeforeGoals);
    }
  }

  return {
    requiredMonthlyPace,
    requiredWeeklyPace,
    estimatedMonthlyIncome: totalEstimatedMonthlyIncome,
    fixedMonthlyExpenses,
    variableMonthlyBudget,
    totalMonthlySurplusBeforeGoals,
    existingPoolsMonthlyCommitment,
    netMonthlySurplus,
    shortfall,
    remainingNeeded,
    monthsRemaining,
    daysRemaining,
    isFeasible,
    isTight,
    recommendedFeasibleDate,
    recommendedFeasibleTarget,
    recommendedDateWithSurplusBeforeGoals,
    streamEstimates,
    competingGoals,
  };
}
