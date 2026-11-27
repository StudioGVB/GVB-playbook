import { baseAmt, parseUkDate } from './financeUtils';
import type { FinanceGoal } from '@/hooks/useFinanceData';
import { computeMonthlyPotSchedule } from './potPacingEngine';

export interface PaycheckWaterfallBreakdown {
  paycheckAmount: number;
  fixedBillsMonthly: number;
  essentialVariableMonthly: number;
  totalLivingCostReserve: number;
  emergencyShortfall: number;
  emergencyTopUp: number;
  goalAllocations: { goalId: string; goalName: string; monthlyTarget: number; allocatedAmount: number }[];
  totalGoalAllocations: number;
  funMoneyLeftover: number;
}

export interface DetectedPaycheck {
  transaction: any;
  targetMonthName: string;
  isNextMonthPaycheck: boolean;
  payPeriodLabel: string;
}

/**
 * Detects the primary paycheck deposit transaction for the current or upcoming budget cycle.
 * Handles last-day-of-month paychecks (e.g. Gamma paid on Sept 30th):
 * - If paid on/after the 25th of Month M, it is automatically attributed to Month M+1 (e.g. Oct budget).
 * - Guarantees the budget is never marked "behind" at the start of the new month.
 */
export function detectPaycheck(
  transactions: any[],
  categories: any[],
  refDate: Date = new Date()
): DetectedPaycheck | null {
  const catMap = new Map(categories.map(c => [c.id, c]));

  // Detect Gamma paychecks from the 18th of the current month (e.g. early pre-Christmas Dec 22 payday or Nov 27/30 payday)
  // or within the last 14 days so the pre-allocated Next Month Living Budget pot stays active through month-end.
  const fourteenDaysAgo = new Date(refDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const eighteenthOfThisMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 18, 0, 0, 0, 0);
  const windowStart = fourteenDaysAgo < eighteenthOfThisMonth ? fourteenDaysAgo : eighteenthOfThisMonth;
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(refDate.getTime() + 2 * 24 * 60 * 60 * 1000);

  const candidates = transactions.filter(tx => {
    const amt = baseAmt(tx);
    if (amt < 1000) return false;
    if (tx.is_reimbursable || tx.is_refund || tx.is_transfer) return false;

    const d = parseUkDate(tx.posted_at);
    if (d < windowStart || d > windowEnd) return false;

    const rawText = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
    const cat = catMap.get(tx.category_id || '');
    const catNameLower = (cat?.name || '').toLowerCase();
    const isIncomeCat = cat?.type === 'income';

    // Never treat weekly Venture Advisory or irregular side income as the monthly Gamma paycheck
    if (
      rawText.includes('venture') ||
      rawText.includes('advisory') ||
      rawText.includes('eleven') ||
      rawText.includes('11labs') ||
      rawText.includes('back pocket') ||
      rawText.includes('bpg') ||
      rawText.includes('etsy')
    ) {
      return false;
    }

    const isGammaOrSalary =
      rawText.includes('gamma') ||
      rawText.includes('payroll') ||
      rawText.includes('salary') ||
      catNameLower.includes('gamma') ||
      catNameLower.includes('salary');

    if (isGammaOrSalary && amt >= 1000) return true;
    if (isIncomeCat && amt >= 1500) return true;
    if (amt >= 1500) return true;

    return false;
  });

  if (candidates.length === 0) return null;

  // Return the most recent (or largest) candidate transaction as the primary paycheck
  candidates.sort((a, b) => parseUkDate(b.posted_at).getTime() - parseUkDate(a.posted_at).getTime() || baseAmt(b) - baseAmt(a));
  const primaryTx = candidates[0];

  const txDate = parseUkDate(primaryTx.posted_at);
  const dayOfMonth = txDate.getDate();

  // If paid on/after the 18th of Month M-1 (e.g. Nov 30th for December), it funds Month M (the next calendar month)
  let targetYear = txDate.getFullYear();
  let targetMonthIndex = txDate.getMonth();
  let isNextMonthPaycheck = false;

  if (dayOfMonth >= 18) {
    targetMonthIndex += 1;
    if (targetMonthIndex > 11) {
      targetMonthIndex = 0;
      targetYear += 1;
    }
    isNextMonthPaycheck = true;
  }

  // Only treat as "next month pre-funded" while we are still in the payday month (before the 1st of targetMonth)
  const isStillBeforeTargetMonth =
    refDate.getFullYear() < targetYear ||
    (refDate.getFullYear() === targetYear && refDate.getMonth() < targetMonthIndex);

  const targetDate = new Date(targetYear, targetMonthIndex, 1);
  const targetMonthName = targetDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const txFormattedDate = txDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const payPeriodLabel = isNextMonthPaycheck
    ? `${targetMonthName} (Paid ${txFormattedDate})`
    : `${targetMonthName} Budget`;

  return {
    transaction: primaryTx,
    targetMonthName,
    isNextMonthPaycheck: isNextMonthPaycheck && isStillBeforeTargetMonth,
    payPeriodLabel,
  };
}

/**
 * Checks whether a given paycheck transaction has already been allocated to pools.
 * Checks persistent database metadata (tx.raw?.paycheck_allocated) as well as localStorage.
 */
export function isPaycheckProcessed(txOrId: any): boolean {
  if (!txOrId) return false;
  const txId = typeof txOrId === 'string' ? txOrId : txOrId.id;
  if (!txId) return false;
  if (typeof txOrId === 'object' && (txOrId.raw?.paycheck_allocated === true || (txOrId as any).paycheck_allocated === true)) {
    return true;
  }
  return localStorage.getItem(`paycheck_processed_${txId}`) === 'true';
}

/**
 * Marks a paycheck transaction ID as processed to guarantee zero double-ups.
 */
export function markPaycheckProcessed(txId: string): void {
  if (!txId) return;
  localStorage.setItem(`paycheck_processed_${txId}`, 'true');
}

/**
  * Unmarks a paycheck transaction ID as processed so it can be re-allocated.
  */
export function unmarkPaycheckProcessed(txId: string): void {
  if (!txId) return;
  localStorage.removeItem(`paycheck_processed_${txId}`);
  localStorage.removeItem(`paycheck_allocated_at_${txId}`);
  localStorage.removeItem(`paycheck_allocation_snapshot_${txId}`);
}

/**
  * Saves allocation timestamp and waterfall snapshot for exact reversal.
  */
export function savePaycheckAllocationMeta(txId: string, breakdown: PaycheckWaterfallBreakdown): void {
  if (!txId) return;
  localStorage.setItem(`paycheck_allocated_at_${txId}`, Date.now().toString());
  localStorage.setItem(`paycheck_allocation_snapshot_${txId}`, JSON.stringify(breakdown));
}

/**
  * Retrieves allocation timestamp and waterfall snapshot if available.
  */
export function getPaycheckAllocationMeta(txId: string): { allocatedAt: number; breakdown: PaycheckWaterfallBreakdown } | null {
  if (!txId) return null;
  const timeStr = localStorage.getItem(`paycheck_allocated_at_${txId}`);
  const snapStr = localStorage.getItem(`paycheck_allocation_snapshot_${txId}`);
  if (!timeStr || !snapStr) return null;
  try {
    return {
      allocatedAt: parseInt(timeStr, 10),
      breakdown: JSON.parse(snapStr),
    };
  } catch {
    return null;
  }
}

/**
 * Calculates the strict 4-step monthly waterfall allocation for a Gamma paycheck:
 * 1. [x] Fixed Bills (Monthly)
 * 2. [y] Variable Essentials (Monthly)
 * 3. [z] Active Savings Pots (Scheduled Monthly Targets for the Target Month)
 * 4. [a] Base Fun Money Leftover (Discretionary)
 */
export function calculatePaycheckWaterfall(
  paycheckAmount: number,
  emergencyFloor: number,
  currentEmergencyFunded: number,
  goals: FinanceGoal[],
  fixedMonthlyTotal: number,
  essentialVariableMonthly: number,
  convertToBase: (amt: number, cur: string) => number,
  transactions: any[] = [],
  referenceDate: Date = new Date()
): PaycheckWaterfallBreakdown {
  let remaining = paycheckAmount;

  // Step 1 & 2: Living Cost Reserve ([x] Fixed Bills + [y] Variable Essentials)
  const totalLivingCostReserve = Math.min(remaining, fixedMonthlyTotal + essentialVariableMonthly);
  remaining -= totalLivingCostReserve;

  // Emergency shortfall is tracked for display, but never steals from [z] Savings Pots or [a] Fun Money
  const emergencyShortfall = Math.max(0, emergencyFloor - currentEmergencyFunded);
  const emergencyTopUp = 0;

  // Always anchor to the 1st of the target month so the full 30/31-day monthly pot schedule is funded
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);

  // Step 3: [z] Savings Pots Monthly Contributions
  const potSchedule = computeMonthlyPotSchedule({
    goals,
    transactions: transactions || [],
    convertToBase,
    referenceDate: monthStart,
  });
  const goalAllocations: { goalId: string; goalName: string; monthlyTarget: number; allocatedAmount: number }[] = [];
  let totalGoalAllocations = 0;

  for (const g of goals) {
    const lower = (g.name || '').trim().toLowerCase();
    // Exclude system pots (Savings Stash, Emergency Reserve, and dynamic Core Savings)
    if ((g as any).is_stash || (g as any).is_emergency) continue;
    if (lower.includes('stash') || lower.includes('emergency') || lower === 'savings' || lower === 'core savings') {
      continue;
    }

    const scheduledPlan = potSchedule.getGoalPlanForMonth(g.id, monthStart);
    if (!scheduledPlan || scheduledPlan.isFutureStart || scheduledPlan.remainingToSaveBase <= 0.01) {
      continue;
    }

    const monthlyTarget = Math.min(scheduledPlan.remainingToSaveBase, scheduledPlan.monthlyAmount);
    if (monthlyTarget <= 0.01) continue;

    const allocatedAmount = Math.min(remaining, monthlyTarget);
    remaining -= allocatedAmount;
    totalGoalAllocations += allocatedAmount;

    goalAllocations.push({
      goalId: g.id,
      goalName: g.name,
      monthlyTarget,
      allocatedAmount,
    });
  }

  // Step 4: [a] Base Fun Money Leftover
  const funMoneyLeftover = Math.max(0, remaining);

  return {
    paycheckAmount,
    fixedBillsMonthly: fixedMonthlyTotal,
    essentialVariableMonthly,
    totalLivingCostReserve,
    emergencyShortfall,
    emergencyTopUp,
    goalAllocations,
    totalGoalAllocations,
    funMoneyLeftover,
  };
}
