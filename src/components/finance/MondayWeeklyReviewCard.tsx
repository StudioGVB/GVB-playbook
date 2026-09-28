import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PartyPopper, AlertTriangle, Sparkles, X, Calendar, ChevronRight, Eye } from 'lucide-react';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import { startOfWeek, subWeeks, format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  assumptions: FinanceAssumptions | null;
  trips?: FinanceTrip[];
  forceShow?: boolean;
}

export function MondayWeeklyReviewCard({ finance, assumptions, trips = [], forceShow = false }: Props) {
  const navigate = useNavigate();
  const now = new Date();
  const isMonday = now.getDay() === 1;

  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekKey = format(currentWeekStart, 'yyyy-MM-dd');

  // Dismissal state per week
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    return localStorage.getItem(`gvb_monday_review_dismissed_${weekKey}`) === 'true';
  });

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Dates for last week (Monday to Sunday)
  const lastWeekStart = subWeeks(currentWeekStart, 1);
  const lastWeekEnd = currentWeekStart;
  const lastWeekSunday = new Date(currentWeekStart.getTime() - 1000 * 60 * 60 * 24);
  const dateRangeLabel = `${format(lastWeekStart, 'MMM d')} – ${format(lastWeekSunday, 'MMM d, yyyy')}`;

  // Calculate last week's spending
  const lastWeekStats = useMemo(() => {
    let funSpent = 0;
    let essentialSpent = 0;

    for (const tx of finance.transactions) {
      if (tx.is_transfer || tx.is_reimbursable || tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
      if (tx.goal_id) continue;
      if ((tx as any).is_travel_spend || (tx as any).trip_id) continue;

      const cat = finance.categories.find(c => c.id === tx.category_id);
      if (cat?.exclude_from_reports || cat?.type === 'transfer') continue;

      const txDate = new Date(tx.posted_at);
      if (txDate < lastWeekStart || txDate >= lastWeekEnd) continue;

      // Check if refund
      if ((tx as any).is_refund && tx.amount > 0) {
        if (cat?.is_essential) {
          essentialSpent -= Math.abs(baseAmt(tx));
        } else {
          funSpent -= Math.abs(baseAmt(tx));
        }
        continue;
      }

      if (tx.amount >= 0) continue;
      if (tx.is_fixed || cat?.type === 'fixed' || cat?.type === 'income') continue;

      const amt = Math.abs(baseAmt(tx));
      if (cat?.is_essential) {
        essentialSpent += amt;
      } else {
        funSpent += amt;
      }
    }

    const weeklyFunBudget = assumptions?.weekly_fun_budget ?? 100;
    const weeklyEssentialBudget = (assumptions?.estimated_essential_variable ?? 300);
    
    // Fun spend comparison (discretionary)
    const funDiff = weeklyFunBudget - funSpent;
    const isFunOver = funDiff < 0;
    const funOverAmount = Math.abs(funDiff);
    const funUnderAmount = Math.max(0, funDiff);

    // Total variable spend comparison
    const totalSpent = funSpent + essentialSpent;
    const totalBudget = weeklyFunBudget + weeklyEssentialBudget;
    const totalDiff = totalBudget - totalSpent;
    const isTotalOver = totalDiff < 0;

    return {
      funSpent,
      essentialSpent,
      totalSpent,
      weeklyFunBudget,
      weeklyEssentialBudget,
      totalBudget,
      isFunOver,
      funOverAmount,
      funUnderAmount,
      isTotalOver,
      totalDiff,
    };
  }, [finance.transactions, finance.categories, lastWeekStart, lastWeekEnd, assumptions]);

  // Only render on Mondays unless forceShow is active or toggled
  if (!isMonday && !forceShow) {
    return null;
  }

  if (isDismissed && !forceShow) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(`gvb_monday_review_dismissed_${weekKey}`, 'true');
    setIsDismissed(true);
  };

  const { funSpent, weeklyFunBudget, isFunOver, funOverAmount, funUnderAmount } = lastWeekStats;

  return (
    <div className="relative group my-2">
      <Card
        className={`relative overflow-hidden border-2 transition-all duration-300 shadow-md ${
          isFunOver
            ? 'bg-gradient-to-br from-rose-500/10 via-amber-500/5 to-rose-500/10 border-rose-400/40'
            : 'bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-emerald-500/10 border-emerald-400/40'
        } rounded-[2.2rem] p-6 text-slate-800`}
      >
        {/* Ambient background glow */}
        <div
          className={`absolute -top-12 -right-12 w-48 h-48 rounded-full filter blur-3xl pointer-events-none ${
            isFunOver ? 'bg-rose-500/15' : 'bg-emerald-500/15'
          }`}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Main Copy & Badge */}
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={`px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-xl border flex items-center gap-1.5 ${
                  isFunOver
                    ? 'bg-rose-500/15 text-rose-700 border-rose-400/30'
                    : 'bg-emerald-500/15 text-emerald-700 border-emerald-400/30'
                }`}
              >
                {isFunOver ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    Monday Weekly Review · Over Budget
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

            {/* Headline message directly satisfying user's prompt */}
            <div>
              {isFunOver ? (
                <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight leading-snug">
                  You spent <span className="text-rose-600">{fmt(funSpent)}</span> last week, which is{' '}
                  <span className="text-rose-600">{fmt(funOverAmount)} over</span> your weekly fun budget.
                </h2>
              ) : (
                <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight leading-snug">
                  Congrats! Now you have <span className="text-emerald-600">{fmt(funUnderAmount)} extra</span> to play with
                  this week because you were good! 🎉
                </h2>
              )}

              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                {isFunOver
                  ? `Cut back a little bit this week to get back on track and meet your saving goals!`
                  : `You stayed under your ${fmt(weeklyFunBudget)} weekly fun allowance. Feel free to roll over your extra savings into your pools or enjoy the bonus breathing room!`}
              </p>
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex flex-col sm:flex-row md:flex-col items-stretch sm:items-center md:items-end gap-3 shrink-0">
            {/* Stat Pill */}
            <div className="bg-white/80 backdrop-blur-md border border-slate-200/80 rounded-2xl p-3.5 shadow-sm min-w-[200px] flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Last Week Spend</p>
                <p className="text-lg font-display font-black text-slate-900 tabular-nums">{fmt(funSpent)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Weekly Target</p>
                <p className="text-sm font-semibold text-slate-600 tabular-nums">{fmt(weeklyFunBudget)}</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/finance/transactions')}
                className="flex-1 sm:flex-initial rounded-xl border-slate-200 hover:bg-white text-xs font-semibold text-slate-700 shadow-none gap-1.5"
              >
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                View Transactions
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                className="rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white/60 p-2"
                title="Dismiss review for this week"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
