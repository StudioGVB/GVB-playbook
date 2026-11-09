import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PartyPopper, AlertTriangle, Sparkles, X, Calendar, ChevronRight, Eye } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import { computeWeekVariableSpend, type PolicySnapshot } from '@/lib/policyEngine';
import { startOfWeek, subWeeks, format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  assumptions: FinanceAssumptions | null;
  trips?: FinanceTrip[];
  forceShow?: boolean;
  snapshot?: PolicySnapshot | null;
}

export function MondayWeeklyReviewCard({ finance, assumptions, trips = [], forceShow = false, snapshot }: Props) {
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
  const lastWeekSunday = new Date(currentWeekStart.getTime() - 1000 * 60 * 60 * 24);
  const dateRangeLabel = `${format(lastWeekStart, 'MMM d')} – ${format(lastWeekSunday, 'MMM d, yyyy')}`;

  // Calculate last week's spending using the unified weekly spend helper
  const lastWeekStats = useMemo(() => {
    const summary = computeWeekVariableSpend(
      finance?.transactions || [],
      finance?.categories || [],
      lastWeekStart,
      trips,
    );
    const funSpent = summary.funSpent;
    const essentialSpent = summary.essentialSpent;

    const weeklyFunBudget = snapshot?.weeklyFunBudget ?? snapshot?.baseWeeklyFun ?? assumptions?.weekly_fun_budget ?? 100;
    const weeklyEssentialBudget = snapshot?.weeklyEssentialBudget ?? ((assumptions?.estimated_essential_variable ?? 300) / 4.33);

    // Total variable spend comparison (matches Weekly Budget & Spending History)
    const totalSpent = summary.totalSpent;
    const totalBudget = weeklyFunBudget + weeklyEssentialBudget;
    const totalDiff = totalBudget - totalSpent;
    const isTotalOver = totalDiff < 0;
    const totalOverAmount = Math.abs(totalDiff);
    const totalUnderAmount = Math.max(0, totalDiff);

    return {
      funSpent,
      essentialSpent,
      totalSpent,
      weeklyFunBudget,
      weeklyEssentialBudget,
      totalBudget,
      isTotalOver,
      totalOverAmount,
      totalUnderAmount,
      totalDiff,
    };
  }, [finance?.transactions, finance?.categories, lastWeekStart, trips, assumptions, snapshot]);

  // Only render on Mondays unless forceShow is active or toggled
  if (!isMonday && !forceShow) {
    return null;
  }

  if (isDismissed && !forceShow) {
    return null;
  }

  // Prevent premature zero-spend calculation while transactions are still loading
  if (finance?.loading || !snapshot || (finance.accounts && finance.accounts.length > 0 && (!finance.transactions || finance.transactions.length === 0))) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(`gvb_monday_review_dismissed_${weekKey}`, 'true');
    setIsDismissed(true);
  };

  const { totalSpent, totalBudget, isTotalOver, totalOverAmount, totalUnderAmount } = lastWeekStats;

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

              <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                {dateRangeLabel}
              </span>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/finance/transactions')}
                className="flex-1 rounded-xl border-slate-200 bg-white/90 hover:bg-white text-xs font-semibold text-slate-700 shadow-sm gap-1.5 h-9"
              >
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                View Transactions
              </Button>
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
