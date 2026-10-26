import { differenceInCalendarDays } from 'date-fns';

export interface ClosedWeekRecord {
  essentialBudget: number;
  baseFunBudget: number;
  boost: number;
  totalBudget: number;
  essentialSpent: number;
  funSpent: number;
  totalSpent: number;
  netDifference: number;
}

/** Metadata stored as JSON in the Savings Stash goal's `description` (no DB migration needed). */
export interface CoverMeta {
  user_description?: string;
  last_settled_week?: string;
  settled_version?: number;
  last_settled_stash_delta?: number;
  /** Immutable budget/spend records for closed weeks so past weeks never drift */
  closed_weeks?: Record<string, ClosedWeekRecord>;
  /** goalId -> amount borrowed and not yet repaid */
  borrowed?: Record<string, number>;
  /** goalIds the user has protected from overspend cover */
  protected?: string[];
  /** Summary of the most recent settle, for the UI card */
  last_cover?: {
    week: string;
    overspend: number;
    steps: CoverStep[];
    leftoverDebt: number;
  } | null;
}

export interface CoverStep {
  source: 'stash' | 'next_week' | 'pot' | 'repay';
  goalId?: string;
  name: string;
  amount: number;
}

export function parseCoverMeta(description?: string | null): CoverMeta {
  if (!description) return {};
  try {
    const p = JSON.parse(description);
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

interface GoalLike {
  id: string;
  name: string;
  assigned_amount?: number | null;
  priority?: number | null;
  deadline?: string | null;
  is_stash?: boolean;
  is_emergency?: boolean;
}

interface TripLike {
  goal_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export const NEXT_WEEK_CAP = 0.5;
export const PROTECT_WINDOW_DAYS = 28;

const round2 = (n: number) => Math.round(n * 100) / 100;

const isEmergency = (g: GoalLike) => g.is_emergency === true || /emergency/i.test(g.name);
const isStash = (g: GoalLike) => g.is_stash === true || /stash/i.test(g.name);

/** Why a pot can't be drawn from (null = available). */
export function protectionReason(
  g: GoalLike,
  meta: CoverMeta,
  trips: TripLike[],
  now: Date,
): string | null {
  if (isEmergency(g)) return 'Emergency — never used';
  if ((meta.protected || []).includes(g.id)) return 'Protected';
  const trip = trips.find(t => t.goal_id === g.id);
  if (trip?.start_date) {
    const start = new Date(trip.start_date);
    const end = trip.end_date ? new Date(trip.end_date) : start;
    if (end >= now && differenceInCalendarDays(start, now) <= PROTECT_WINDOW_DAYS) return 'Trip soon';
  }
  if (g.deadline) {
    const days = differenceInCalendarDays(new Date(g.deadline), now);
    if (days >= 0 && days <= PROTECT_WINDOW_DAYS) return 'Deadline soon';
  }
  return null;
}

/** Pots in drain order: lowest importance first (highest priority number), then most recently created last. */
export function coverOrder(goals: GoalLike[]): GoalLike[] {
  return goals
    .filter(g => !isStash(g) && !isEmergency(g))
    .sort((a, b) => (b.priority ?? 99) - (a.priority ?? 99));
}

/**
 * Overspend waterfall:
 *  1. Savings Stash
 *  2. Next week's fun money, capped at NEXT_WEEK_CAP
 *  3. Pots, lowest priority first (skipping protected / trip-soon / deadline-soon / emergency)
 *  4. Remainder stays as carry-forward debt
 */
export function planOverspendCover(params: {
  overspend: number;
  stash: GoalLike | null;
  nextWeekFun: number;
  goals: GoalLike[];
  trips: TripLike[];
  meta: CoverMeta;
  now: Date;
}): { steps: CoverStep[]; nextWeekDeduction: number; leftoverDebt: number } {
  const { stash, nextWeekFun, goals, trips, meta, now } = params;
  let left = round2(params.overspend);
  const steps: CoverStep[] = [];

  // 1. Stash
  const stashBal = Math.max(0, stash?.assigned_amount || 0);
  if (left > 0 && stash && stashBal > 0) {
    const take = round2(Math.min(left, stashBal));
    steps.push({ source: 'stash', goalId: stash.id, name: 'Savings Stash', amount: take });
    left = round2(left - take);
  }

  // 2. Next week (capped)
  let nextWeekDeduction = 0;
  if (left > 0) {
    nextWeekDeduction = round2(Math.min(left, Math.max(0, nextWeekFun) * NEXT_WEEK_CAP));
    if (nextWeekDeduction > 0) {
      steps.push({ source: 'next_week', name: "Next week's fun money", amount: nextWeekDeduction });
      left = round2(left - nextWeekDeduction);
    }
  }

  // 3. Pots
  if (left > 0) {
    for (const g of coverOrder(goals)) {
      if (left <= 0) break;
      if (protectionReason(g, meta, trips, now)) continue;
      const bal = Math.max(0, g.assigned_amount || 0);
      if (bal <= 0) continue;
      const take = round2(Math.min(left, bal));
      steps.push({ source: 'pot', goalId: g.id, name: g.name, amount: take });
      left = round2(left - take);
    }
  }

  // 4. Leftover stays as debt (on top of the capped next-week deduction)
  return { steps, nextWeekDeduction, leftoverDebt: Math.max(0, left) };
}

/** Underspend repays borrowed pots first — most important (lowest priority number) first. */
export function planUnderspendRepay(params: {
  underspend: number;
  goals: GoalLike[];
  meta: CoverMeta;
}): { steps: CoverStep[]; remainder: number; borrowed: Record<string, number> } {
  let left = round2(params.underspend);
  const borrowed = { ...(params.meta.borrowed || {}) };
  const steps: CoverStep[] = [];
  const owed = params.goals
    .filter(g => (borrowed[g.id] || 0) > 0)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  for (const g of owed) {
    if (left <= 0) break;
    const pay = round2(Math.min(left, borrowed[g.id]));
    steps.push({ source: 'repay', goalId: g.id, name: g.name, amount: pay });
    borrowed[g.id] = round2(borrowed[g.id] - pay);
    if (borrowed[g.id] <= 0) delete borrowed[g.id];
    left = round2(left - pay);
  }
  // Drop ledger entries for deleted goals
  for (const id of Object.keys(borrowed)) {
    if (!params.goals.some(g => g.id === id)) delete borrowed[id];
  }
  return { steps, remainder: Math.max(0, left), borrowed };
}
