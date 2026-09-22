import { useMemo } from 'react';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import PurchaseTimingEvaluator from '@/components/finance/PurchaseTimingEvaluator';
import { Sparkles, ArrowLeft, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function FinanceCanIBuyPage() {
  const navigate = useNavigate();
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
  const { monthlyTotalInternal: fixedExpensesMonthly } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();

  if (finance.loading || assumptionsLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6">
        <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-xl" />
        <div className="h-96 w-full bg-slate-100 dark:bg-slate-800/60 animate-pulse rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto min-h-screen pb-12 font-body">
      {/* Top Header Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md p-4 rounded-3xl border border-pink-200/30 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/finance/budget')}
            className="h-9 w-9 rounded-2xl hover:bg-pink-50 hover:text-[#FF2EB8] dark:hover:bg-slate-800"
            title="Back to Weekly Budget"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#FF2EB8]">
              Finance AI Advisor
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              Can I Buy This?
            </h1>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/finance/budget')}
          className="gap-2 rounded-2xl border-pink-200/60 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-pink-50 hover:text-[#FF2EB8]"
        >
          <Wallet className="w-4 h-4 text-[#FF2EB8]" />
          View Weekly Budget Rules
        </Button>
      </div>

      {/* Main Evaluator Feature Card */}
      {assumptions && (
        <PurchaseTimingEvaluator
          finance={finance}
          assumptions={assumptions}
          fixedExpensesMonthly={fixedExpensesMonthly}
          totalBoost={totalBoostThisWeek}
        />
      )}
    </div>
  );
}
