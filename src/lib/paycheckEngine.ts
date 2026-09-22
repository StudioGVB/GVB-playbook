import { baseAmt } from './financeUtils';
import type { FinanceGoal } from '@/hooks/useFinanceData';

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

  // Calculate search window: 35 days back from refDate to cover month-end paychecks
  const windowStart = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 20);
  const windowEnd = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 5);

  const candidates = transactions.filter(tx => {
    const amt = baseAmt(tx);
    if (amt <= 0) return false;
    if (tx.is_reimbursable) return false;

    const d = new Date(tx.posted_at);
    if (d < windowStart || d > windowEnd) return false;

    const rawText = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
    const cat = catMap.get(tx.category_id || '');
    const isIncomeCat = cat?.type === 'income';

    const isMatchKeyword =
      rawText.includes('gamma') ||
      rawText.includes('payroll') ||
      rawText.includes('salary') ||
      rawText.includes('batchbase') ||
      rawText.includes('batch base');

    if (isMatchKeyword) return true;
    if (isIncomeCat && amt >= 500) return true;
    if (!tx.is_transfer && amt >= 1000) return true;

    return false;
  });

  if (candidates.length === 0) return null;

  // Return the largest candidate transaction as the primary paycheck
  candidates.sort((a, b) => baseAmt(b) - baseAmt(a));
  const primaryTx = candidates[0];

  const txDate = new Date(primaryTx.posted_at);
  const dayOfMonth = txDate.getDate();

  // If paid on or after the 25th, it funds the NEXT calendar month
  let targetYear = txDate.getFullYear();
  let targetMonthIndex = txDate.getMonth();
  let isNextMonthPaycheck = false;

  if (dayOfMonth >= 25) {
    targetMonthIndex += 1;
    if (targetMonthIndex > 11) {
      targetMonthIndex = 0;
      targetYear += 1;
    }
    isNextMonthPaycheck = true;
  }

  const targetDate = new Date(targetYear, targetMonthIndex, 1);
  const targetMonthName = targetDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const txFormattedDate = txDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const payPeriodLabel = isNextMonthPaycheck
    ? `${targetMonthName} (Paid ${txFormattedDate})`
    : `${targetMonthName} Budget`;

  return {
    transaction: primaryTx,
    targetMonthName,
    isNextMonthPaycheck,
    payPeriodLabel,
  };
}

/**
 * Checks whether a given paycheck transaction ID has already been allocated to pools.
 */
export function isPaycheckProcessed(txId: string): boolean {
  if (!txId) return false;
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
 * Calculates the strict 4-step monthly waterfall allocation for a paycheck:
 * 1. Reserved Fixed Bills + Essential Living (Monthly)
 * 2. Emergency Reserve Top-up (up to 100% target floor)
 * 3. Goal Pools (Monthly Targets)
 * 4. Fun Money Leftover (Discretionary)
 */
export function calculatePaycheckWaterfall(
  paycheckAmount: number,
  emergencyFloor: number,
  currentEmergencyFunded: number,
  goals: FinanceGoal[],
  fixedMonthlyTotal: number,
  essentialVariableMonthly: number,
  convertToBase: (amt: number, cur: string) => number
): PaycheckWaterfallBreakdown {
  let remaining = paycheckAmount;

  // Step 1: Living Cost Reserve (Monthly Fixed Bills + Monthly Essential Variable)
  const totalLivingCostReserve = Math.min(remaining, fixedMonthlyTotal + essentialVariableMonthly);
  remaining -= totalLivingCostReserve;

  // Step 2: Emergency Reserve Top-up
  const emergencyShortfall = Math.max(0, emergencyFloor - currentEmergencyFunded);
  const emergencyTopUp = Math.min(remaining, emergencyShortfall);
  remaining -= emergencyTopUp;

  // Step 3: Goal Pool Monthly Contributions
  const now = new Date();
  const goalAllocations: { goalId: string; goalName: string; monthlyTarget: number; allocatedAmount: number }[] = [];
  let totalGoalAllocations = 0;

  for (const g of goals) {
    if ((g as any).is_stash) continue; // Exclude savings stash from step 3 goal targets
    const targetBase = convertToBase(g.target_amount || 0, g.currency);
    const assignedBase = convertToBase(g.assigned_amount || 0, g.currency);
    const remainingNeeded = Math.max(0, targetBase - assignedBase);

    let monthlyTarget = 0;
    if (remainingNeeded > 0.01) {
      if (g.deadline) {
        const daysLeft = Math.max(1, Math.ceil((new Date(g.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        const weeksLeft = Math.max(1, daysLeft / 7);
        monthlyTarget = (remainingNeeded / weeksLeft) * 4.33;
      } else if (g.percent_allocation && g.percent_allocation > 0) {
        monthlyTarget = (g.percent_allocation / 100) * 500; // default baseline target
      } else {
        monthlyTarget = Math.min(remainingNeeded, 100);
      }
    }

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

  // Step 4: Discretionary Fun Money Leftover
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
