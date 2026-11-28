import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Target, Search, Check, X, Scissors } from 'lucide-react';
import { formatCurrency, formatUkDate } from '@/lib/financeUtils';
import type { FinanceTransaction, FinanceGoal } from '@/hooks/useFinanceData';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: FinanceTransaction | null;
  goals: FinanceGoal[];
  baseCurrency: string;
  onAssignPot: (txId: string, goalId: string | null) => void;
  onOpenSplit?: (tx: FinanceTransaction) => void;
}

export default function PotSelectDialog({
  open,
  onOpenChange,
  transaction,
  goals,
  baseCurrency,
  onAssignPot,
  onOpenSplit,
}: Props) {
  const [search, setSearch] = useState('');

  React.useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const assignedGoalId = (transaction as any)?.goal_id as string | undefined;

  const filteredGoals = useMemo(() => {
    if (!search.trim()) return goals;
    const q = search.toLowerCase();
    return goals.filter(g =>
      g.name.toLowerCase().includes(q) ||
      (g.description && g.description.toLowerCase().includes(q))
    );
  }, [goals, search]);

  if (!transaction) return null;

  const txAmountFormatted = formatCurrency(transaction.amount, transaction.currency || baseCurrency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl shadow-2xl">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 pb-3 border-b border-border/60 bg-slate-50/60 dark:bg-slate-900/60 text-left">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-bold">Assign to Saving Pot</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Funded directly from this specific pot balance.
              </DialogDescription>
            </div>
          </div>

          {/* Transaction Summary Card */}
          <div className="mt-3 p-2.5 rounded-xl bg-white dark:bg-slate-800/80 border border-border/50 flex items-center justify-between gap-3 shadow-2xs">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {transaction.description}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {formatUkDate(transaction.posted_at)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                {txAmountFormatted}
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* Search Bar */}
        {goals.length > 4 && (
          <div className="px-4 py-2 border-b border-border/40 bg-slate-50/30 dark:bg-slate-900/30">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search pots..."
                className="pl-9 pr-8 h-9 text-xs rounded-lg"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scrollable Pots List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5 min-h-[220px] max-h-[50vh]">
          {filteredGoals.length === 0 ? (
            <div className="text-center py-8 px-4 text-muted-foreground">
              <p className="text-xs">No saving pots found.</p>
              {search && (
                <p className="text-[11px] mt-1 text-muted-foreground/80">
                  Try clearing your search query.
                </p>
              )}
            </div>
          ) : (
            filteredGoals.map(goal => {
              const isSelected = assignedGoalId === goal.id;
              const potColor = goal.color || '#3b82f6';

              return (
                <button
                  key={goal.id}
                  onClick={() => {
                    onAssignPot(transaction.id, isSelected ? null : goal.id);
                    onOpenChange(false);
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer select-none active:scale-[0.99] ${
                    isSelected
                      ? 'border-primary/80 bg-primary/5 dark:bg-primary/20 text-foreground shadow-2xs font-medium'
                      : 'border-slate-100 hover:border-slate-200 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 shadow-2xs"
                      style={{ backgroundColor: potColor }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-semibold truncate text-slate-900 dark:text-slate-100">
                        {goal.name}
                      </p>
                      {goal.target_amount > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Target: {formatCurrency(goal.target_amount, goal.currency || baseCurrency)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {goal.assigned_amount !== undefined && (
                      <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(goal.assigned_amount, goal.currency || baseCurrency)}
                      </span>
                    )}
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-slate-200 dark:border-slate-700 text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 border-t border-border/60 bg-slate-50/60 dark:bg-slate-900/60 flex flex-col gap-2">
          {onOpenSplit && transaction.amount < 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onOpenSplit(transaction);
              }}
              className="w-full text-xs font-semibold text-primary hover:text-primary hover:bg-primary/10 border-primary/20 h-9"
            >
              <Scissors className="w-3.5 h-3.5 mr-1.5" /> Split with a pot...
            </Button>
          )}

          {assignedGoalId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onAssignPot(transaction.id, null);
                onOpenChange(false);
              }}
              className="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20 h-9"
            >
              <X className="w-3.5 h-3.5 mr-1.5" /> Remove from pot
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full text-xs h-8 text-muted-foreground"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
