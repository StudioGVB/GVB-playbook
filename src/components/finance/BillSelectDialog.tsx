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
import { Badge } from '@/components/ui/badge';
import { Receipt, Search, Check, X, Sparkles } from 'lucide-react';
import { formatCurrency, formatUkDate } from '@/lib/financeUtils';
import type { FinanceTransaction } from '@/hooks/useFinanceData';
import type { FixedExpense } from '@/hooks/useFixedExpenses';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: FinanceTransaction | null;
  fixedExpenses: FixedExpense[];
  baseCurrency: string;
  onAssignBill: (txId: string, expenseId: string | null) => void;
}

export default function BillSelectDialog({
  open,
  onOpenChange,
  transaction,
  fixedExpenses,
  baseCurrency,
  onAssignBill,
}: Props) {
  const [search, setSearch] = useState('');

  // Clear search whenever dialog opens
  React.useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const assignedExpenseId = (transaction as any)?.fixed_expense_id as string | undefined;

  // Filter bills by search query
  const filteredExpenses = useMemo(() => {
    if (!search.trim()) return fixedExpenses;
    const q = search.toLowerCase();
    return fixedExpenses.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.notes && e.notes.toLowerCase().includes(q)) ||
      e.frequency.toLowerCase().includes(q)
    );
  }, [fixedExpenses, search]);

  // Check if a bill is a suggested match based on description or merchant
  const isSuggested = (expense: FixedExpense) => {
    if (!transaction) return false;
    const txText = `${transaction.merchant || ''} ${transaction.description || ''}`.toLowerCase();
    const expName = expense.name.toLowerCase();
    const words = expName.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !['bill', 'bills', 'plan', 'flat', 'fees'].includes(w));
    if (words.length > 0 && words.some(w => txText.includes(w))) return true;
    return txText.includes(expName);
  };

  if (!transaction) return null;

  const txAmountFormatted = formatCurrency(transaction.amount, transaction.currency || baseCurrency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl shadow-2xl">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 pb-3 border-b border-border/60 bg-slate-50/60 dark:bg-slate-900/60 text-left">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-bold">Mark as Fixed Bill</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Bills are budgeted from your fixed commitments pool.
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
        {fixedExpenses.length > 4 && (
          <div className="px-4 py-2 border-b border-border/40 bg-slate-50/30 dark:bg-slate-900/30">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search bills..."
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

        {/* Scrollable Bills List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5 min-h-[220px] max-h-[50vh]">
          {filteredExpenses.length === 0 ? (
            <div className="text-center py-8 px-4 text-muted-foreground">
              <p className="text-xs">No fixed bills found.</p>
              {search && (
                <p className="text-[11px] mt-1 text-muted-foreground/80">
                  Try clearing your search query.
                </p>
              )}
            </div>
          ) : (
            filteredExpenses.map(expense => {
              const isSelected = assignedExpenseId === expense.id;
              const suggested = isSuggested(expense);

              return (
                <button
                  key={expense.id}
                  onClick={() => {
                    onAssignBill(transaction.id, isSelected ? null : expense.id);
                    onOpenChange(false);
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer select-none active:scale-[0.99] ${
                    isSelected
                      ? 'border-amber-500/80 bg-amber-50/80 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 shadow-2xs font-medium'
                      : 'border-slate-100 hover:border-slate-200 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs sm:text-sm font-semibold truncate text-slate-900 dark:text-slate-100">
                        {expense.name}
                      </span>
                      {suggested && !isSelected && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold flex items-center gap-0.5"
                        >
                          <Sparkles className="w-2.5 h-2.5" /> Suggested
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                      <span className="capitalize">{expense.frequency}</span>
                      {expense.due_day && (
                        <span>· Due day {expense.due_day}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {formatCurrency(expense.amount, expense.currency)}
                    </span>
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-amber-500 text-white'
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
          {assignedExpenseId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onAssignBill(transaction.id, null);
                onOpenChange(false);
              }}
              className="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20 h-9"
            >
              <X className="w-3.5 h-3.5 mr-1.5" /> Remove bill assignment
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
