import { FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';
import { startOfMonth, endOfMonth, subMonths, startOfWeek, subWeeks, subDays, format } from 'date-fns';

// ---- Hard-coded spend exclusion windows ----
// Transactions posted within these ranges are ignored when calculating
// spending habits (rolling averages, essential variable, safe-to-spend, etc.).
// Rationale: heavy travel periods that would otherwise skew the baseline.
export const SPEND_EXCLUSION_RANGES: { start: Date; end: Date; label: string }[] = [
  { start: new Date('2026-05-02T00:00:00'), end: new Date('2026-06-22T23:59:59'), label: 'Travel (May 2 – Jun 22, 2026)' },
];

// ---- UK Timezone Date Helpers ----

/**
 * Parses any posted_at string or Date into a Date object formatted for UK local time (Europe/London).
 * Automatically converts Australian AEST (+10:00 / +11:00) timestamps to the true UK date & time.
 */
export function parseUkDate(postedAt: string | Date | null | undefined): Date {
  if (!postedAt) return new Date();
  if (postedAt instanceof Date) return postedAt;

  let str = String(postedAt).trim();

  // If string is naive date without timezone e.g. "2026-09-08 03:30:00" or "2026-09-08T03:30:00"
  // treat as Australian AEST (+10:00) timestamp coming from Up Bank
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(str)) {
    str += '+10:00';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    str += 'T12:00:00+10:00';
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Formats a transaction date specifically in UK local time (Europe/London).
 * Examples:
 * - formatUkDate(tx.posted_at, 'dd MMM yyyy') -> "07 Sep 2026"
 * - formatUkDate(tx.posted_at, 'd MMM')       -> "7 Sep"
 * - formatUkDate(tx.posted_at, 'yyyy-MM-dd')  -> "2026-09-07"
 * - formatUkDate(tx.posted_at, 'dd MMM HH:mm')-> "07 Sep 18:30"
 */
export function formatUkDate(postedAt: string | Date | null | undefined, pattern: string = 'dd MMM yyyy'): string {
  const d = parseUkDate(postedAt);
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(d);
  const map: Record<string, string> = {};
  parts.forEach(p => { map[p.type] = p.value; });

  const day = map.day || '01';
  const month = map.month || 'Jan';
  const year = map.year || '2026';
  const hour = map.hour || '00';
  const minute = map.minute || '00';

  if (pattern === 'dd MMM yyyy') return `${day} ${month} ${year}`;
  if (pattern === 'd MMM yyyy') return `${parseInt(day, 10)} ${month} ${year}`;
  if (pattern === 'd MMM') return `${parseInt(day, 10)} ${month}`;
  if (pattern === 'dd MMM') return `${day} ${month}`;
  if (pattern === 'yyyy-MM-dd') {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthNum = String(monthNames.indexOf(month) + 1).padStart(2, '0');
    return `${year}-${monthNum}-${day}`;
  }
  if (pattern === 'dd MMM HH:mm') return `${day} ${month} ${hour}:${minute}`;

  return `${day} ${month} ${year}`;
}

export function isExcludedSpendDate(d: Date | string): boolean {
  const dateObj = parseUkDate(d);
  const t = dateObj.getTime();
  return SPEND_EXCLUSION_RANGES.some(r => t >= r.start.getTime() && t <= r.end.getTime());
}

/** True if a week (start inclusive, end exclusive) overlaps any exclusion range. */
export function weekOverlapsExclusion(weekStart: Date, weekEnd: Date): boolean {
  const ws = weekStart.getTime();
  const we = weekEnd.getTime();
  return SPEND_EXCLUSION_RANGES.some(r => ws < r.end.getTime() && we > r.start.getTime());
}

/** Returns the transaction amount in the user's base currency (falls back to raw if not enriched). Sign preserved. */
export function baseAmt(tx: any): number {
  const v = tx?.base_amount;
  return typeof v === 'number' ? v : (Number(tx?.amount) || 0);
}

// ---- Time-range helpers ----

export function getDateRangeFromDays(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = subDays(end, days);
  return { start, end };
}

export function getMonthRange(monthsBack: number = 0) {
  const d = subMonths(new Date(), monthsBack);
  return { start: startOfMonth(d), end: endOfMonth(d) };
}

export function filterTxByDateRange(txs: FinanceTransaction[], start: Date, end: Date) {
  return txs.filter(tx => {
    const d = parseUkDate(tx.posted_at);
    return d >= start && d <= end;
  });
}

/** Get transactions within the last N days */
export function filterTxByDays(txs: FinanceTransaction[], days: number) {
  const { start, end } = getDateRangeFromDays(days);
  return filterTxByDateRange(txs, start, end);
}

// ---- Monthly stats ----

export function computeMonthlyStats(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  monthsBack: number = 0,
) {
  const { start, end } = getMonthRange(monthsBack);
  const monthTxs = filterTxByDateRange(txs, start, end);

  let income = 0;
  let fixedSpend = 0;
  let variableSpend = 0;
  let transfers = 0;

  for (const tx of monthTxs) {
    if (isExcludedSpendDate(new Date(tx.posted_at))) continue;
    if (tx.is_reimbursable) continue; // Exclude work travel reimbursable expenses & payouts from personal spend/income

    if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') { transfers += baseAmt(tx); continue; }
    if (tx.is_transfer) continue; // exclude all flagged transfers from aggregates
    const cat = categories.find(c => c.id === tx.category_id);
    if (cat?.exclude_from_reports) continue;
    if (tx.amount > 0) {
      income += baseAmt(tx);
    } else {
      if (tx.is_fixed || cat?.type === 'fixed') {
        fixedSpend += Math.abs(baseAmt(tx));
      } else {
        variableSpend += Math.abs(baseAmt(tx));
      }
    }
  }

  return {
    month: format(start, 'MMM yyyy'),
    income,
    fixedSpend,
    variableSpend,
    transfers,
    netSavings: income - fixedSpend - variableSpend,
    totalSpend: fixedSpend + variableSpend,
  };
}

// ---- Rolling averages (time-range aware) ----

function getAvailableMonths(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  preferredMonths: number = 3,
): ReturnType<typeof computeMonthlyStats>[] {
  const results: ReturnType<typeof computeMonthlyStats>[] = [];
  for (let i = 0; i < preferredMonths + 2 && results.length < preferredMonths; i++) {
    const stats = computeMonthlyStats(txs, categories, i);
    if (stats.totalSpend > 0 || stats.income > 0) {
      results.push(stats);
    }
  }
  return results;
}

export function computeRollingBurnRate(txs: FinanceTransaction[], categories: FinanceCategory[], months: number = 3) {
  const available = getAvailableMonths(txs, categories, months);
  if (available.length === 0) return { avg: 0, conservative: 0, monthsUsed: 0 };
  const spends = available.map(m => m.totalSpend);
  const avg = spends.reduce((s, v) => s + v, 0) / spends.length;
  const conservative = Math.max(...spends);
  return { avg, conservative, monthsUsed: available.length };
}

export function computeRollingIncomeAvg(txs: FinanceTransaction[], categories: FinanceCategory[], months: number = 3) {
  const available = getAvailableMonths(txs, categories, months);
  if (available.length === 0) return { avg: 0, monthsUsed: 0 };
  const incomes = available.map(m => m.income);
  const avg = incomes.reduce((s, v) => s + v, 0) / incomes.length;
  return { avg, monthsUsed: available.length };
}

export function computeFreeCashFlow(txs: FinanceTransaction[], categories: FinanceCategory[], months: number = 3) {
  const income = computeRollingIncomeAvg(txs, categories, months);
  const burn = computeRollingBurnRate(txs, categories, months);
  return income.avg - burn.avg;
}

export function computeEmergencyBuffer(burnRate: number, multiplier: number = 3) {
  return burnRate * multiplier;
}

/** Monthly stats for charting over N months */
export function computeMonthlyHistory(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  months: number = 6,
): ReturnType<typeof computeMonthlyStats>[] {
  const result: ReturnType<typeof computeMonthlyStats>[] = [];
  for (let i = months - 1; i >= 0; i--) {
    result.push(computeMonthlyStats(txs, categories, i));
  }
  return result;
}

// ---- Time-range filtered aggregates ----

export function computePeriodTotals(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  days: number,
) {
  const filtered = filterTxByDays(txs, days);
  let income = 0, fixedSpend = 0, variableSpend = 0;

  for (const tx of filtered) {
    if (tx.is_reimbursable) continue;
    if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
    if (tx.is_transfer) continue;
    const cat = categories.find(c => c.id === tx.category_id);
    if (cat?.exclude_from_reports) continue;
    if (tx.amount > 0) {
      income += baseAmt(tx);
    } else {
      if (tx.is_fixed || cat?.type === 'fixed') {
        fixedSpend += Math.abs(baseAmt(tx));
      } else {
        variableSpend += Math.abs(baseAmt(tx));
      }
    }
  }

  return { income, fixedSpend, variableSpend, totalSpend: fixedSpend + variableSpend };
}

/** Previous equivalent period for comparison */
export function computePreviousPeriodTotals(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  days: number,
) {
  const end = subDays(new Date(), days);
  const start = subDays(end, days);
  const filtered = filterTxByDateRange(txs, start, end).filter(tx => !tx.is_reimbursable && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');

  let income = 0, fixedSpend = 0, variableSpend = 0;
  for (const tx of filtered) {
    const cat = categories.find(c => c.id === tx.category_id);
    if (cat?.exclude_from_reports) continue;
    if (tx.amount > 0) {
      income += baseAmt(tx);
    } else {
      if (tx.is_fixed || cat?.type === 'fixed') {
        fixedSpend += Math.abs(baseAmt(tx));
      } else {
        variableSpend += Math.abs(baseAmt(tx));
      }
    }
  }
  return { income, fixedSpend, variableSpend, totalSpend: fixedSpend + variableSpend };
}

// ---- Income Analysis ----

export interface IncomeSource {
  key: string;
  label: string;
  total: number;
  count: number;
  pct: number;
}

export function computeIncomeBySource(
  txs: FinanceTransaction[],
  days: number = 90,
): { sources: IncomeSource[]; total: number } {
  const filtered = filterTxByDays(txs, days)
    .filter(tx => tx.amount > 0 && !tx.is_reimbursable && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');

  const total = filtered.reduce((s, tx) => s + baseAmt(tx), 0);

  const groups: Record<string, { total: number; count: number }> = {};
  for (const tx of filtered) {
    const key = tx.merchant || extractSourceKey(tx.description);
    if (!groups[key]) groups[key] = { total: 0, count: 0 };
    groups[key].total += baseAmt(tx);
    groups[key].count += 1;
  }

  const sources: IncomeSource[] = Object.entries(groups)
    .map(([key, data]) => ({
      key,
      label: key,
      total: data.total,
      count: data.count,
      pct: total > 0 ? (data.total / total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return { sources, total };
}

export function extractSourceKey(desc: string): string {
  const cleaned = desc
    .replace(/^(Fast Transfer From|Direct Credit|Transfer from)\s*/i, '')
    .replace(/\d{6}\s+/, '')
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 3).join(' ');
  return words || desc.slice(0, 30);
}

export function computeIncomeGrowth(txs: FinanceTransaction[], days: number = 90) {
  const current = computeIncomeBySource(txs, days);
  const prevEnd = subDays(new Date(), days);
  const prevStart = subDays(prevEnd, days);
  const prevTxs = filterTxByDateRange(txs, prevStart, prevEnd)
    .filter(tx => tx.amount > 0 && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');
  const prevTotal = prevTxs.reduce((s, tx) => s + baseAmt(tx), 0);
  if (prevTotal <= 0) return current.total > 0 ? 100 : 0;
  return ((current.total - prevTotal) / prevTotal) * 100;
}

export function computeIncomeVolatility(txs: FinanceTransaction[], categories: FinanceCategory[]) {
  const incomes = Array.from({ length: 6 }, (_, i) => computeMonthlyStats(txs, categories, i).income);
  const nonZero = incomes.filter(v => v > 0);
  if (nonZero.length < 2) return 0;
  const mean = nonZero.reduce((s, v) => s + v, 0) / nonZero.length;
  const variance = nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZero.length;
  return mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;
}

export function computeMonthlyIncomeBySource(
  txs: FinanceTransaction[],
  months: number = 6,
): { month: string; sources: Record<string, number>; total: number }[] {
  const results: { month: string; sources: Record<string, number>; total: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const { start, end } = getMonthRange(i);
    const monthLabel = format(start, 'MMM');
    const incomeTxs = filterTxByDateRange(txs, start, end)
      .filter(tx => tx.amount > 0 && !tx.is_reimbursable && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');
    const sources: Record<string, number> = {};
    let total = 0;
    for (const tx of incomeTxs) {
      const key = tx.merchant || extractSourceKey(tx.description);
      sources[key] = (sources[key] || 0) + baseAmt(tx);
      total += baseAmt(tx);
    }
    results.push({ month: monthLabel, sources, total });
  }
  return results;
}

// ---- Decision Simulator ----

export interface SimulationResult {
  currentRunway: number;
  newRunway: number;
  monthsLost: number;
  surplusConsumedPct: number;
  bufferSafe: boolean;
  newBufferMonths: number;
}

export function simulateExpense(
  totalCash: number,
  burnRate: number,
  incomeAvg: number,
  oneOffCost: number,
  monthlyRecurring: number = 0,
): SimulationResult {
  const currentRunway = burnRate > 0 ? totalCash / burnRate : Infinity;
  const newCash = totalCash - oneOffCost;
  const newBurn = burnRate + monthlyRecurring;
  const newRunway = newBurn > 0 ? newCash / newBurn : Infinity;
  const monthsLost = currentRunway - newRunway;
  const surplus = incomeAvg - burnRate;
  const surplusConsumedPct = surplus > 0 ? (monthlyRecurring / surplus) * 100 : (monthlyRecurring > 0 ? 100 : 0);
  const newBufferMonths = newBurn > 0 ? newCash / newBurn : Infinity;
  const bufferSafe = newBufferMonths >= 3;

  return {
    currentRunway: isFinite(currentRunway) ? currentRunway : 999,
    newRunway: isFinite(newRunway) ? newRunway : 999,
    monthsLost: isFinite(monthsLost) ? monthsLost : 0,
    surplusConsumedPct: isFinite(surplusConsumedPct) ? surplusConsumedPct : 0,
    bufferSafe,
    newBufferMonths: isFinite(newBufferMonths) ? newBufferMonths : 999,
  };
}

// ---- Category analysis (time-range aware) ----

export function computeCategoryBreakdown(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  days: number = 30,
) {
  const filtered = filterTxByDays(txs, days).filter(tx => tx.amount < 0 && !tx.is_reimbursable && !tx.is_transfer && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');

  const breakdown: Record<string, { name: string; total: number; count: number; type: string; catId: string; color: string | null }> = {};
  for (const tx of filtered) {
    const catId = tx.category_id || 'uncategorized';
    const cat = categories.find(c => c.id === catId);
    if (!breakdown[catId]) {
      breakdown[catId] = { name: cat?.name || 'Uncategorised', total: 0, count: 0, type: cat?.type || 'variable', catId, color: cat?.color || null };
    }
    breakdown[catId].total += Math.abs(baseAmt(tx));
    breakdown[catId].count += 1;
  }
  return Object.values(breakdown).sort((a, b) => b.total - a.total);
}

export function computeCategoryBreakdownByMonth(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  monthsBack: number = 0,
) {
  const { start, end } = getMonthRange(monthsBack);
  const monthTxs = filterTxByDateRange(txs, start, end).filter(tx => tx.amount < 0 && !tx.is_reimbursable && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');

  const breakdown: Record<string, { name: string; total: number; count: number; type: string }> = {};
  for (const tx of monthTxs) {
    const catId = tx.category_id || 'uncategorized';
    const cat = categories.find(c => c.id === catId);
    if (!breakdown[catId]) {
      breakdown[catId] = { name: cat?.name || 'Uncategorised', total: 0, count: 0, type: cat?.type || 'variable' };
    }
    breakdown[catId].total += Math.abs(baseAmt(tx));
    breakdown[catId].count += 1;
  }
  return Object.values(breakdown).sort((a, b) => b.total - a.total);
}

/** Spike detection: compare current period vs previous equivalent period */
export function computeCategorySpikeDetection(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  days: number = 90,
  threshold: number = 30,
) {
  const current = computeCategoryBreakdown(txs, categories, days);
  const prevEnd = subDays(new Date(), days);
  const prevStart = subDays(prevEnd, days);
  const prevTxs = filterTxByDateRange(txs, prevStart, prevEnd).filter(tx => tx.amount < 0 && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');

  const prevMap: Record<string, number> = {};
  for (const tx of prevTxs) {
    const catId = tx.category_id || 'uncategorized';
    const cat = categories.find(c => c.id === catId);
    const name = cat?.name || 'Uncategorised';
    prevMap[name] = (prevMap[name] || 0) + Math.abs(baseAmt(tx));
  }

  return current.map(c => {
    const prev = prevMap[c.name] || 0;
    const change = prev > 0 ? ((c.total - prev) / prev) * 100 : (c.total > 0 ? 100 : 0);
    return { ...c, previous: prev, changePct: change, isSpike: change > threshold };
  }).sort((a, b) => b.changePct - a.changePct);
}

/** Detect recurring merchants (subscriptions) */
export function detectSubscriptions(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  months: number = 3,
) {
  const merchantCounts: Record<string, { months: Set<string>; total: number; count: number; type: string }> = {};
  
  for (let i = 0; i < months; i++) {
    const { start, end } = getMonthRange(i);
    const monthLabel = format(start, 'yyyy-MM');
    const monthTxs = filterTxByDateRange(txs, start, end)
      .filter(tx => tx.amount < 0 && tx.transfer_status !== 'confirmed' && tx.transfer_status !== 'auto_confirmed');
    
    for (const tx of monthTxs) {
      const key = tx.merchant || tx.description.slice(0, 30);
      if (!merchantCounts[key]) {
        const cat = categories.find(c => c.id === tx.category_id);
        merchantCounts[key] = { months: new Set(), total: 0, count: 0, type: cat?.type || 'variable' };
      }
      merchantCounts[key].months.add(monthLabel);
      merchantCounts[key].total += Math.abs(baseAmt(tx));
      merchantCounts[key].count += 1;
    }
  }

  // A subscription = appears in 2+ of the last 3 months
  return Object.entries(merchantCounts)
    .filter(([, data]) => data.months.size >= 2)
    .map(([merchant, data]) => ({
      merchant,
      monthlyAvg: data.total / data.months.size,
      appearances: data.months.size,
      totalSpent: data.total,
      type: data.type,
    }))
    .sort((a, b) => b.monthlyAvg - a.monthlyAvg);
}

// ---- Growth metrics ----

export function computeNetCashHistory(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  months: number = 6,
) {
  let runningNet = 0;
  const history: { month: string; net: number; savings: number; savingsRate: number }[] = [];
  
  for (let i = months - 1; i >= 0; i--) {
    const stats = computeMonthlyStats(txs, categories, i);
    const savings = stats.income - stats.totalSpend;
    runningNet += savings;
    const savingsRate = stats.income > 0 ? (savings / stats.income) * 100 : 0;
    history.push({
      month: stats.month.split(' ')[0],
      net: runningNet,
      savings,
      savingsRate,
    });
  }
  return history;
}

export function computeSavingsRate(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  months: number = 3,
): number {
  const available = getAvailableMonths(txs, categories, months);
  if (available.length === 0) return 0;
  const totalIncome = available.reduce((s, m) => s + m.income, 0);
  const totalSpend = available.reduce((s, m) => s + m.totalSpend, 0);
  if (totalIncome <= 0) return 0;
  return ((totalIncome - totalSpend) / totalIncome) * 100;
}

export function computeProjection12Month(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  currentCash: number,
) {
  const fcf = computeFreeCashFlow(txs, categories, 3);
  return currentCash + (fcf * 12);
}

// ---- Legacy helpers ----

export function computeBurnRate(txs: FinanceTransaction[], categories: FinanceCategory[]) {
  return computeRollingBurnRate(txs, categories, 2);
}

export function computeRunway(totalCash: number, burnRate: { avg: number; conservative: number }) {
  return {
    avg: burnRate.avg > 0 ? totalCash / burnRate.avg : Infinity,
    conservative: burnRate.conservative > 0 ? totalCash / burnRate.conservative : Infinity,
  };
}

// Keep old name exports for compatibility
export const compute3MonthBurnRate = (txs: FinanceTransaction[], categories: FinanceCategory[]) =>
  computeRollingBurnRate(txs, categories, 3);
export const compute3MonthIncomeAvg = (txs: FinanceTransaction[], categories: FinanceCategory[]) =>
  computeRollingIncomeAvg(txs, categories, 3);

// ---- Goal planner ----

export function computeWeeklyCategoryStats(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  weeks: number = 8,
) {
  const now = new Date();
  const cuttable = categories.filter(c => c.is_cuttable && c.type !== 'income' && c.type !== 'transfer');

  return cuttable.map(cat => {
    const weeklySpends: number[] = [];
    for (let w = 0; w < weeks; w++) {
      const weekStart = startOfWeek(subWeeks(now, w), { weekStartsOn: 1 });
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const weekTxs = txs.filter(tx =>
        tx.category_id === cat.id && tx.amount < 0 &&
        new Date(tx.posted_at) >= weekStart && new Date(tx.posted_at) < weekEnd
      );
      weeklySpends.push(weekTxs.reduce((s, tx) => s + Math.abs(baseAmt(tx)), 0));
    }

    const sorted = [...weeklySpends].sort((a, b) => a - b);
    const avg = weeklySpends.reduce((s, v) => s + v, 0) / weeks;
    const median = sorted[Math.floor(sorted.length / 2)];
    const best2 = sorted.slice(0, 2);
    const bestMedian = best2.length >= 2 ? (best2[0] + best2[1]) / 2 : best2[0] || 0;
    const variance = weeklySpends.reduce((s, v) => s + (v - avg) ** 2, 0) / weeks;

    return {
      category: cat,
      weeklyAvg: avg,
      weeklyMedian: median,
      bestWeekMedian: bestMedian,
      variance,
      weeklySpends,
    };
  }).sort((a, b) => b.weeklyAvg - a.weeklyAvg);
}

export function generateGoalPlan(
  weeklyStats: ReturnType<typeof computeWeeklyCategoryStats>,
  weeklyIncome: number,
  weeklyFixedSpend: number,
  targetAmount: number,
  safetyMode: string,
) {
  const baselineSurplus = weeklyIncome - weeklyFixedSpend - weeklyStats.reduce((s, c) => s + c.weeklyAvg, 0);
  
  const recommendations = weeklyStats
    .filter(s => s.weeklyAvg > 5)
    .slice(0, 5)
    .map(s => {
      const easy = s.weeklyAvg * 0.9;
      const medium = s.weeklyAvg * 0.8;
      const aggressiveFloor = s.weeklyAvg * 0.75;
      const aggressive = Math.max(s.bestWeekMedian, aggressiveFloor);
      
      return {
        categoryId: s.category.id,
        categoryName: s.category.name,
        currentWeeklyAvg: Math.round(s.weeklyAvg * 100) / 100,
        caps: {
          easy: { cap: Math.round(easy * 100) / 100, saving: Math.round((s.weeklyAvg - easy) * 100) / 100 },
          medium: { cap: Math.round(medium * 100) / 100, saving: Math.round((s.weeklyAvg - medium) * 100) / 100 },
          aggressive: { cap: Math.round(aggressive * 100) / 100, saving: Math.round((s.weeklyAvg - aggressive) * 100) / 100 },
        },
      };
    });

  const modeKey = safetyMode === 'conservative' ? 'easy' : safetyMode === 'yolo' ? 'aggressive' : 'medium';
  const totalWeeklySavings = recommendations.reduce((s, r) => s + r.caps[modeKey].saving, 0);
  const effectiveWeeklySavings = baselineSurplus + totalWeeklySavings;
  const estWeeks = effectiveWeeklySavings > 0 ? Math.ceil(targetAmount / effectiveWeeklySavings) : 9999;

  return {
    baselineWeeklySurplus: Math.round(baselineSurplus * 100) / 100,
    suggestedWeeklySavings: Math.round(effectiveWeeklySavings * 100) / 100,
    estWeeksToGoal: estWeeks,
    recommendations,
    modeKey,
  };
}

export function formatCurrency(amount: number, currency: string = 'AUD'): string {
  const symbols: Record<string, string> = { GBP: '£', EUR: '€', AUD: 'A$', USD: 'US$', NZD: 'NZ$' };
  const symbol = symbols[currency] || `${currency} `;
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---- Cashflow helpers ----

export function remainingWeeksInMonth(): number {
  const now = new Date();
  const end = endOfMonth(now);
  const daysLeft = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  return Math.max(1, daysLeft / 7);
}

export function avgWeeklyVariableSpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  weeks: number = 8,
): number {
  const now = new Date();
  const start = startOfWeek(subWeeks(now, weeks), { weekStartsOn: 1 });
  const relevant = txs.filter(tx => {
    if (tx.is_transfer || tx.transfer_group_id || tx.amount >= 0) return false;
    const cat = categories.find(c => c.id === tx.category_id);
    if (tx.is_fixed || cat?.type === 'fixed') return false;
    const d = new Date(tx.posted_at);
    if (isExcludedSpendDate(d)) return false;
    return d >= start;
  });

  const total = relevant.reduce((s, tx) => s + Math.abs(baseAmt(tx)), 0);
  return total / weeks;
}

export function computeSafeToSpend(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
): { safeToSpend: number; weeklyBaseline: number; spentThisWeek: number } {
  const weeklyBaseline = avgWeeklyVariableSpend(txs, categories, 8);
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const spentThisWeek = txs
    .filter(tx => {
      if (tx.is_transfer || tx.transfer_group_id || tx.amount >= 0) return false;
      const cat = categories.find(c => c.id === tx.category_id);
      if (tx.is_fixed || cat?.type === 'fixed') return false;
      return new Date(tx.posted_at) >= weekStart;
    })
    .reduce((s, tx) => s + Math.abs(baseAmt(tx)), 0);

  return {
    safeToSpend: Math.max(0, weeklyBaseline - spentThisWeek),
    weeklyBaseline,
    spentThisWeek,
  };
}

export function computeCategoryChanges(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
): Array<{ name: string; current: number; previous: number; change: number; pctChange: number }> {
  const curr = computeCategoryBreakdownByMonth(txs, categories, 0);
  const prev = computeCategoryBreakdownByMonth(txs, categories, 1);
  const prevMap = new Map(prev.map(c => [c.name, c.total]));

  return curr.map(c => {
    const previous = prevMap.get(c.name) || 0;
    const change = c.total - previous;
    const pctChange = previous > 0 ? (change / previous) * 100 : (c.total > 0 ? 100 : 0);
    return { name: c.name, current: c.total, previous, change, pctChange };
  }).sort((a, b) => b.pctChange - a.pctChange);
}

export function computeCuttablePercent(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
): number {
  const breakdown = computeCategoryBreakdownByMonth(txs, categories, 0);
  const totalSpend = breakdown.reduce((s, c) => s + c.total, 0);
  if (totalSpend <= 0) return 0;
  const cuttableCatNames = new Set(categories.filter(c => c.is_cuttable).map(c => c.name));
  const cuttableSpend = breakdown.filter(c => cuttableCatNames.has(c.name)).reduce((s, c) => s + c.total, 0);
  return (cuttableSpend / totalSpend) * 100;
}

export function computeFixedTotal(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
): number {
  const { start, end } = getMonthRange(0);
  return filterTxByDateRange(txs, start, end)
    .filter(tx => {
      if (tx.is_transfer || tx.transfer_group_id || tx.amount >= 0) return false;
      const cat = categories.find(c => c.id === tx.category_id);
      return tx.is_fixed || cat?.type === 'fixed';
    })
    .reduce((s, tx) => s + Math.abs(baseAmt(tx)), 0);
}
