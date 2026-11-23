import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Scissors, Plus, Trash2, CheckCircle2, AlertCircle, RotateCcw, ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';
import type { FinanceTransaction, FinanceGoal, FinanceCategory } from '@/hooks/useFinanceData';
import { format } from 'date-fns';

export interface SplitItem {
  id: string;
  amount: string;
  goalId: string | null; // null means Weekly Budget
  categoryId: string | null;
  label: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: FinanceTransaction | null;
  goals: FinanceGoal[];
  categories: FinanceCategory[];
  baseCurrency: string;
  convertToBase: (amount: number, currency: string) => number;
  onConfirmSplit: (
    parentTx: FinanceTransaction,
    splits: { amount: number; goalId: string | null; categoryId: string | null; label: string }[]
  ) => Promise<void>;
  onUnsplit?: (parentTx: FinanceTransaction) => Promise<void>;
}

export default function SplitTransactionDialog({
  open,
  onOpenChange,
  transaction,
  goals,
  categories,
  baseCurrency,
  convertToBase,
  onConfirmSplit,
  onUnsplit,
}: Props) {
  const [splits, setSplits] = useState<SplitItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalAbsAmount = useMemo(() => {
    if (!transaction) return 0;
    return Math.abs(Number(transaction.amount) || 0);
  }, [transaction]);

  const currency = transaction?.currency || baseCurrency;

  const isAlreadySplit = Boolean((transaction?.raw as any)?.split_meta?.is_split_parent);
  const existingSplits = (transaction?.raw as any)?.split_meta?.splits as
    | { amount: number; goal_id?: string | null; category_id?: string | null; label?: string }[]
    | undefined;

  useEffect(() => {
    if (!open || !transaction) return;

    if (isAlreadySplit && existingSplits && existingSplits.length > 0) {
      setSplits(
        existingSplits.map((s, idx) => ({
          id: String(idx + 1),
          amount: String(Math.abs(s.amount)),
          goalId: s.goal_id || null,
          categoryId: s.category_id || transaction.category_id || null,
          label: s.label || (s.goal_id ? 'Pot allocation' : 'Weekly budget'),
        }))
      );
    } else {
      // Default: 2 splits.
      // Part 1: First goal if available or round number.
      // Part 2: Remaining amount for weekly budget.
      const firstGoal = goals.find(g => (g as any).is_stash !== true && !/stash|emergency/i.test(g.name)) || goals[0];
      const part1Amount = Math.min(100, Math.round(totalAbsAmount * 0.67 * 100) / 100);
      const part2Amount = Math.max(0, Math.round((totalAbsAmount - part1Amount) * 100) / 100);

      setSplits([
        {
          id: '1',
          amount: part1Amount > 0 ? String(part1Amount) : String(Math.round(totalAbsAmount * 0.5 * 100) / 100),
          goalId: firstGoal?.id || null,
          categoryId: transaction.category_id || null,
          label: firstGoal ? `From ${firstGoal.name}` : 'Pot share',
        },
        {
          id: '2',
          amount: part2Amount > 0 ? String(part2Amount) : String(Math.round(totalAbsAmount * 0.5 * 100) / 100),
          goalId: null, // Weekly budget
          categoryId: transaction.category_id || null,
          label: 'Weekly budget portion',
        },
      ]);
    }
  }, [open, transaction, isAlreadySplit, existingSplits, goals, totalAbsAmount]);

  // Sum of split amounts
  const currentTotal = useMemo(() => {
    return splits.reduce((sum, s) => {
      const val = parseFloat(s.amount);
      return sum + (isNaN(val) ? 0 : Math.max(0, val));
    }, 0);
  }, [splits]);

  const diff = Math.round((totalAbsAmount - currentTotal) * 100) / 100;
  const isBalanced = Math.abs(diff) < 0.01;

  const handleSplitAmountChange = (id: string, val: string) => {
    setSplits(prev =>
      prev.map(s => (s.id === id ? { ...s, amount: val } : s))
    );
  };

  const handleSplitGoalChange = (id: string, goalId: string | null) => {
    const selectedGoal = goals.find(g => g.id === goalId);
    setSplits(prev =>
      prev.map(s =>
        s.id === id
          ? {
              ...s,
              goalId,
              label: selectedGoal ? `From ${selectedGoal.name}` : 'Weekly budget',
            }
          : s
      )
    );
  };

  const handleAutoBalance = (targetId: string) => {
    const otherSum = splits
      .filter(s => s.id !== targetId)
      .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
    const remainder = Math.max(0, Math.round((totalAbsAmount - otherSum) * 100) / 100);
    handleSplitAmountChange(targetId, String(remainder));
  };

  const handleAddSplit = () => {
    if (splits.length >= 4) return;
    const remainder = Math.max(0, diff);
    setSplits(prev => [
      ...prev,
      {
        id: String(Date.now()),
        amount: remainder > 0 ? String(remainder) : '0',
        goalId: null,
        categoryId: transaction?.category_id || null,
        label: `Split ${prev.length + 1}`,
      },
    ]);
  };

  const handleRemoveSplit = (id: string) => {
    if (splits.length <= 2) return;
    setSplits(prev => prev.filter(s => s.id !== id));
  };

  const handleSubmit = async () => {
    if (!transaction || !isBalanced || currentTotal <= 0) return;
    setIsSubmitting(true);
    try {
      const cleanSplits = splits.map(s => ({
        amount: parseFloat(s.amount),
        goalId: s.goalId,
        categoryId: s.categoryId,
        label: s.label.trim() || (s.goalId ? 'Pot split' : 'Weekly portion'),
      }));
      await onConfirmSplit(transaction, cleanSplits);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnsplit = async () => {
    if (!transaction || !onUnsplit) return;
    setIsSubmitting(true);
    try {
      await onUnsplit(transaction);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Scissors className="w-5 h-5 text-[#FF2EB8]" /> Split Transaction
          </DialogTitle>
          <DialogDescription className="text-xs">
            Split this expense between your weekly budget and money pots (e.g. £100 from Holiday Pot and £50 from Weekly Budget).
          </DialogDescription>
        </DialogHeader>

        {/* Transaction Summary Card */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 truncate">
              {transaction.merchant || transaction.description || 'Expense'}
            </span>
            <span className="text-sm font-extrabold text-slate-900 tabular-nums">
              {formatCurrency(totalAbsAmount, currency)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{transaction.posted_at ? format(new Date(transaction.posted_at), 'MMM d, yyyy') : 'Recent'}</span>
            <span>Total to allocate</span>
          </div>
        </div>

        {/* Split Rows */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Split Allocations</span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const half = Math.round((totalAbsAmount / 2) * 100) / 100;
                  setSplits(prev => [
                    { ...prev[0], amount: String(half) },
                    { ...prev[1], amount: String(Math.round((totalAbsAmount - half) * 100) / 100) },
                    ...prev.slice(2).map(s => ({ ...s, amount: '0' })),
                  ]);
                }}
                className="text-[10px] h-6 px-2 text-[#FF2EB8] hover:bg-pink-50"
              >
                50 / 50
              </Button>
            </div>
          </div>

          {splits.map((s, idx) => {
            const selectedGoal = goals.find(g => g.id === s.goalId);
            return (
              <div
                key={s.id}
                className="p-3 rounded-xl border border-slate-200 bg-white space-y-2.5 transition-all shadow-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-bold bg-slate-100">
                      Part {idx + 1}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-800">
                      {selectedGoal ? selectedGoal.name : 'Weekly Budget'}
                    </span>
                  </div>
                  {splits.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveSplit(s.id)}
                      className="h-6 w-6 text-slate-400 hover:text-destructive"
                      title="Remove this split"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Amount (£)</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={s.amount}
                        onChange={e => handleSplitAmountChange(s.id, e.target.value)}
                        className="font-bold text-xs tabular-nums pr-7"
                        placeholder="0.00"
                      />
                      {diff !== 0 && (
                        <button
                          type="button"
                          onClick={() => handleAutoBalance(s.id)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#FF2EB8] hover:opacity-80"
                          title="Fill with remaining amount"
                        >
                          Fill
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Destination</Label>
                    <Select
                      value={s.goalId || '__weekly__'}
                      onValueChange={v => handleSplitGoalChange(s.id, v === '__weekly__' ? null : v)}
                    >
                      <SelectTrigger className="text-xs h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__weekly__">
                          <span className="font-semibold text-slate-900">Weekly Budget (Fun / Living)</span>
                        </SelectItem>
                        {goals.map(g => (
                          <SelectItem key={g.id} value={g.id}>
                            <div className="flex items-center gap-1.5">
                              {g.color && (
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: g.color }}
                                />
                              )}
                              <span>{g.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({formatCurrency(g.assigned_amount || 0, g.currency)})
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="pt-0.5">
                  <Input
                    value={s.label}
                    onChange={e => {
                      const v = e.target.value;
                      setSplits(prev => prev.map(item => (item.id === s.id ? { ...item, label: v } : item)));
                    }}
                    placeholder="Note for this portion (e.g. Gift share)"
                    className="text-xs h-7 bg-slate-50 border-slate-100"
                  />
                </div>
              </div>
            );
          })}

          {splits.length < 4 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddSplit}
              className="w-full text-xs font-semibold border-dashed border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-400"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Another Split Part
            </Button>
          )}
        </div>

        {/* Balance Status */}
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
            isBalanced
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {isBalanced ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span>
              {isBalanced
                ? 'Splits match transaction total perfectly'
                : diff > 0
                ? `${formatCurrency(diff, currency)} left to allocate`
                : `${formatCurrency(Math.abs(diff), currency)} over total amount`}
            </span>
          </div>
          <span className="tabular-nums font-bold">
            {formatCurrency(currentTotal, currency)} / {formatCurrency(totalAbsAmount, currency)}
          </span>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2 pt-2">
          {isAlreadySplit && onUnsplit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUnsplit}
              disabled={isSubmitting}
              className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Unsplit & Merge
            </Button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={!isBalanced || currentTotal <= 0 || isSubmitting}
              className="text-xs bg-[#FF2EB8] hover:bg-[#E026A2] text-white font-bold px-4"
            >
              {isSubmitting ? 'Splitting...' : 'Apply Split'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
