import { startOfDay, startOfWeek, isSameDay, format } from 'date-fns';
import { parseUkDate, formatCurrency, baseAmt } from './financeUtils';
import { sendLocalNotification } from './notifications';
import type { FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';
import type { PolicySnapshot } from './policyEngine';

export interface DailySummaryData {
  todaySpent: number;
  weekSpent: number;
  weeklyBudget: number;
  diff: number;
  isUnderBudget: boolean;
  title: string;
  body: string;
}

/** Compute today's and this week's spend vs weekly budget tracking */
export function computeDaily8pmSummary(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  snapshot: PolicySnapshot | null,
  baseCurrency: string = 'GBP'
): DailySummaryData {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  const catMap = new Map(categories.map(c => [c.id, c]));

  let todaySpent = 0;
  let weekSpent = 0;

  for (const tx of transactions) {
    if (tx.amount >= 0) continue; // Skip income & transfers
    if (tx.is_transfer || tx.is_reimbursable || tx.is_fixed) continue;
    if ((tx as any).goal_id || (tx as any).is_travel_spend || (tx as any).trip_id) continue;

    const cat = catMap.get(tx.category_id || '');
    if (cat?.exclude_from_reports || cat?.type === 'transfer' || cat?.type === 'income' || cat?.type === 'fixed') continue;

    const txDate = parseUkDate(tx.posted_at);
    const absAmt = Math.abs(baseAmt(tx));

    // Check if posted this week
    if (txDate >= weekStart && txDate <= now) {
      weekSpent += absAmt;
    }

    // Check if posted today
    if (isSameDay(txDate, now)) {
      todaySpent += absAmt;
    }
  }

  // Calculate total weekly allowance (Essential Variable + Fun Money)
  const weeklyEssential = snapshot?.weeklyEssentialBudget ?? 115;
  const weeklyFun = snapshot?.baseWeeklyFun ?? 100;
  const weeklyBudget = weeklyEssential + weeklyFun;

  const diff = weeklyBudget - weekSpent;
  const isUnderBudget = diff >= 0;

  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const todayStr = fmt(todaySpent);
  const weekStr = fmt(weekSpent);
  const diffStr = fmt(Math.abs(diff));

  let body = '';
  if (isUnderBudget) {
    body = `Today you have spent ${todayStr}, this week you have spent ${weekStr}. Yay! You are ${diffStr} under budget for this week. 🎉`;
  } else {
    body = `Today you have spent ${todayStr}, this week you have spent ${weekStr}. Heads up! You are ${diffStr} over budget for this week. ⚠️`;
  }

  return {
    todaySpent,
    weekSpent,
    weeklyBudget,
    diff,
    isUnderBudget,
    title: '🌙 8 PM Budget Update',
    body,
  };
}

/** Check if current time is >= 8 PM local time and trigger notification if not sent today */
export async function checkAndTriggerDaily8pmNotification(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  snapshot: PolicySnapshot | null,
  baseCurrency: string = 'GBP'
): Promise<boolean> {
  const isEnabled = localStorage.getItem('gvb_daily_8pm_notif') !== 'false';
  if (!isEnabled) return false;

  const now = new Date();
  const currentHour = now.getHours();

  // Trigger at or after 8:00 PM (20:00)
  if (currentHour < 20) return false;

  const todayIso = format(now, 'yyyy-MM-dd');
  const lastSentIso = localStorage.getItem('gvb_last_8pm_notif_date');

  if (lastSentIso === todayIso) {
    return false; // Already sent today
  }

  const summary = computeDaily8pmSummary(transactions, categories, snapshot, baseCurrency);
  const sent = await sendLocalNotification(summary.title, {
    body: summary.body,
    icon: '/favicon.png',
    url: '/finance/budget',
    tag: `gvb-8pm-${todayIso}`,
  });

  if (sent) {
    localStorage.setItem('gvb_last_8pm_notif_date', todayIso);
  }

  return sent;
}

/** Trigger an instant preview of the 8 PM daily update notification */
export async function triggerPreview8pmNotification(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  snapshot: PolicySnapshot | null,
  baseCurrency: string = 'GBP'
): Promise<boolean> {
  const summary = computeDaily8pmSummary(transactions, categories, snapshot, baseCurrency);
  return sendLocalNotification(summary.title, {
    body: summary.body,
    icon: '/favicon.png',
    url: '/finance/budget',
    tag: 'gvb-8pm-preview',
  });
}

export interface NightlySummaryData {
  remaining: number;
  status: 'take_it_easy' | 'go_crazy' | 'right_on_track';
  title: string;
  body: string;
}

/** Compute 9:55 PM weekly budget remaining status: [take it easy / go crazy / right on track] */
export function computeDaily955pmSummary(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  snapshot: PolicySnapshot | null,
  baseCurrency: string = 'GBP'
): NightlySummaryData {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const catMap = new Map(categories.map(c => [c.id, c]));

  let weekSpent = 0;
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (tx.is_transfer || tx.is_reimbursable || tx.is_fixed) continue;
    if ((tx as any).goal_id || (tx as any).is_travel_spend || (tx as any).trip_id) continue;

    const cat = catMap.get(tx.category_id || '');
    if (cat?.exclude_from_reports || cat?.type === 'transfer' || cat?.type === 'income' || cat?.type === 'fixed') continue;

    const txDate = parseUkDate(tx.posted_at);
    if (txDate >= weekStart && txDate <= now) {
      weekSpent += Math.abs(baseAmt(tx));
    }
  }

  const weeklyEssential = snapshot?.weeklyEssentialBudget ?? 115;
  const weeklyFun = snapshot?.baseWeeklyFun ?? 100;
  const weeklyBudget = weeklyEssential + weeklyFun;

  const remaining = weeklyBudget - weekSpent;
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  let statusText = '';
  let status: 'take_it_easy' | 'go_crazy' | 'right_on_track' = 'right_on_track';

  if (remaining < 0) {
    status = 'take_it_easy';
    statusText = 'take it easy 🧘';
  } else if (remaining >= weeklyBudget * 0.35) {
    status = 'go_crazy';
    statusText = 'go crazy! 🎉';
  } else {
    status = 'right_on_track';
    statusText = 'right on track 👍';
  }

  const body = `You have ${fmt(remaining)} amount of money remaining for the week — ${statusText}`;

  return {
    remaining,
    status,
    title: '✨ 9:55 PM Weekly Budget Check',
    body,
  };
}

/** Check if current time is >= 9:55 PM local time and trigger notification if not sent today */
export async function checkAndTriggerDaily955pmNotification(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  snapshot: PolicySnapshot | null,
  baseCurrency: string = 'GBP'
): Promise<boolean> {
  const isEnabled = localStorage.getItem('gvb_daily_955pm_notif') !== 'false';
  if (!isEnabled) return false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Trigger at or after 9:55 PM (21:55)
  if (currentHour < 21 || (currentHour === 21 && currentMinute < 55)) return false;

  const todayIso = format(now, 'yyyy-MM-dd');
  const lastSentIso = localStorage.getItem('gvb_last_955pm_notif_date');

  if (lastSentIso === todayIso) {
    return false; // Already sent today
  }

  const summary = computeDaily955pmSummary(transactions, categories, snapshot, baseCurrency);
  const sent = await sendLocalNotification(summary.title, {
    body: summary.body,
    icon: '/favicon.png',
    url: '/finance/budget',
    tag: `gvb-955pm-${todayIso}`,
  });

  if (sent) {
    localStorage.setItem('gvb_last_955pm_notif_date', todayIso);
  }

  return sent;
}

/** Trigger an instant preview of the 9:55 PM weekly budget check notification */
export async function triggerPreview955pmNotification(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  snapshot: PolicySnapshot | null,
  baseCurrency: string = 'GBP'
): Promise<boolean> {
  const summary = computeDaily955pmSummary(transactions, categories, snapshot, baseCurrency);
  return sendLocalNotification(summary.title, {
    body: summary.body,
    icon: '/favicon.png',
    url: '/finance/budget',
    tag: 'gvb-955pm-preview',
  });
}

