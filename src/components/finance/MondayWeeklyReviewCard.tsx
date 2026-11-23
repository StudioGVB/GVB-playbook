import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PartyPopper, Sparkles, X, Calendar, Eye, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import { computeWeekVariableSpend, type PolicySnapshot } from '@/lib/policyEngine';
import { deduplicateTransactions } from '@/lib/deduplication';
import { parseCoverMeta, type CoverMeta } from '@/lib/overspendCover';
import { startOfWeek, subWeeks, format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  assumptions: FinanceAssumptions | null;
  trips?: FinanceTrip[];
  forceShow?: boolean;
  snapshot?: PolicySnapshot | null;
  syncingBanks?: boolean;
}

export interface MondayReviewSnapshot {
  weekKey: string;
  totalSpent: number;
  totalBudget: number;
  funSpent: number;
  essentialSpent: number;
  netDifference: number;
  isTotalOver: boolean;
  totalOverAmount: number;
  totalUnderAmount: number;
  status: 'settled' | 'reconciled' | 'pending';
  closedRecordSpent?: number;
  updatedAt: string;
}

export function MondayWeeklyReviewCard({ finance, assumptions, trips = [], forceShow = false, snapshot, syncingBanks = false }: Props) {
  const navigate = useNavigate();
  const now = new Date();
  const isMonday = now.getDay() === 1;

  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekKey = format(currentWeekStart, 'yyyy-MM-dd');

  // Dismissal state per week
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    return localStorage.getItem(`gvb_monday_review_dismissed_${weekKey}`) === 'true';
  });

  const baseCurrency = finance?.settings?.base_currency || 'GBP';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Dates for last week (Monday to Sunday)
  const lastWeekStart = subWeeks(currentWeekStart, 1);
  const lastWeekKey = format(lastWeekStart, 'yyyy-MM-dd');
  const lastWeekSunday = new Date(currentWeekStart.getTime() - 1000 * 60 * 60 * 24);
  const dateRangeLabel = `${format(lastWeekStart, 'MMM d')} – ${format(lastWeekSunday, 'MMM d, yyyy')}`;

  // Find closed/locked settlement record from Savings Stash
  const stashGoal = useMemo(() => {
    return finance?.goals?.find(g => (g as any).is_stash === true || (g.name || '').toLowerCase().includes('stash')) || null;
  }, [finance?.goals]);
  const meta: CoverMeta = useMemo(() => parseCoverMeta(stashGoal?.description), [stashGoal?.description]);
  const closedRecord = meta.closed_weeks?.[lastWeekKey];

  // Local storage cached snapshot: prevents jumping / flapping numbers on app open
  const [cachedSnapshot, setCachedSnapshot] = useState<MondayReviewSnapshot | null>(() => {
    try {
      const stored = localStorage.getItem(`gvb_monday_recap_snapshot_${lastWeekKey}`);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Calculate fresh stats only when bank sync and loading have settled
  const computedStats = useMemo<MondayReviewSnapshot | null>(() => {
    const hasTxs = Boolean(finance?.transactions && finance.transactions.length > 0);
    if (finance?.loading || syncingBanks || !hasTxs) {
      return null;
    }

    const { cleaned: dedupedTxs } = deduplicateTransactions(finance.transactions);
    const summary = computeWeekVariableSpend(
      dedupedTxs,
      finance.categories || [],
      lastWeekStart,
      trips,
    );

    const weeklyFunBudget = closedRecord
      ? (closedRecord.baseFunBudget + closedRecord.boost)
      : (snapshot?.weeklyFunBudget ?? snapshot?.baseWeeklyFun ?? assumptions?.weekly_fun_budget ?? 100);

    const weeklyEssentialBudget = closedRecord
      ? closedRecord.essentialBudget
      : (snapshot?.weeklyEssentialBudget ?? ((assumptions?.estimated_essential_variable ?? 300) / 4.33));

    const totalBudget = closedRecord ? closedRecord.totalBudget : (weeklyFunBudget + weeklyEssentialBudget);

    const liveTotalSpent = summary.totalSpent;
    const liveFunSpent = summary.funSpent;
    const liveEssentialSpent = summary.essentialSpent;

    let status: 'settled' | 'reconciled' | 'pending' = 'pending';
    let totalSpent = liveTotalSpent;
    let netDifference = totalBudget - liveTotalSpent;

    if (closedRecord) {
      const diffFromSettlement = Math.abs(liveTotalSpent - closedRecord.totalSpent);
      if (diffFromSettlement < 0.50) {
        // Matches official Sunday settlement
        status = 'settled';
        totalSpent = closedRecord.totalSpent;
        netDifference = closedRecord.netDifference;
      } else {
        // Legitimate transaction changes made after settlement
        status = 'reconciled';
        totalSpent = liveTotalSpent;
        netDifference = totalBudget - liveTotalSpent;
      }
    }

    const isTotalOver = netDifference < 0;
    const totalOverAmount = isTotalOver ? Math.abs(netDifference) : 0;
    const totalUnderAmount = isTotalOver ? 0 : Math.max(0, netDifference);

    return {
      weekKey: lastWeekKey,
      totalSpent,
      totalBudget,
      funSpent: status === 'settled' && closedRecord ? closedRecord.funSpent : liveFunSpent,
      essentialSpent: status === 'settled' && closedRecord ? closedRecord.essentialSpent : liveEssentialSpent,
      netDifference,
      isTotalOver,
      totalOverAmount,
      totalUnderAmount,
      status,
      closedRecordSpent: closedRecord?.totalSpent,
      updatedAt: new Date().toISOString(),
    };
  }, [
    finance?.loading,
    syncingBanks,
    finance?.transactions,
    finance?.categories,
    closedRecord,
    lastWeekStart,
    trips,
    snapshot,
    assumptions,
    lastWeekKey,
  ]);

  // Sync to cache when fresh computed stats arrive
  useEffect(() => {
    if (computedStats) {
      setCachedSnapshot(computedStats);
      try {
        localStorage.setItem(`gvb_monday_recap_snapshot_${lastWeekKey}`, JSON.stringify(computedStats));
      } catch (e) {
        console.error('Failed to cache Monday review snapshot', e);
      }
    }
  }, [computedStats, lastWeekKey]);

  // Use computed stats if available, otherwise fallback to cached snapshot so numbers never jitter
  const activeStats = computedStats || cachedSnapshot;

  // Only render on Mondays unless forceShow is active or toggled
  if (!isMonday && !forceShow) {
    return null;
  }

  if (isDismissed && !forceShow) {
    return null;
  }

  // If completely empty and still loading with no cache, wait until ready
  if (!activeStats) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(`gvb_monday_review_dismissed_${weekKey}`, 'true');
    setIsDismissed(true);
  };

  const {
    totalSpent,
    totalBudget,
    isTotalOver,
    totalOverAmount,
    totalUnderAmount,
    status,
    closedRecordSpent,
  } = activeStats;

  const isSyncing = finance?.loading || syncingBanks;

  return (
    <div className="relative group my-3">
      <Card
        className={`relative overflow-hidden border-2 transition-all duration-300 shadow-md ${
          isTotalOver
            ? 'bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-amber-500/5 border-amber-300/50'
            : 'bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-emerald-500/10 border-emerald-400/50'
        } rounded-3xl p-5 sm:p-7 text-slate-800`}
      >
        {/* Ambient background glow */}
        <div
          className={`absolute -top-12 -right-12 w-48 h-48 rounded-full filter blur-3xl pointer-events-none ${
            isTotalOver ? 'bg-amber-400/15' : 'bg-emerald-500/15'
          }`}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Main Copy & Badge */}
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={`px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-xl border flex items-center gap-1.5 ${
                  isTotalOver
                    ? 'bg-amber-100 text-amber-800 border-amber-300/60'
                    : 'bg-emerald-500/15 text-emerald-700 border-emerald-400/30'
                }`}
              >
                {isTotalOver ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                    Monday Weekly Review · Slightly Over Budget
                  </>
                ) : (
                  <>
                    <PartyPopper className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                    Monday Weekly Review · Great Job!
                  </>
                )}
              </Badge>

              {/* Settlement / Reconciliation Status Pill */}
              {status === 'settled' && (
                <Badge
                  variant="outline"
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-xl border bg-white/80 text-emerald-800 border-emerald-300/60 flex items-center gap-1 shadow-xs"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Settled to Stash
                </Badge>
              )}

              {status === 'reconciled' && (
                <Badge
                  variant="outline"
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-xl border bg-blue-50 text-blue-800 border-blue-300/60 flex items-center gap-1 shadow-xs"
                >
                  <RefreshCw className="w-3 h-3 text-blue-600" />
                  Reconciled with Recent Edits
                </Badge>
              )}

              {status === 'pending' && (
                <Badge
                  variant="outline"
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-xl border bg-slate-100 text-slate-700 border-slate-300/60 flex items-center gap-1 shadow-xs"
                >
                  Pending Sunday Settlement
                </Badge>
              )}

              <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                {dateRangeLabel}
              </span>

              {isSyncing && (
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1 ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Verifying bank sync...
                </span>
              )}
            </div>

            {/* Headline message */}
            <div>
              {isTotalOver ? (
                <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight leading-snug">
                  You were just <span className="text-amber-700 font-black">{fmt(totalOverAmount)}</span> over your {fmt(totalBudget)} budget last week
                </h2>
              ) : (
                <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight leading-snug">
                  Congrats! You finished <span className="text-emerald-600">{fmt(totalUnderAmount)} under</span> your weekly budget last week! 🎉
                </h2>
              )}

              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                {isTotalOver
                  ? `No stress at all — your Savings Stash automatically covers this ${fmt(totalOverAmount)} so your savings pools and long-term plans stay 100% on track.`
                  : `You stayed under your ${fmt(totalBudget)} weekly budget. Your leftover savings have been swept into your Savings Stash!`}
              </p>

              {/* Reconciliation note if transactions were adjusted after Sunday settlement */}
              {status === 'reconciled' && typeof closedRecordSpent === 'number' && (
                <div className="mt-3 p-3 rounded-2xl bg-white/80 backdrop-blur-sm border border-blue-200/80 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
                  <div className="flex items-start gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-bold text-slate-900">Live reconciliation:</span> Settled Sunday at {fmt(closedRecordSpent)}, but transactions were adjusted by {fmt(Math.abs(totalSpent - closedRecordSpent))} since then.
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/finance/budget')}
                    className="h-7 px-2.5 text-xs text-blue-700 hover:text-blue-900 font-semibold hover:bg-blue-50 rounded-lg shrink-0 gap-1"
                  >
                    Update Stash in Budget
                    <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex flex-col sm:flex-row md:flex-col items-stretch sm:items-center md:items-end gap-3.5 shrink-0 w-full md:w-auto">
            {/* Stat Pill */}
            <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-4 shadow-sm w-full md:min-w-[220px] flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Spent</p>
                <p className="text-lg font-display font-black text-slate-900 tabular-nums">{fmt(totalSpent)}</p>
                <p className="text-[10px] text-slate-500 font-medium">Budget was {fmt(totalBudget)}</p>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                  isTotalOver ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {isTotalOver ? `+${fmt(totalOverAmount)} over` : `${fmt(totalUnderAmount)} saved`}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 w-full">
              {status === 'pending' ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => navigate('/finance/budget')}
                  className="flex-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm gap-1.5 h-9"
                >
                  Settle in Budget
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/finance/transactions')}
                  className="flex-1 rounded-xl border-slate-200 bg-white/90 hover:bg-white text-xs font-semibold text-slate-700 shadow-sm gap-1.5 h-9"
                >
                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                  View Transactions
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                className="rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white/80 h-9 px-3 text-xs gap-1 border border-slate-200/60 bg-white/50"
                title="Dismiss review for this week"
              >
                <X className="w-4 h-4" />
                <span className="text-xs">Dismiss</span>
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
