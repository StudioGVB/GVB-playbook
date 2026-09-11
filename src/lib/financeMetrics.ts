import { FinanceTransaction, FinanceCategory, FixedExpense, FinanceAccount, FinanceSettings } from '@/types/finance';

export interface CurrencyConverter {
  (amount: number, fromCurrency: string): number;
}

export interface MonthlyBreakdownResult {
  essentialSpent: number;
  funSpent: number;
  fixedSpent: number;
  incomeTotal: number;
  actualTotalSpent: number;
  variableSpent: number;
  dailyVariablePace: number;
  projectedVariableSpend: number;
  projectedSpend: number;
  projectedDiff: number;
  daysElapsed: number;
  daysInMonth: number;
  daysRemaining: number;
  categoryTotals: Map<string, number>;
}

/**
 * Standardized function to check if a transaction is a fixed bill.
 */
export function isFixedTransaction(tx: Partial<FinanceTransaction>): boolean {
  return !!tx.fixed_expense_id || !!tx.is_fixed;
}

/**
 * Normalizes a transaction's amount into base currency.
 */
export function getBaseAmount(
  tx: Partial<FinanceTransaction>,
  accountMap: Map<string, FinanceAccount>,
  baseCurrency: string,
  convertToBase: CurrencyConverter
): number {
  if (tx.base_amount !== undefined && tx.base_amount !== null && !isNaN(tx.base_amount)) {
    return tx.base_amount;
  }
  const acc = tx.account_id ? accountMap.get(tx.account_id) : undefined;
  const curr = tx.currency || acc?.currency || baseCurrency;
  const rawAmt = tx.amount || 0;
  return convertToBase(rawAmt, curr);
}

/**
 * Unified calculation engine for monthly spending, variable pace, and projections.
 */
export function computeMonthlyMetrics(params: {
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  accountMap: Map<string, FinanceAccount>;
  essentialCatIds: Set<string>;
  monthStart: Date;
  monthEnd: Date;
  daysInMonth: number;
  daysElapsed: number;
  fixedMonthlyCommitment: number;
  monthlyTotalBudget: number;
  baseCurrency: string;
  convertToBase: CurrencyConverter;
}): MonthlyBreakdownResult {
  const {
    transactions,
    categories,
    accountMap,
    essentialCatIds,
    monthStart,
    monthEnd,
    daysInMonth,
    daysElapsed,
    fixedMonthlyCommitment,
    monthlyTotalBudget,
    baseCurrency,
    convertToBase,
  } = params;

  const catMap = new Map(categories.map(c => [c.id, c]));
  let essentialSpent = 0;
  let funSpent = 0;
  let fixedSpent = 0;
  let incomeTotal = 0;
  const categoryTotals = new Map<string, number>();

  for (const tx of transactions) {
    const txDate = new Date(tx.posted_at);
    if (txDate < monthStart || txDate > monthEnd) continue;
    if (tx.is_reimbursable) continue;
    if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;

    const baseAmt = getBaseAmount(tx, accountMap, baseCurrency, convertToBase);

    // Income
    if (tx.amount > 0 && !tx.is_transfer) {
      incomeTotal += baseAmt;
      continue;
    }

    if (tx.amount >= 0 || tx.is_transfer) continue;
    if ((tx as any).goal_id) continue;

    const cat = catMap.get(tx.category_id || '');
    if (cat?.exclude_from_reports || cat?.type === 'income' || cat?.type === 'transfer') continue;

    const amt = Math.abs(baseAmt);

    // Fixed expense handling
    if (isFixedTransaction(tx) || cat?.type === 'fixed') {
      fixedSpent += amt;
      const catId = tx.category_id || '__uncategorised';
      categoryTotals.set(catId, (categoryTotals.get(catId) || 0) + amt);
      continue;
    }

    // Variable expenses (Essentials vs Fun)
    const catId = tx.category_id || '__uncategorised';
    categoryTotals.set(catId, (categoryTotals.get(catId) || 0) + amt);

    if (essentialCatIds.has(catId) || cat?.is_essential) {
      essentialSpent += amt;
    } else {
      funSpent += amt;
    }
  }

  const actualTotalSpent = essentialSpent + funSpent + fixedSpent;
  const variableSpent = essentialSpent + funSpent;

  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  const dailyVariablePace = daysElapsed > 0 ? variableSpent / daysElapsed : 0;
  const projectedVariableSpend = dailyVariablePace * daysInMonth;
  const projectedSpend = projectedVariableSpend + fixedMonthlyCommitment;
  const projectedDiff = projectedSpend - monthlyTotalBudget;

  return {
    essentialSpent,
    funSpent,
    fixedSpent,
    incomeTotal,
    actualTotalSpent,
    variableSpent,
    dailyVariablePace,
    projectedVariableSpend,
    projectedSpend,
    projectedDiff,
    daysElapsed,
    daysInMonth,
    daysRemaining,
    categoryTotals,
  };
}

/**
 * Smart matcher to link transactions to recurring fixed expenses (Rent, Netflix, Spotify, etc.)
 */
export function matchFixedExpense(
  description: string,
  fixedExpenses: FixedExpense[]
): FixedExpense | undefined {
  if (!description || fixedExpenses.length === 0) return undefined;
  const descLower = description.toLowerCase().trim();

  // Explicit Rent check
  if (descLower.includes('rent')) {
    const rentItem = fixedExpenses.find(e => e.name.toLowerCase().includes('rent'));
    if (rentItem) return rentItem;
  }

  // General name matching
  return fixedExpenses.find(fe => {
    const feName = fe.name.toLowerCase().trim();
    return descLower.includes(feName) || feName.includes(descLower);
  });
}
