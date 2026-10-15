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
  RotateCcw,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import { FeasibilityAssessment } from '@/lib/feasibilityEngine';
import { FinanceGoal, FinanceTransaction, FinanceCategory, FinanceAccount } from '@/hooks/useFinanceData';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FeasibilityBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: FinanceGoal | null;
  assessment: FeasibilityAssessment | null;
  currency?: string;
  totalLiquidCash?: number;
  allGoals?: FinanceGoal[];
  hasManualIncomeOverride?: boolean;
  onEditGoal?: (goal: FinanceGoal) => void;
  onMoveFunds?: (goal: FinanceGoal, suggestedAmount?: number) => void;
  onApplyRecommendedDate?: (goalId: string, dateStr: string) => void;
  onApplyRecommendedTarget?: (goalId: string, target: number) => void;
  onUpdateExpectedIncome?: (amount: number) => Promise<void> | void;
  onResetExpectedIncome?: () => Promise<void> | void;
  transactions?: FinanceTransaction[];
  categories?: FinanceCategory[];
  accounts?: FinanceAccount[];
  onUpdateTransaction?: (id: string, updates: Partial<FinanceTransaction>) => Promise<any> | void;
}

export default function FeasibilityBreakdownDialog({
  open,
  onOpenChange,
  goal,
  assessment,
  currency = 'GBP',
  totalLiquidCash = 0,
  allGoals = [],
  hasManualIncomeOverride = false,
  onEditGoal,
  onMoveFunds,
  onApplyRecommendedDate,
  onApplyRecommendedTarget,
  onUpdateExpectedIncome,
  onResetExpectedIncome,
  transactions = [],
  categories = [],
  accounts = [],
  onUpdateTransaction,
}: FeasibilityBreakdownDialogProps) {
  if (!goal || !assessment) return null;

  const [isEditingIncome, setIsEditingIncome] = useState(false);
  const [customIncomeInput, setCustomIncomeInput] = useState('');
  const [isSavingIncome, setIsSavingIncome] = useState(false);
  const [inspectingStreamId, setInspectingStreamId] = useState<string | null>(null);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const incomeCategories = (categories || []).filter(c => c.type === 'income' && !c.is_archived);
  const otherCategories = (categories || []).filter(c => c.type !== 'income' && !c.is_archived);

  const handleMouseEnterStream = (id: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setInspectingStreamId(id);
  };

  const handleMouseLeaveStream = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setInspectingStreamId(null);
    }, 250);
  };

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
              <div className="flex items-center gap-2">
                {hasManualIncomeOverride && onResetExpectedIncome && !isEditingIncome && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onResetExpectedIncome();
                    }}
                    className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 hover:underline inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset to 3-Mo Average
                  </button>
                )}
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-800">Average Monthly Income</span>
                        {hasManualIncomeOverride && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-300 font-bold">
                            Manual Override
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        {hasManualIncomeOverride
                          ? 'Manual override active • Click Reset to use 3-month transaction average'
                          : 'Average of last 3 months per stream • Hover or click any stream below to inspect & categorise transactions'}
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

                {/* Sub-streams chip list with interactive transaction inspection & re-categorization */}
                {assessment.streamEstimates && assessment.streamEstimates.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {assessment.streamEstimates.map(s => {
                      const streamTxs = s.transactions || [];
                      const isOpen = inspectingStreamId === s.categoryId;

                      return (
                        <Popover
                          key={s.categoryId}
                          open={isOpen}
                          onOpenChange={(open) => {
                            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                            setInspectingStreamId(open ? s.categoryId : null);
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onMouseEnter={() => handleMouseEnterStream(s.categoryId)}
                              onMouseLeave={handleMouseLeaveStream}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                                setInspectingStreamId(isOpen ? null : s.categoryId);
                              }}
                              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-medium border transition-all cursor-pointer text-left ${
                                isOpen
                                  ? 'bg-slate-200 border-slate-300 shadow-sm text-slate-900 ring-2 ring-emerald-500/20'
                                  : 'bg-slate-100/90 hover:bg-slate-200/80 text-slate-700 border-slate-200/60 hover:border-slate-300'
                              }`}
                              title="Hover or click to view incoming transactions & re-categorise"
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color || '#10B981' }} />
                              <span>{s.name}:</span>
                              <strong className="font-bold text-slate-900">+{fmt(s.estimatedMonthlyAmount)}/mo</strong>
                              {s.totalLast3Months > 0 && (
                                <span className="text-[9px] text-slate-400 font-normal">
                                  ({fmt(s.totalLast3Months)} ÷ {s.activeMonthsCount || 3})
                                </span>
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-80 sm:w-96 p-3 shadow-2xl rounded-2xl border border-slate-200 bg-white z-[90]"
                            align="start"
                            side="bottom"
                            sideOffset={6}
                            onMouseEnter={() => {
                              if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                              setInspectingStreamId(s.categoryId);
                            }}
                            onMouseLeave={handleMouseLeaveStream}
                          >
                            <div className="space-y-2.5">
                              {/* Popover Header */}
                              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || '#10B981' }} />
                                  <div>
                                    <h5 className="font-bold text-slate-900 text-xs">{s.name}</h5>
                                    <p className="text-[10px] text-slate-400">
                                      {streamTxs.length} transaction{streamTxs.length === 1 ? '' : 's'} in last 90 days
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs font-bold text-emerald-600 font-display tabular-nums">
                                    +{fmt(s.estimatedMonthlyAmount)}/mo
                                  </div>
                                  <div className="text-[9px] text-slate-400 tabular-nums">
                                    90-day sum: {fmt(s.totalLast3Months)}
                                  </div>
                                </div>
                              </div>

                              {/* Transaction list */}
                              {streamTxs.length === 0 ? (
                                <div className="py-4 text-center text-xs text-slate-400 italic">
                                  No direct transactions found in the 90-day window (estimated from fallback target / rate).
                                </div>
                              ) : (
                                <div className="max-h-64 overflow-y-auto space-y-2.5 pr-1 divide-y divide-slate-100">
                                  {streamTxs.map(tx => {
                                    const accName = accounts?.find(a => a.id === tx.account_id)?.account_name;
                                    const txAmt = baseAmt(tx);
                                    return (
                                      <div key={tx.id} className="pt-2 first:pt-0 space-y-1.5">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="text-[10px] text-slate-400 font-mono">
                                                {format(new Date(tx.posted_at), 'dd MMM yyyy')}
                                              </span>
                                              {accName && (
                                                <span className="text-[9px] px-1 py-0 rounded bg-slate-100 text-slate-500 font-medium">
                                                  {accName}
                                                </span>
                                              )}
                                            </div>
                                            <p className="text-xs font-semibold text-slate-800 truncate" title={tx.merchant || tx.description}>
                                              {tx.merchant || tx.description}
                                            </p>
                                          </div>
                                          <span className="font-display font-bold text-emerald-600 text-xs shrink-0 tabular-nums">
                                            +{fmt(txAmt)}
                                          </span>
                                        </div>

                                        {/* Category selector */}
                                        <div className="flex items-center gap-1.5 pt-0.5">
                                          <span className="text-[10px] text-slate-400 shrink-0 font-medium">Categorise:</span>
                                          <Select
                                            value={tx.category_id || '__uncategorised'}
                                            onValueChange={async (newCatId) => {
                                              const targetCatId = newCatId === '__uncategorised' ? null : newCatId;
                                              if (onUpdateTransaction) {
                                                await onUpdateTransaction(tx.id, { category_id: targetCatId } as any);
                                                const catName = categories?.find(c => c.id === targetCatId)?.name || 'Uncategorised';
                                                toast.success(`Transaction moved to "${catName}"`);
                                              }
                                            }}
                                          >
                                            <SelectTrigger className="h-6 text-[11px] py-0 px-2 bg-slate-50 border-slate-200">
                                              <SelectValue placeholder="Category..." />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-60 z-[100]">
                                              <SelectItem value="__uncategorised" className="text-xs text-slate-400">
                                                Uncategorised
                                              </SelectItem>
                                              {incomeCategories.length > 0 && (
                                                <>
                                                  <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                                    Income Streams
                                                  </div>
                                                  {incomeCategories.map(c => (
                                                    <SelectItem key={c.id} value={c.id} className="text-xs">
                                                      <span className="inline-flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color || '#10B981' }} />
                                                        {c.name}
                                                      </span>
                                                    </SelectItem>
                                                  ))}
                                                </>
                                              )}
                                              {otherCategories.length > 0 && (
                                                <>
                                                  <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                                    Other Categories / Transfers
                                                  </div>
                                                  {otherCategories.map(c => (
                                                    <SelectItem key={c.id} value={c.id} className="text-xs">
                                                      <span className="inline-flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color || '#64748B' }} />
                                                        {c.name}
                                                      </span>
                                                    </SelectItem>
                                                  ))}
                                                </>
                                              )}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })}
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

              {/* This Goal's Required Pace */}
              {assessment.requiredMonthlyPace > 0 && (
                <div className="p-3 flex items-center justify-between bg-white">
                  <div>
                    <span className="font-bold text-indigo-800">{goal.name} (This Pool)</span>
                    <p className="text-[10px] text-slate-400">
                      Required pace ({fmt(assessment.requiredWeeklyPace)}/wk)
                    </p>
                  </div>
                  <span className="font-display font-bold text-indigo-600 tabular-nums">
                    −{fmt(assessment.requiredMonthlyPace)}/mo
                  </span>
                </div>
              )}

              {/* Net Remaining Surplus After All Pots */}
              <div className={`p-3.5 flex items-center justify-between border-t-2 ${
                isFeasible
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-rose-50/60 border-rose-200'
              }`}>
                <div>
                  <span className="font-display font-extrabold text-slate-900 text-sm">
                    {isFeasible ? 'Remaining Monthly Surplus (After All Pots)' : 'Monthly Shortfall'}
                  </span>
                  <p className={`text-[11px] font-medium ${isFeasible ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {isFeasible ? (
                      <>
                        Available capacity before this pool: <strong className="font-bold">{fmt(assessment.netMonthlySurplus)}/mo</strong>
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
                    {isFeasible
                      ? `+${fmt(Math.max(0, assessment.netMonthlySurplus - assessment.requiredMonthlyPace))}/mo`
                      : `−${fmt(assessment.shortfall)}/mo`}
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
