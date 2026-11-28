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
import { Handshake, Search, CheckCircle2 } from 'lucide-react';
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
  onToggleStandalonePayback?: (tx: FinanceTransaction) => Promise<void>;
}

const getOrigAmount = (tx?: FinanceTransaction | null): number => {
  if (!tx) return 0;
  return (tx as any).original_amount !== undefined
    ? Number((tx as any).original_amount)
    : Number(tx.amount) || 0;
};

const getOrigBaseAmount = (tx?: FinanceTransaction | null): number => {
  if (!tx) return 0;
  return (tx as any).original_base_amount !== undefined
    ? Number((tx as any).original_base_amount)
    : Number((tx as any).base_amount ?? tx.amount) || 0;
};

export default function PaybackLinkDialog({
  open,
  onOpenChange,
  sourceTransaction,
  allTransactions,
  baseCurrency,
  onLinkPayback,
  onUnlinkPayback,
  onToggleStandalonePayback,
}: Props) {
  const [search, setSearch] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sourceOrigAmt = getOrigAmount(sourceTransaction);
  const isSourceIncome = Boolean(sourceTransaction && sourceOrigAmt > 0);

  const paybackMeta = (sourceTransaction?.raw as any)?.payback_meta;
  const isStandaloneRefund = Boolean(
    isSourceIncome && (sourceTransaction as any)?.is_refund && !paybackMeta?.linked_expense_id && !paybackMeta?.linked_expense_ids?.length
  );
  const isAlreadyLinked = Boolean(
    paybackMeta?.is_payback ||
      paybackMeta?.has_payback ||
      (sourceTransaction as any)?.is_payback_pair ||
      isStandaloneRefund
  );

  // If source is income, we look for expense candidates.
  // If source is expense, we look for incoming payback candidates (including bank transfers).
  const candidates = useMemo(() => {
    if (!sourceTransaction) return [];
    const sourceDate = parseUkDate(sourceTransaction.posted_at);

    return allTransactions
      .filter(tx => {
        if (tx.id === sourceTransaction.id) return false;
        const origAmt = getOrigAmount(tx);
        if (isSourceIncome) {
          // Look for outgoing purchases
          return origAmt < 0 && !tx.is_transfer;
        } else {
          // Look for incoming deposits / transfers from friends
          return origAmt > 0;
        }
      })
      .filter(tx => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        const desc = (tx.description || '').toLowerCase();
        const merch = (tx.merchant || '').toLowerCase();
        const amtStr = Math.abs(getOrigAmount(tx)).toFixed(2);
        return desc.includes(q) || merch.includes(q) || amtStr.includes(q);
      })
      .sort((a, b) => {
        // Prioritize transactions close in date to the source transaction
        const da = Math.abs(differenceInDays(parseUkDate(a.posted_at), sourceDate));
        const db = Math.abs(differenceInDays(parseUkDate(b.posted_at), sourceDate));
        if (da !== db) return da - db;
        return parseUkDate(b.posted_at).getTime() - parseUkDate(a.posted_at).getTime();
      })
      .slice(0, 35);
  }, [sourceTransaction, allTransactions, isSourceIncome, search]);

  const selectedCandidate = useMemo(() => {
    if (!selectedCandidateId) return null;
    return allTransactions.find(t => t.id === selectedCandidateId) || null;
  }, [selectedCandidateId, allTransactions]);

  const expenseTx = isSourceIncome ? selectedCandidate : sourceTransaction;
  const incomeTx = isSourceIncome ? sourceTransaction : selectedCandidate;

  // Use remaining uncovered expense if the expense already has an earlier partial payback linked
  const expenseOrigBase = Math.abs(getOrigBaseAmount(expenseTx));
  const expensePriorCovered =
    expenseTx && (expenseTx as any).payback_covered_base
      ? Number((expenseTx as any).payback_covered_base) || 0
      : 0;
  const expenseAmt = Math.max(0, Math.round((expenseOrigBase - expensePriorCovered) * 100) / 100);

  const incomeOrigBase = Math.abs(getOrigBaseAmount(incomeTx));
  const incomePriorUsed =
    incomeTx && (incomeTx as any).payback_used_base
      ? Number((incomeTx as any).payback_used_base) || 0
      : 0;
  const incomeAmt = Math.max(0, Math.round((incomeOrigBase - incomePriorUsed) * 100) / 100);

  const netRemainingSpend = Math.max(0, Math.round((expenseAmt - incomeAmt) * 100) / 100);
  const netExcessIncome = Math.max(0, Math.round((incomeAmt - expenseAmt) * 100) / 100);

  const handleSubmit = async () => {
    if (!expenseTx || !incomeTx) return;
    setIsSubmitting(true);
    try {
      await onLinkPayback(expenseTx, incomeTx);
      setSelectedCandidateId(null);
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
      setSelectedCandidateId(null);
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
            {isSourceIncome ? 'Pair Payback with Purchase' : 'Link Friend Payback to Purchase'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Paired paybacks stay neutral: if paid back equally, both spending and income are £0. If paid back less, only the remaining cost is deducted from spending. If paid back more, only the extra amount is added to income.
          </DialogDescription>
        </DialogHeader>

        {/* Source Transaction Banner */}
        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isSourceIncome ? 'Incoming Payback Deposit' : 'Original Purchase'}
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
              {formatCurrency(Math.abs(sourceOrigAmt), sourceTransaction.currency || baseCurrency)}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {sourceTransaction.posted_at ? format(new Date(sourceTransaction.posted_at), 'MMM d, yyyy') : 'Recent'}
          </p>
        </div>

        {/* Existing Link Warning / Notice */}
        {isStandaloneRefund && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate font-semibold">Marked as Friend Payback (adds to Fun Money)</span>
            </div>
            {onUnlinkPayback && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUnlink}
                disabled={isSubmitting}
                className="text-[11px] h-7 text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
              >
                Unmark
              </Button>
            )}
          </div>
        )}

        {isAlreadyLinked && !isStandaloneRefund && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">
                {paybackMeta?.expense_description
                  ? `Paired with "${paybackMeta.expense_description}"`
                  : paybackMeta?.income_description
                  ? `Paired with "${paybackMeta.income_description}"`
                  : 'Currently paired as a payback.'}
              </span>
            </div>
            {onUnlinkPayback && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUnlink}
                disabled={isSubmitting}
                className="text-[11px] h-7 text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
              >
                Unlink
              </Button>
            )}
          </div>
        )}

        {/* Standalone Quick Action for Income */}
        {isSourceIncome && !isAlreadyLinked && onToggleStandalonePayback && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Don't have a specific tracked purchase to pair with? You can mark this deposit directly as a Friend Payback to credit it to this week's Fun Money:
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!sourceTransaction) return;
                setIsSubmitting(true);
                try {
                  await onToggleStandalonePayback(sourceTransaction);
                  onOpenChange(false);
                } finally {
                  setIsSubmitting(false);
                }
              }}
              disabled={isSubmitting}
              className="w-full text-xs font-bold text-emerald-700 border-emerald-300 hover:bg-emerald-50 h-8"
            >
              <Handshake className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
              Mark as Friend Payback (Add to Fun Money)
            </Button>
          </div>
        )}

        {/* Candidate Selector */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>{isSourceIncome ? 'Select Purchase to Pair With' : 'Select Incoming Payback Transfer'}</span>
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
                const candidateOrigAmt = getOrigAmount(candidate);
                const candidateAmtAbs = Math.abs(candidateOrigAmt);
                const isCandidateIncome = candidateOrigAmt > 0;
                const alreadyPaired = Boolean((candidate as any).is_payback_pair);
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
                        {alreadyPaired && ' · Already has a payback linked'}
                      </span>
                    </div>
                    <span
                      className={`font-bold tabular-nums shrink-0 ${
                        isCandidateIncome ? 'text-emerald-600' : 'text-slate-800'
                      }`}
                    >
                      {isCandidateIncome ? '+' : '−'}
                      {formatCurrency(candidateAmtAbs, candidate.currency || baseCurrency)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Net Spending & Income Preview */}
        {selectedCandidate && (
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-50 via-white to-sky-50 border border-emerald-300 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-700">
              <span>Purchase Cost:</span>
              <span className="font-semibold tabular-nums">−{formatCurrency(expenseAmt, baseCurrency)}</span>
            </div>
            <div className="flex items-center justify-between text-emerald-700">
              <span>Payback Received:</span>
              <span className="font-bold tabular-nums">+{formatCurrency(incomeAmt, baseCurrency)}</span>
            </div>
            <div className="border-t border-emerald-200 pt-1.5 space-y-1">
              <div className="flex items-center justify-between font-extrabold text-slate-900 text-xs">
                <span>Deducted from Weekly/Monthly Spending:</span>
                <span className="text-slate-900 tabular-nums">
                  {netRemainingSpend <= 0.01
                    ? '£0.00 (Neutral ✓)'
                    : `−${formatCurrency(netRemainingSpend, baseCurrency)}`}
                </span>
              </div>
              <div className="flex items-center justify-between font-extrabold text-slate-900 text-xs">
                <span>Added to Earned Income:</span>
                <span className="text-emerald-700 tabular-nums">
                  {netExcessIncome <= 0.01
                    ? '£0.00 (Neutral ✓)'
                    : `+${formatCurrency(netExcessIncome, baseCurrency)}`}
                </span>
              </div>
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
            {isSubmitting ? 'Pairing...' : 'Confirm Payback Pair'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
