import { FeasibilityAssessment } from '@/lib/feasibilityEngine';
import { formatCurrency } from '@/lib/financeUtils';
import { AlertCircle, Calendar, Target, CheckCircle2, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';

interface Props {
  assessment: FeasibilityAssessment;
  currency?: string;
  onApplyRecommendedDate?: (dateStr: string) => void;
  onApplyRecommendedTarget?: (targetAmt: number) => void;
}

export default function FeasibilityAlert({
  assessment,
  currency = 'GBP',
  onApplyRecommendedDate,
  onApplyRecommendedTarget,
}: Props) {
  const fmt = (val: number) => formatCurrency(val, currency);

  if (!assessment.isFeasible) {
    const recDateStr = assessment.recommendedFeasibleDate
      ? format(assessment.recommendedFeasibleDate, 'yyyy-MM-dd')
      : null;
    const recDateLabel = assessment.recommendedFeasibleDate
      ? format(assessment.recommendedFeasibleDate, 'MMM d, yyyy')
      : null;

    return (
      <div className="bg-rose-50/90 border-2 border-rose-300 rounded-2xl p-4 text-rose-950 space-y-3 transition-all animate-in fade-in">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0 mt-0.5">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-display font-extrabold text-rose-900 leading-snug">
              Target Target/Date Unfeasible
            </h4>
            <p className="text-xs text-rose-800 font-medium mt-1 leading-relaxed">
              This pool requires <strong className="font-bold">{fmt(assessment.requiredMonthlyPace)}/mo</strong> ({fmt(assessment.requiredWeeklyPace)}/wk), but your net monthly surplus capacity is only <strong className="font-bold">{fmt(assessment.netMonthlySurplus)}/mo</strong>.
            </p>
            <div className="mt-2 text-[11px] text-rose-700 bg-rose-100/60 p-2 rounded-xl font-mono space-y-0.5">
              <div className="flex justify-between">
                <span>Estimated Monthly Income:</span>
                <span className="font-bold">{fmt(assessment.estimatedMonthlyIncome)}</span>
              </div>
              <div className="flex justify-between">
                <span>Fixed & Variable Spend:</span>
                <span className="font-bold">−{fmt(assessment.fixedMonthlyExpenses + assessment.variableMonthlyBudget)}</span>
              </div>
              {assessment.existingPoolsMonthlyCommitment > 0 && (
                <div className="flex justify-between">
                  <span>Other Active Goal Pools:</span>
                  <span className="font-bold">−{fmt(assessment.existingPoolsMonthlyCommitment)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 1-Click Fix Actions */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          {recDateStr && onApplyRecommendedDate && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onApplyRecommendedDate(recDateStr)}
              className="h-8 text-xs font-bold gap-1.5 border-rose-300 bg-white text-rose-900 hover:bg-rose-100 flex-1"
            >
              <Calendar className="w-3.5 h-3.5 text-rose-600" />
              Extend Date to {recDateLabel}
            </Button>
          )}

          {assessment.recommendedFeasibleTarget > 0 && onApplyRecommendedTarget && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onApplyRecommendedTarget(Math.max(0, Math.floor(assessment.recommendedFeasibleTarget)))}
              className="h-8 text-xs font-bold gap-1.5 border-rose-300 bg-white text-rose-900 hover:bg-rose-100 flex-1"
            >
              <Target className="w-3.5 h-3.5 text-rose-600" />
              Lower Target to {fmt(Math.floor(assessment.recommendedFeasibleTarget))}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (assessment.isTight) {
    const pctUsed = ((assessment.requiredMonthlyPace / Math.max(1, assessment.netMonthlySurplus)) * 100).toFixed(0);
    return (
      <div className="bg-amber-50/90 border-2 border-amber-300 rounded-2xl p-3.5 text-amber-950 flex items-start gap-2.5 transition-all">
        <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
          <Zap className="w-4 h-4" />
        </div>
        <div className="min-w-0 text-xs">
          <h4 className="font-display font-extrabold text-amber-900">Tight Cashflow Commitment ({pctUsed}% of Surplus)</h4>
          <p className="text-amber-800 mt-0.5 font-medium">
            Requires {fmt(assessment.requiredMonthlyPace)}/mo out of {fmt(assessment.netMonthlySurplus)}/mo available surplus capacity.
          </p>
        </div>
      </div>
    );
  }

  if (assessment.requiredMonthlyPace > 0) {
    return (
      <div className="bg-emerald-50/90 border border-emerald-300 rounded-2xl p-3 text-emerald-950 flex items-center gap-2.5 transition-all">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-xs font-medium text-emerald-800">
          Target Feasible! Requires <strong className="font-bold">{fmt(assessment.requiredMonthlyPace)}/mo</strong> (surplus capacity is {fmt(assessment.netMonthlySurplus)}/mo).
        </span>
      </div>
    );
  }

  return null;
}
