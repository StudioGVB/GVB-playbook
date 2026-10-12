import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle,
  Calendar,
  Target,
  ArrowRightLeft,
  ChevronRight,
  TrendingUp,
  Receipt,
  ShoppingBag,
  Coins,
  Pencil,
  Info,
  CheckCircle2,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/financeUtils';
import { FeasibilityAssessment } from '@/lib/feasibilityEngine';
import { FinanceGoal } from '@/hooks/useFinanceData';
import { toast } from 'sonner';

interface FeasibilityBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: FinanceGoal | null;
  assessment: FeasibilityAssessment | null;
  currency?: string;
  totalLiquidCash?: number;
  allGoals?: FinanceGoal[];
  onEditGoal?: (goal: FinanceGoal) => void;
  onMoveFunds?: (goal: FinanceGoal, suggestedAmount?: number) => void;
  onApplyRecommendedDate?: (goalId: string, dateStr: string) => void;
  onApplyRecommendedTarget?: (goalId: string, target: number) => void;
  onUpdateExpectedIncome?: (amount: number) => Promise<void> | void;
}

export default function FeasibilityBreakdownDialog({
  open,
  onOpenChange,
  goal,
  assessment,
  currency = 'GBP',
  totalLiquidCash = 0,
  allGoals = [],
  onEditGoal,
  onMoveFunds,
  onApplyRecommendedDate,
  onApplyRecommendedTarget,
  onUpdateExpectedIncome,
}: FeasibilityBreakdownDialogProps) {
  if (!goal || !assessment) return null;

  const [isEditingIncome, setIsEditingIncome] = useState(false);
  const [customIncomeInput, setCustomIncomeInput] = useState('');
  const [isSavingIncome, setIsSavingIncome] = useState(false);

  const fmt = (val: number) => formatCurrency(val, currency);

  const isFeasible = assessment.isFeasible;

  const deadlineFormatted = goal.deadline
    ? format(new Date(goal.deadline), 'dd MMM yyyy')
    : null;

  const topCompeting = assessment.competingGoals?.[0] || null;

  const recDateStr = assessment.recommendedFeasibleDate
    ? format(assessment.recommendedFeasibleDate, 'yyyy-MM-dd')
    : assessment.recommendedDateWithSurplusBeforeGoals
    ? format(assessment.recommendedDateWithSurplusBeforeGoals, 'yyyy-MM-dd')
    : null;

  const recDateLabel = assessment.recommendedFeasibleDate
    ? format(assessment.recommendedFeasibleDate, 'dd MMM yyyy')
    : assessment.recommendedDateWithSurplusBeforeGoals
    ? format(assessment.recommendedDateWithSurplusBeforeGoals, 'dd MMM yyyy')
    : null;

  const handleStartEditIncome = () => {
    setCustomIncomeInput(String(Math.round(assessment.estimatedMonthlyIncome)));
    setIsEditingIncome(true);
  };

  const handleSaveIncome = async () => {
    const val = parseFloat(customIncomeInput);
    if (isNaN(val) || val <= 0) {
      toast.error('Please enter a valid monthly income');
      return;
    }
    if (!onUpdateExpectedIncome) return;
    setIsSavingIncome(true);
    try {
      await onUpdateExpectedIncome(val);
      setIsEditingIncome(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update expected income');
    } finally {
      setIsSavingIncome(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-xl max-h-[90vh] overflow-y-auto p-0 gap-0 rounded-3xl ${
        isFeasible ? 'border-emerald-200' : 'border-rose-200'
      }`}>
        {/* Top Banner Header */}
        <div className={`p-6 pb-5 border-b ${
          isFeasible
            ? 'bg-emerald-50/90 border-emerald-200/80'
            : 'bg-rose-50/90 border-rose-200/80'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${
              isFeasible
                ? 'bg-emerald-100 border-emerald-200 text-emerald-600'
                : 'bg-rose-100 border-rose-200 text-rose-600'
            }`}>
              {isFeasible ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider ${
                    isFeasible
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-rose-100 text-rose-800 border-rose-300'
                  }`}
                >
                  {isFeasible ? 'Feasibility Analysis • On Track' : 'Feasibility Analysis'}
                </Badge>
                {deadlineFormatted && (
                  <span className={`text-xs font-medium ${isFeasible ? 'text-emerald-700' : 'text-rose-700'}`}>
                    Due {deadlineFormatted} ({assessment.daysRemaining} days left)
                  </span>
                )}
              </div>
              <DialogTitle className="text-lg sm:text-xl font-display font-extrabold text-slate-900 mt-1.5 leading-snug">
                {isFeasible ? `"${goal.name}" is Feasible!` : `Why is "${goal.name}" unfeasible?`}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-600 mt-1 leading-relaxed">
                {isFeasible ? (
                  <>
                    This pool requires <strong className="font-bold text-slate-900">{fmt(assessment.requiredMonthlyPace)}/mo</strong> ({fmt(assessment.requiredWeeklyPace)}/wk) to hit your goal on time, and your surplus capacity is <strong className="font-bold text-emerald-700">{fmt(assessment.netMonthlySurplus)}/mo</strong> — you are comfortably funded!
                  </>
                ) : (
                  <>
                    This pool requires <strong className="font-bold text-slate-900">{fmt(assessment.requiredMonthlyPace)}/mo</strong> ({fmt(assessment.requiredWeeklyPace)}/wk) to hit your goal on time, but your current surplus capacity is <strong className="font-bold text-rose-700">{fmt(assessment.netMonthlySurplus)}/mo</strong>.
                  </>
                )}
              </DialogDescription>
            </div>
          </div>

          {/* Goal Demand Snapshot */}
          <div className={`mt-4 grid grid-cols-3 gap-2 p-3 rounded-2xl bg-white/80 border shadow-xs ${
            isFeasible ? 'border-emerald-100' : 'border-rose-100'
          }`}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target</p>
              <p className="text-sm font-display font-bold text-slate-900 mt-0.5">{fmt(goal.target_amount || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Saved So Far</p>
              <p className="text-sm font-display font-bold text-emerald-600 mt-0.5">{fmt(goal.assigned_amount || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Still Needed</p>
              <p className={`text-sm font-display font-bold mt-0.5 ${isFeasible ? 'text-slate-800' : 'text-rose-600'}`}>
                {fmt(assessment.remainingNeeded)}
              </p>
            </div>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5">
          {/* Step-by-Step Cashflow Math Breakdown */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-slate-400" />
                Monthly Cash Flow Calculation
              </h4>
              {onUpdateExpectedIncome && !isEditingIncome && (
                <button
                  type="button"
                  onClick={handleStartEditIncome}
                  className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" /> Adjust Income
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 divide-y divide-slate-100 text-xs overflow-hidden">
              {/* Inflows */}
              <div className="p-3 bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-bold text-slate-800">Estimated Monthly Income</span>
                      <p className="text-[10px] text-slate-400">
                        Total monthly take-home (Gamma salary + Venture Advisory + other)
                      </p>
                    </div>
                  </div>

                  {/* Inline Income Display or Editor */}
                  {isEditingIncome ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-slate-400 font-bold">{currency === 'GBP' ? '£' : '$'}</span>
                      <Input
                        type="number"
                        step="50"
                        value={customIncomeInput}
                        onChange={(e) => setCustomIncomeInput(e.target.value)}
                        placeholder="3200"
                        className="w-24 h-7 text-xs font-bold px-2 py-0"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveIncome();
                          if (e.key === 'Escape') setIsEditingIncome(false);
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={isSavingIncome}
                        onClick={handleSaveIncome}
                        className="h-7 px-2 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg gap-1"
                      >
                        <Check className="w-3 h-3" /> Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsEditingIncome(false)}
                        className="h-7 px-1.5 text-[10px] text-slate-500 rounded-lg"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="font-display font-bold text-emerald-600 tabular-nums">
                        +{fmt(assessment.estimatedMonthlyIncome)}/mo
                      </span>
                      {onUpdateExpectedIncome && (
                        <button
                          type="button"
                          onClick={handleStartEditIncome}
                          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                          title="Click to edit expected monthly income"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Sub-streams chip list */}
                {assessment.streamEstimates && assessment.streamEstimates.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {assessment.streamEstimates.map(s => (
                      <span
                        key={s.categoryId}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-slate-100/90 text-slate-700 font-medium border border-slate-200/60"
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color || '#10B981' }} />
                        <span>{s.name}:</span>
                        <strong className="font-bold text-slate-900">+{fmt(s.estimatedMonthlyAmount)}/mo</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Fixed Expenses */}
              <div className="p-3 flex items-center justify-between bg-white">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                    <Receipt className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-800">Fixed Bills & Subscriptions</span>
                    <p className="text-[10px] text-slate-400">Rent, gym, utilities, recurring commitments</p>
                  </div>
                </div>
                <span className="font-display font-bold text-rose-600 tabular-nums">−{fmt(assessment.fixedMonthlyExpenses)}/mo</span>
              </div>

              {/* Variable Living Allowance */}
              <div className="p-3 flex items-center justify-between bg-white">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                    <ShoppingBag className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-800">Variable Living Budget</span>
                    <p className="text-[10px] text-slate-400">Groceries, transport, everyday discretionary spend</p>
                  </div>
                </div>
                <span className="font-display font-bold text-amber-600 tabular-nums">−{fmt(assessment.variableMonthlyBudget)}/mo</span>
              </div>

              {/* Subtotal Capacity */}
              <div className="p-3 flex items-center justify-between bg-slate-100/70 font-semibold text-slate-700">
                <span className="text-[11px] font-bold">Total Savings Capacity (Before Goal Pools)</span>
                <span className="font-display font-bold text-slate-900 tabular-nums">={fmt(assessment.totalMonthlySurplusBeforeGoals)}/mo</span>
              </div>

              {/* Competing Goals */}
              {assessment.competingGoals && assessment.competingGoals.length > 0 && (
                <div className="p-3 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-rose-800">Other Active Goal Commitments</span>
                      <p className="text-[10px] text-slate-400">Competing goals scheduled within the same timeline</p>
                    </div>
                    <span className="font-display font-bold text-rose-600 tabular-nums">−{fmt(assessment.existingPoolsMonthlyCommitment)}/mo</span>
                  </div>

                  {/* Competing goal pills */}
                  <div className="space-y-1.5 pt-1">
                    {assessment.competingGoals.map(cg => (
                      <div key={cg.id} className="flex items-center justify-between text-[11px] p-2 rounded-xl bg-slate-50 border border-slate-200/60">
                        <div className="min-w-0 pr-2">
                          <span className="font-bold text-slate-800 truncate block">{cg.name}</span>
                          <span className="text-[10px] text-slate-500">
                            Needs {fmt(cg.remainingAmount)} {cg.deadline ? `by ${format(new Date(cg.deadline), 'dd MMM')}` : ''}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-bold text-rose-700 block tabular-nums">{fmt(cg.monthlyCommitment)}/mo</span>
                          <span className="text-[10px] text-slate-400">{fmt(cg.weeklyPace)}/wk</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Net Surplus Capacity */}
              <div className={`p-3.5 flex items-center justify-between border-t-2 ${
                isFeasible
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-rose-50/60 border-rose-200'
              }`}>
                <div>
                  <span className="font-display font-extrabold text-slate-900 text-sm">
                    Net Monthly Surplus for {goal.name}
                  </span>
                  <p className={`text-[11px] font-medium ${isFeasible ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {isFeasible ? (
                      <>
                        Surplus buffer of <strong className="font-bold">+{fmt(assessment.netMonthlySurplus - assessment.requiredMonthlyPace)}/mo</strong> after funding pace
                      </>
                    ) : (
                      <>
                        Shortfall of <strong className="font-bold">{fmt(assessment.shortfall)}/mo</strong> to hit pace
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`text-base font-display font-black tabular-nums ${
                    isFeasible ? 'text-emerald-700' : 'text-rose-700'
                  }`}>
                    {fmt(assessment.netMonthlySurplus)}/mo
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Plain English Explanation */}
          <div className={`p-3.5 rounded-2xl border text-xs leading-relaxed flex items-start gap-2.5 ${
            isFeasible
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
              : 'bg-amber-50/70 border-amber-200 text-amber-950'
          }`}>
            {isFeasible ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className={`font-bold ${isFeasible ? 'text-emerald-900' : 'text-amber-900'}`}>
                {isFeasible ? '✓ Why this goal is fully on track:' : `Why capacity is ${fmt(assessment.netMonthlySurplus)}/mo:`}
              </p>
              <p className={`mt-0.5 ${isFeasible ? 'text-emerald-900/90' : 'text-amber-900/90'}`}>
                {isFeasible ? (
                  <>
                    Your monthly income of <strong>{fmt(assessment.estimatedMonthlyIncome)}/mo</strong> comfortably covers your fixed bills ({fmt(assessment.fixedMonthlyExpenses)}/mo), variable living spend ({fmt(assessment.variableMonthlyBudget)}/mo), and competing goals ({fmt(assessment.existingPoolsMonthlyCommitment)}/mo). This leaves <strong>{fmt(assessment.netMonthlySurplus)}/mo</strong> in surplus capacity, which easily covers the <strong>{fmt(assessment.requiredMonthlyPace)}/mo</strong> ({fmt(assessment.requiredWeeklyPace)}/wk) required for <strong>{goal.name}</strong>.
                  </>
                ) : assessment.existingPoolsMonthlyCommitment > assessment.totalMonthlySurplusBeforeGoals ? (
                  <>
                    After fixed bills and variable allowance, your total monthly savings capacity is <strong>{fmt(assessment.totalMonthlySurplusBeforeGoals)}/mo</strong>. However, your other active goal{assessment.competingGoals.length > 1 ? 's' : ''} (especially <strong>{topCompeting?.name}</strong> requiring <strong>{fmt(topCompeting?.monthlyCommitment || 0)}/mo</strong>) absorb all available savings, leaving £0.00/mo unallocated for <strong>{goal.name}</strong>.
                  </>
                ) : (
                  <>
                    Your monthly income leaves <strong>{fmt(assessment.totalMonthlySurplusBeforeGoals)}/mo</strong> after bills, but other active commitments leave only <strong>{fmt(assessment.netMonthlySurplus)}/mo</strong>, which is less than the <strong>{fmt(assessment.requiredMonthlyPace)}/mo</strong> required.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Actionable Solutions (only if unfeasible) */}
          {!isFeasible && (
            <div className="space-y-3 pt-1">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Ways to Fix This
              </h4>

              <div className="grid grid-cols-1 gap-2.5">
                {/* Option 1: Move Existing Cash */}
                {totalLiquidCash > 0 && onMoveFunds && (
                  <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">1. Allocate Existing Cash</span>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200 font-bold">
                          Instant Hit
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        You have <strong>{fmt(totalLiquidCash)}</strong> across accounts. Move <strong>{fmt(assessment.remainingNeeded)}</strong> from other pools to hit this goal today.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        onOpenChange(false);
                        onMoveFunds(goal, assessment.remainingNeeded);
                      }}
                      className="h-8 text-xs font-bold gap-1.5 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" /> Move Funds Now
                    </Button>
                  </div>
                )}

                {/* Option 2: Adjust Top Competing Goal */}
                {topCompeting && onEditGoal && (
                  <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-900">2. Adjust Competing Goal ({topCompeting.name})</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        <strong>{topCompeting.name}</strong> is consuming <strong>{fmt(topCompeting.monthlyCommitment)}/mo</strong>. Extending its date frees up capacity for {goal.name}.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onOpenChange(false);
                        const targetGoal = allGoals.find(g => g.id === topCompeting.id);
                        if (targetGoal) onEditGoal(targetGoal);
                      }}
                      className="h-8 text-xs font-bold gap-1.5 shrink-0 rounded-xl"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit {topCompeting.name}
                    </Button>
                  </div>
                )}

                {/* Option 3: Extend Date */}
                {recDateStr && onApplyRecommendedDate && (
                  <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-900">3. Extend Target Date</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Extending the deadline to <strong>{recDateLabel}</strong> gives you breathing room to fund it gradually.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onApplyRecommendedDate(goal.id, recDateStr);
                        onOpenChange(false);
                      }}
                      className="h-8 text-xs font-bold gap-1.5 shrink-0 rounded-xl"
                    >
                      <Calendar className="w-3.5 h-3.5 text-primary" /> Extend to {recDateLabel}
                    </Button>
                  </div>
                )}

                {/* Option 4: Lower Target */}
                {assessment.recommendedFeasibleTarget > 0 && onApplyRecommendedTarget && (
                  <div className="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-900">4. Lower Target Amount</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Adjusting target to <strong>{fmt(Math.floor(assessment.recommendedFeasibleTarget))}</strong> fits within current surplus.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onApplyRecommendedTarget(goal.id, Math.floor(assessment.recommendedFeasibleTarget));
                        onOpenChange(false);
                      }}
                      className="h-8 text-xs font-bold gap-1.5 shrink-0 rounded-xl"
                    >
                      <Target className="w-3.5 h-3.5 text-primary" /> Lower Target
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
