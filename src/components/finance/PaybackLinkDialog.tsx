import React, { useState, useMemo } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Handshake, Search, ArrowRight, CheckCircle2, RotateCcw, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatCurrency, parseUkDate } from '@/lib/financeUtils';
import type { FinanceTransaction } from '@/hooks/useFinanceData';
import { format, differenceInDays } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The transaction from which the user clicked "Link Payback" (can be an income transfer or an expense) */
  sourceTransaction: FinanceTransaction | null;
  /** All transactions to pick candidates from */
  allTransactions: FinanceTransaction[];
  baseCurrency: string;
  onLinkPayback: (expenseTx: FinanceTransaction, incomeTx: FinanceTransaction) => Promise<void>;
  onUnlinkPayback?: (tx: FinanceTransaction) => Promise<void>;
}

export default function PaybackLinkDialog({
  open,
  onOpenChange,
  sourceTransaction,
  allTransactions,
  baseCurrency,
  onLinkPayback,
  onUnlinkPayback,
}: Props) {
  const [search, setSearch] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSourceIncome = Boolean(sourceTransaction && sourceTransaction.amount > 0);
  const isSourceExpense = Boolean(sourceTransaction && sourceTransaction.amount < 0);

  const paybackMeta = (sourceTransaction?.raw as any)?.payback_meta;
  const isAlreadyLinked = Boolean(paybackMeta?.is_payback || paybackMeta?.has_payback);

  // If source is income, we look for expense candidates.
  // If source is expense, we look for income candidates.
  const candidates = useMemo(() => {
    if (!sourceTransaction) return [];
    const sourceDate = parseUkDate(sourceTransaction.posted_at);

    return allTransactions
      .filter(tx => {
        if (tx.id === sourceTransaction.id) return false;
        if (isSourceIncome) {
          // Look for outgoing purchases
          return tx.amount < 0 && !tx.is_transfer;
        } else {
          // Look for incoming transfers / deposits from friends
          return tx.amount > 0;
        }
      })
      .filter(tx => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        const desc = (tx.description || '').toLowerCase();
        const merch = (tx.merchant || '').toLowerCase();
        const amtStr = Math.abs(tx.amount).toFixed(2);
        return desc.includes(q) || merch.includes(q) || amtStr.includes(q);
      })
      .sort((a, b) => {
        // Prioritize transactions close in date to the source transaction
        const da = Math.abs(differenceInDays(parseUkDate(a.posted_at), sourceDate));
        const db = Math.abs(differenceInDays(parseUkDate(b.posted_at), sourceDate));
        if (da !== db) return da - db;
        return parseUkDate(b.posted_at).getTime() - parseUkDate(a.posted_at).getTime();
      })
      .slice(0, 30);
  }, [sourceTransaction, allTransactions, isSourceIncome, search]);

  const selectedCandidate = useMemo(() => {
    if (!selectedCandidateId) return null;
    return allTransactions.find(t => t.id === selectedCandidateId) || null;
  }, [selectedCandidateId, allTransactions]);

  const expenseTx = isSourceIncome ? selectedCandidate : sourceTransaction;
  const incomeTx = isSourceIncome ? sourceTransaction : selectedCandidate;

  const expenseAmt = expenseTx ? Math.abs(expenseTx.amount) : 0;
  const incomeAmt = incomeTx ? Math.abs(incomeTx.amount) : 0;
  const netRemaining = Math.max(0, Math.round((expenseAmt - incomeAmt) * 100) / 100);

  const handleSubmit = async () => {
    if (!expenseTx || !incomeTx) return;
    setIsSubmitting(true);
    try {
      await onLinkPayback(expenseTx, incomeTx);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnlink = async () => {
    if (!sourceTransaction || !onUnlinkPayback) return;
    setIsSubmitting(true);
    try {
      await onUnlinkPayback(sourceTransaction);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!sourceTransaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Handshake className="w-5 h-5 text-emerald-600" />
            {isSourceIncome ? 'Offset Expense with Friend Payback' : 'Link Friend Payback to Purchase'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isSourceIncome
              ? 'Connect this incoming transfer from your friend to the purchase you paid for, so your weekly spending is accurately offset.'
              : 'Select the income transfer your friend sent to repay you for this purchase.'}
          </DialogDescription>
        </DialogHeader>

        {/* Source Transaction Banner */}
        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isSourceIncome ? 'Incoming Payback Transfer' : 'Original Purchase'}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 truncate">
              {sourceTransaction.merchant || sourceTransaction.description || 'Transaction'}
            </span>
            <span
              className={`text-sm font-extrabold tabular-nums ${
                isSourceIncome ? 'text-emerald-600' : 'text-slate-900'
              }`}
            >
              {isSourceIncome ? '+' : '−'}
              {formatCurrency(Math.abs(sourceTransaction.amount), sourceTransaction.currency || baseCurrency)}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {sourceTransaction.posted_at ? format(new Date(sourceTransaction.posted_at), 'MMM d, yyyy') : 'Recent'}
          </p>
        </div>

        {/* Existing Link Warning / Notice */}
        {isAlreadyLinked && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Currently linked as an offset payback.</span>
            </div>
            {onUnlinkPayback && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUnlink}
                disabled={isSubmitting}
                className="text-[11px] h-7 text-destructive border-destructive/30 hover:bg-destructive/10"
              >
                Unlink
              </Button>
            )}
          </div>
        )}

        {/* Candidate Selector */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>{isSourceIncome ? 'Select Purchase to Offset' : 'Select Incoming Transfer from Friend'}</span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isSourceIncome ? 'Search purchases by name or amount...' : 'Search incoming transfers...'}
              className="pl-8 text-xs h-8"
            />
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {candidates.length === 0 ? (
              <p className="text-center py-6 text-xs text-muted-foreground">
                No matching transactions found. Try searching a different keyword or amount.
              </p>
            ) : (
              candidates.map(candidate => {
                const isSelected = selectedCandidateId === candidate.id;
                const candidateAmt = Math.abs(candidate.amount);
                const isCandidateIncome = candidate.amount > 0;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelectedCandidateId(isSelected ? null : candidate.id)}
                    className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex flex-col">
                      <span className="font-semibold text-slate-900 truncate">
                        {candidate.merchant || candidate.description || 'Transaction'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {candidate.posted_at ? format(new Date(candidate.posted_at), 'MMM d, yyyy') : 'Recent'}
                      </span>
                    </div>
                    <span
                      className={`font-bold tabular-nums shrink-0 ${
                        isCandidateIncome ? 'text-emerald-600' : 'text-slate-800'
                      }`}
                    >
                      {isCandidateIncome ? '+' : '−'}
                      {formatCurrency(candidateAmt, candidate.currency || baseCurrency)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Net Spending Preview */}
        {selectedCandidate && (
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-50 via-white to-sky-50 border border-emerald-300 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-700">
              <span>Original Purchase:</span>
              <span className="font-semibold tabular-nums">−{formatCurrency(expenseAmt, baseCurrency)}</span>
            </div>
            <div className="flex items-center justify-between text-emerald-700">
              <span>Friend Payback Offset:</span>
              <span className="font-bold tabular-nums">+{formatCurrency(incomeAmt, baseCurrency)}</span>
            </div>
            <div className="border-t border-emerald-200 pt-1 flex items-center justify-between font-extrabold text-slate-900 text-sm">
              <span>Your Net Personal Spend:</span>
              <span className="text-emerald-700 tabular-nums">
                {netRemaining <= 0.01 ? '£0.00 (Fully Covered! 🎉)' : `−${formatCurrency(netRemaining, baseCurrency)}`}
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 pt-2">
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
            disabled={!selectedCandidate || isSubmitting}
            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4"
          >
            {isSubmitting ? 'Linking...' : 'Confirm Payback Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
