import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, Check, Sparkles, Loader2, X, ArrowLeftRight, Target, Receipt, Undo2, DollarSign, Briefcase, RefreshCw, Wallet, Plus, Trash2, Scissors, Handshake, MoreHorizontal } from 'lucide-react';
import { formatCurrency, formatUkDate, parseUkDate, baseAmt } from '@/lib/financeUtils';
import { deduplicateTransactions } from '@/lib/deduplication';
import { format, isToday, isYesterday, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import { toast } from 'sonner';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FixedExpense } from '@/hooks/useFixedExpenses';
import SplitTransactionDialog from './SplitTransactionDialog';
import PaybackLinkDialog from './PaybackLinkDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';

type Props = { finance: ReturnType<typeof useFinanceData>; initialAccountFilter?: string; fixedExpenses?: FixedExpense[] };

type TransferFilter = 'all' | 'exclude_transfers' | 'transfers_only' | 'bills_only' | 'suggested_bills' | 'reimbursable_only';

const CATEGORY_TYPE_COLORS: Record<string, string> = {
  fixed: 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary-foreground))]',
  variable: 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent-foreground))]',
  income: 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]',
  transfer: 'bg-muted text-muted-foreground',
};

const INCOME_SOURCE_OPTIONS = [
  { name: 'Gamma Salary', color: '#DB2777' },
  { name: 'Venture Advisory', color: '#2563EB' },
  { name: 'Etsy', color: '#EA580C' },
  { name: 'Back Pocket Games', color: '#7C3AED' },
];

const isIncomeSourceName = (name?: string | null) => {
  const key = (name || '').trim().toLowerCase();
  return INCOME_SOURCE_OPTIONS.some(source => source.name.toLowerCase() === key);
};

function getCategoryBadgeStyle(cat: { color?: string | null; type: string }) {
  if (cat.color) {
    return {
      backgroundColor: `${cat.color}15`,
      color: cat.color,
      border: `1px solid ${cat.color}35`,
      fontWeight: 600,
    };
  }
  return undefined;
}

function getAccountBadgeStyle(provider?: string) {
  switch (provider) {
    case 'wise':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
    case 'up':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
    case 'monzo':
      return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800';
    case 'commbank':
      return 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-800';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}

// Left-edge accent colour for a transaction row.
function getRowAccent(tx: any, cat: any): string {
  // Neutral paired payback → soft emerald/slate neutral
  if (tx.is_payback_neutral) {
    return '#10b981';
  }
  // Cancelled / transfer → yellow
  const tstatus = tx.transfer_status;
  if (tx.is_transfer || tstatus === 'confirmed' || tstatus === 'auto_confirmed' || tstatus === 'suggested') {
    return '#facc15'; // yellow-400
  }
  // Income → green
  if (tx.amount > 0) return '#22c55e'; // green-500

  const name = `${cat?.name || ''} ${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
  // Med / pharmacy → red
  if (/(pharma|chemist|boots|superdrug|clinic|doctor|hospital|medic|dental|prescrip)/.test(name)) return '#ef4444';
  // Groceries → purple
  if (/(grocer|supermarket|tesco|sainsbury|asda|aldi|lidl|morrisons|waitrose|coles|woolworth|iga)/.test(name)) return '#a855f7';
  // Transport → blue
  if (/(transport|uber|bolt|lyft|taxi|cab|bus|train|tube|metro|tfl|opal|petrol|fuel|shell|bp|parking)/.test(name)) return '#3b82f6';
  // Social / food & drink → light green
  if (/(restaurant|cafe|coffee|pub|bar|dining|deliveroo|ubereats|just ?eat|food|social|drinks|takeaway|mcdonald|kfc|pret|starbuck|costa)/.test(name)) return '#86efac';
  // Fallback expense → red (soft)
  return '#f87171';
}

export default function FinanceTransactions({ finance, initialAccountFilter, fixedExpenses = [] }: Props) {
  const { transactions: rawTransactions, categories, accounts, goals, updateTransaction, addManualTransaction, deleteTransaction, categorizeTransactions, matchTransfers, addCategory } = finance;
  const transactions = useMemo(() => deduplicateTransactions(rawTransactions).cleaned, [rawTransactions]);

  // Precompute keyword list per fixed expense for "suggested bill" hint
  const fixedExpenseKeywords = fixedExpenses.map(e => {
    const raw = (e.name || '').toLowerCase();
    const words = raw.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !['bill', 'bills', 'incl', 'plan', 'flat', 'fees'].includes(w));
    return { expense: e, keywords: words.length ? words : [raw].filter(Boolean) };
  });

  const suggestBillFor = (tx: any): FixedExpense | null => {
    if (tx.fixed_expense_id || tx.is_fixed) return null;
    if (tx.amount >= 0 || tx.is_transfer) return null;
    const text = `${tx.merchant || ''} ${tx.description || ''}`.toLowerCase();
    for (const { expense, keywords } of fixedExpenseKeywords) {
      if (keywords.some(k => text.includes(k))) return expense;
    }
    return null;
  };
  const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const [syncingBanks, setSyncingBanks] = useState(false);

  // Manual Transaction Form state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newTxDescription, setNewTxDescription] = useState('');
  const [newTxAmount, setNewTxAmount] = useState('');
  const [newTxType, setNewTxType] = useState<'expense' | 'income'>('expense');
  const [newTxDate, setNewTxDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [newTxAccountId, setNewTxAccountId] = useState('');
  const [newTxCategoryId, setNewTxCategoryId] = useState('');
  const [newTxIsReimbursable, setNewTxIsReimbursable] = useState(false);
  const [submittingTx, setSubmittingTx] = useState(false);

  const handleAddManualTransaction = async () => {
    if (!newTxDescription.trim()) {
      toast.error('Please enter a description');
      return;
    }
    const parsedAmt = parseFloat(newTxAmount);
    if (isNaN(parsedAmt) || parsedAmt === 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    let targetAccountId = newTxAccountId;
    if (!targetAccountId) {
      const wiseAcc = accounts.find(a => a.provider === 'wise');
      targetAccountId = wiseAcc ? wiseAcc.id : (accounts[0]?.id || '');
    }

    if (!targetAccountId) {
      toast.error('Please select an account first');
      return;
    }

    setSubmittingTx(true);
    const finalAmount = newTxType === 'expense' ? -Math.abs(parsedAmt) : Math.abs(parsedAmt);
    
    // Check if matching rent bill
    const rentBill = fixedExpenses.find(e => e.name.toLowerCase().includes('rent'));
    const isRent = newTxDescription.toLowerCase().includes('rent') || (newTxCategoryId && categories.find(c => c.id === newTxCategoryId)?.name.toLowerCase().includes('rent'));

    const result = await addManualTransaction({
      account_id: targetAccountId,
      amount: finalAmount,
      description: newTxDescription.trim(),
      posted_at: new Date(newTxDate).toISOString(),
      category_id: newTxCategoryId || null,
    });

    if (result) {
      const updates: any = {};
      if (newTxIsReimbursable) {
        updates.is_reimbursable = true;
        updates.reimbursement_status = 'pending';
      }
      if (isRent || rentBill) {
        updates.is_fixed = true;
        if (rentBill) updates.fixed_expense_id = rentBill.id;
      }
      if (Object.keys(updates).length > 0) {
        await updateTransaction(result.id, updates);
      }
      toast.success('Transaction logged!');
      setAddDialogOpen(false);
      setNewTxDescription('');
      setNewTxAmount('');
      setNewTxIsReimbursable(false);
    }
    setSubmittingTx(false);
  };

  const handleSyncAllBanks = async () => {
    setSyncingBanks(true);
    try {
      const syncTasks: Promise<any>[] = [];
      if (finance.syncUpTransactions && accounts.some(a => a.provider === 'up')) {
        syncTasks.push(finance.syncUpTransactions({ skipAutoCategorize: true }));
      }
      if (finance.syncWiseTransactions && (accounts.some(a => a.provider === 'wise') || true)) {
        syncTasks.push(finance.syncWiseTransactions(undefined, { skipAutoCategorize: true }));
      }
      if (finance.syncMonzoTransactions && accounts.some(a => a.provider === 'monzo')) {
        syncTasks.push(finance.syncMonzoTransactions(undefined, { skipAutoCategorize: true }));
      }
      if (syncTasks.length === 0) {
        toast.info('No connected bank API accounts found (Wise, Monzo, or Up). Connect an account or import CSV in Accounts.');
      } else {
        await Promise.allSettled(syncTasks);
        await categorizeTransactions();
        await finance.refetch();
      }
    } catch (err) {
      console.error('Bank sync error:', err);
    } finally {
      setSyncingBanks(false);
    }
  };

  const [search, setSearch] = useState('');
  const [filterAccount, setFilterAccount] = useState<string>(initialAccountFilter || 'all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [transferFilter, setTransferFilter] = useState<TransferFilter>('all');
  const [categorizing, setCategorizing] = useState(false);
  const [matching, setMatching] = useState(false);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [lastChange, setLastChange] = useState<{ txId: string; oldCategoryId: string | null } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creatingIncomeSourcesRef = useRef(false);

  useEffect(() => {
    if (finance.loading || creatingIncomeSourcesRef.current) return;
    const missing = INCOME_SOURCE_OPTIONS.filter(source => (
      !categories.some(c => c.type === 'income' && c.name.trim().toLowerCase() === source.name.toLowerCase())
    ));
    if (missing.length === 0) return;

    creatingIncomeSourcesRef.current = true;
    Promise.all(missing.map(source => addCategory({ name: source.name, type: 'income', color: source.color }).catch(() => {})))
      .finally(() => { creatingIncomeSourcesRef.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finance.loading, categories.length]);

  const genericIncomeCategory = useMemo(() => (
    categories.find(c => c.type === 'income' && c.name.trim().toLowerCase() === 'income') || null
  ), [categories]);

  const incomeSourceCategories = useMemo(() => {
    const seen = new Set<string>();
    const incomeCats = categories.filter(c => c.type === 'income' && isIncomeSourceName(c.name));
    return INCOME_SOURCE_OPTIONS
      .map(source => {
        const match = incomeCats.find(c => c.name.trim().toLowerCase() === source.name.toLowerCase());
        if (!match || seen.has(source.name.toLowerCase())) return null;
        seen.add(source.name.toLowerCase());
        return match;
      })
      .filter(Boolean) as typeof categories;
  }, [categories]);

  const incomeCategoryOptions = useMemo(() => categories.filter(c => c.type === 'income'), [categories]);
  const expenseCategoryOptions = useMemo(() => categories.filter(c => c.type !== 'income'), [categories]);

  const uncategorizedCount = transactions.filter(tx => !tx.category_id).length;
  const transferCount = transactions.filter(tx => tx.is_transfer || tx.transfer_group_id).length;

  const billsCount = transactions.filter(tx => tx.is_fixed || (tx as any).fixed_expense_id).length;
  const suggestedCount = transactions.filter(tx => !!suggestBillFor(tx)).length;
  const reimbursableTxs = transactions.filter(tx => tx.is_reimbursable && tx.reimbursement_status !== 'reimbursed');
  const reimbursableCount = reimbursableTxs.length;
  const reimbursableTotal = reimbursableTxs.reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);

  const filtered = transactions.filter(tx => {
    if (filterAccount !== 'all' && tx.account_id !== filterAccount) return false;
    if (filterCategory !== 'all' && tx.category_id !== filterCategory) return false;
    if (search && !tx.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (transferFilter === 'exclude_transfers' && (tx.is_transfer || tx.transfer_group_id)) return false;
    if (transferFilter === 'transfers_only' && !tx.is_transfer && !tx.transfer_group_id) return false;
    if (transferFilter === 'bills_only' && !(tx.is_fixed || (tx as any).fixed_expense_id)) return false;
    if (transferFilter === 'suggested_bills' && !suggestBillFor(tx)) return false;
    if (transferFilter === 'reimbursable_only' && (!tx.is_reimbursable || tx.reimbursement_status === 'reimbursed')) return false;
    return true;
  });

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => parseUkDate(b.posted_at).getTime() - parseUkDate(a.posted_at).getTime());
  }, [filtered]);

  const getTxGroupHeader = useCallback((dateStr: string) => {
    // Parse through parseUkDate to ensure Australian Up Bank timestamps (AEST/AEDT)
    // are automatically converted into UK local living time (GMT/BST - Europe/London)
    const d = parseUkDate(dateStr);
    const now = new Date();

    if (isToday(d)) {
      return { key: 'today', label: 'Today' };
    }
    if (isYesterday(d)) {
      return { key: 'yesterday', label: 'Yesterday' };
    }

    const startThisWeek = startOfWeek(now, { weekStartsOn: 1 });
    const endThisWeek = endOfWeek(now, { weekStartsOn: 1 });
    if (d >= startThisWeek && d <= endThisWeek) {
      return {
        key: `week-${format(startThisWeek, 'yyyy-MM-dd')}`,
        label: `This Week (${format(startThisWeek, 'd MMM')} – ${format(endThisWeek, 'd MMM')})`,
      };
    }

    const startLastWeek = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const endLastWeek = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    if (d >= startLastWeek && d <= endLastWeek) {
      return {
        key: `week-${format(startLastWeek, 'yyyy-MM-dd')}`,
        label: `Last Week (${format(startLastWeek, 'd MMM')} – ${format(endLastWeek, 'd MMM')})`,
      };
    }

    const monthKey = format(d, 'yyyy-MM');
    const monthLabel = format(d, 'MMMM yyyy');
    return { key: monthKey, label: monthLabel };
  }, []);

  const baseCurrency = finance.settings?.base_currency || 'GBP';

  const groupedTransactions = useMemo(() => {
    const paginated = sortedFiltered.slice(0, page * PAGE_SIZE);
    const groups: { key: string; label: string; txs: typeof sortedFiltered; totalSpent: number; totalIncome: number }[] = [];
    const map = new Map<string, typeof groups[0]>();

    for (const tx of paginated) {
      const header = getTxGroupHeader(tx.posted_at);
      let g = map.get(header.key);
      if (!g) {
        g = { key: header.key, label: header.label, txs: [], totalSpent: 0, totalIncome: 0 };
        map.set(header.key, g);
        groups.push(g);
      }
      g.txs.push(tx);
      const isTransfer = tx.is_transfer || (tx as any).transfer_status === 'confirmed';
      if (!isTransfer) {
        const amt = baseAmt(tx);
        if (amt > 0) g.totalIncome += amt;
        else g.totalSpent += Math.abs(amt);
      }
    }
    return groups;
  }, [sortedFiltered, page, getTxGroupHeader]);

  const handleCategorize = async () => {
    setCategorizing(true);
    await categorizeTransactions();
    setCategorizing(false);
  };

  const handleMatchTransfers = async () => {
    setMatching(true);
    await matchTransfers();
    setMatching(false);
  };

  const [openPoolPopoverTxId, setOpenPoolPopoverTxId] = useState<string | null>(null);
  const assigningTxRef = useRef<Set<string>>(new Set());

  const handlePoolAssign = useCallback(async (txId: string, goalId: string | null) => {
    if (assigningTxRef.current.has(txId)) return;
    const tx = finance.transactions.find(t => t.id === txId);
    if (!tx) return;

    const prevGoalId = ((tx as any).goal_id as string | null) || null;
    if (prevGoalId === goalId) {
      setOpenPoolPopoverTxId(null);
      return;
    }

    assigningTxRef.current.add(txId);
    setOpenPoolPopoverTxId(null);

    try {
      const txAmountBase = Math.abs(baseAmt(tx));
      const toGoalNative = (amtBase: number, currency?: string | null) => {
        const oneInBase = finance.convertToBase(1, currency || baseCurrency) || 1;
        return Math.round((amtBase / oneInBase) * 100) / 100;
      };

      if (prevGoalId) {
        const prevGoal = goals.find(g => g.id === prevGoalId);
        if (prevGoal) {
          const refundNative = toGoalNative(txAmountBase, prevGoal.currency);
          await finance.updateGoal(prevGoalId, {
            assigned_amount: Math.round(((prevGoal.assigned_amount || 0) + refundNative) * 100) / 100,
          } as any);
        }
      }

      let targetCategoryId: string | null = null;

      if (goalId) {
        const newGoal = goals.find(g => g.id === goalId);
        if (newGoal) {
          const deductNative = toGoalNative(txAmountBase, newGoal.currency);
          const priorGoalTxs = finance.transactions.filter(
            t => t.id !== txId && (t as any).goal_id === goalId && t.amount < 0
          );
          const priorSpentBase = priorGoalTxs.reduce((s, t) => s + Math.abs(baseAmt(t)), 0);
          const priorSpentNative = toGoalNative(priorSpentBase, newGoal.currency);
          const currentAssigned = newGoal.assigned_amount || 0;
          const targetNative = newGoal.target_amount || 0;

          // If the pool has a target (e.g. £150) but assigned_amount was left at 0 when spending from it,
          // deduct from (target_amount - priorSpent) so the remaining balance is (150 - spent) instead of 0.
          const effectiveBeforeThisTx =
            currentAssigned <= 0 && targetNative > priorSpentNative
              ? Math.max(0, targetNative - priorSpentNative)
              : currentAssigned;

          const nextAssigned = Math.max(0, Math.round((effectiveBeforeThisTx - deductNative) * 100) / 100);

          await finance.updateGoal(goalId, {
            assigned_amount: nextAssigned,
          } as any);

          const goalName = newGoal.name;
          const existingCat = categories.find(
            c => c.name.trim().toLowerCase() === goalName.trim().toLowerCase()
          );

          if (existingCat) {
            targetCategoryId = existingCat.id;
          } else {
            const newCat = await addCategory({
              name: goalName,
              type: 'variable',
              color: newGoal.color || undefined,
            });
            if (newCat) {
              targetCategoryId = newCat.id;
            }
          }
        }
      }

      const updates: any = { goal_id: goalId };
      if (targetCategoryId) {
        updates.category_id = targetCategoryId;
      }

      await updateTransaction(txId, updates);
      const goalName = goalId ? goals.find(g => g.id === goalId)?.name : null;
      toast(goalName ? `Assigned to pool: ${goalName}` : 'Removed from pool');
    } finally {
      assigningTxRef.current.delete(txId);
    }
  }, [updateTransaction, goals, finance, categories, addCategory, baseCurrency]);

  const handleCategoryChange = useCallback(async (txId: string, oldCategoryId: string | null, newCategoryId: string | null) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    const tx = finance.transactions.find(t => t.id === txId);
    const newCat = newCategoryId ? categories.find(c => c.id === newCategoryId) : null;
    const matchedGoal = newCat && tx && tx.amount < 0
      ? goals.find(
          g =>
            !(g as any).is_stash &&
            !(g as any).is_emergency &&
            !/stash|emergency/i.test(g.name || '') &&
            g.name.trim().toLowerCase() === newCat.name.trim().toLowerCase()
        )
      : null;

    if (matchedGoal) {
      await handlePoolAssign(txId, matchedGoal.id);
      return;
    }

    if (tx && (tx as any).goal_id && (!matchedGoal || !newCategoryId)) {
      await handlePoolAssign(txId, null);
    }

    updateTransaction(txId, { category_id: newCategoryId } as any);
    setLastChange({ txId, oldCategoryId });

    const catName = newCat ? newCat.name : 'None';
    toast(`Category → ${catName || 'Cleared'}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          updateTransaction(txId, { category_id: oldCategoryId } as any);
          setLastChange(null);
        },
      },
      duration: 5000,
    });

    undoTimerRef.current = setTimeout(() => setLastChange(null), 5000);
  }, [updateTransaction, categories, finance.transactions, goals, handlePoolAssign]);

  const handleFixedExpenseAssign = useCallback((txId: string, expenseId: string | null) => {
    if (expenseId) {
      const expense = fixedExpenses.find(e => e.id === expenseId);
      updateTransaction(txId, { is_fixed: true, fixed_expense_id: expenseId } as any);
      toast(`Marked as bill: ${expense?.name || 'Fixed expense'}`);
    } else {
      updateTransaction(txId, { is_fixed: false, fixed_expense_id: null } as any);
      toast('Removed bill assignment');
    }
  }, [updateTransaction, fixedExpenses]);

  const handleIncomeSourceAssign = useCallback((txId: string, sourceCategoryId: string | null) => {
    updateTransaction(txId, { category_id: sourceCategoryId || genericIncomeCategory?.id || null } as any);
    const sourceName = sourceCategoryId ? categories.find(c => c.id === sourceCategoryId)?.name : 'Other';
    toast(sourceCategoryId ? `Income source → ${sourceName}` : 'Income source → Other');
  }, [updateTransaction, genericIncomeCategory, categories]);

  // Split Transaction & Payback dialog states
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [txToSplit, setTxToSplit] = useState<any | null>(null);

  const [paybackDialogOpen, setPaybackDialogOpen] = useState(false);
  const [sourceTxForPayback, setSourceTxForPayback] = useState<any | null>(null);

  const handleConfirmSplit = useCallback(async (
    parentTx: any,
    splits: { amount: number; goalId: string | null; categoryId: string | null; label: string }[]
  ) => {
    if (!parentTx || splits.length < 2) return;

    try {
      const isExpense = parentTx.amount < 0;
      const originalAmount = (parentTx.raw as any)?.split_meta?.original_amount ?? parentTx.amount;
      const originalDescription = (parentTx.raw as any)?.split_meta?.original_description ?? parentTx.description;
      const baseCur = finance.settings?.base_currency || 'GBP';
      const txCur = parentTx.currency || baseCur;

      const deductGoal = async (gId: string, amountAbs: number) => {
        const goal = goals.find(g => g.id === gId);
        if (!goal) return;
        const amtBase = finance.convertToBase(amountAbs, txCur);
        const oneInBase = finance.convertToBase(1, goal.currency || baseCur) || 1;
        const deductNative = Math.round((amtBase / oneInBase) * 100) / 100;
        const nextAssigned = Math.max(0, Math.round(((goal.assigned_amount || 0) - deductNative) * 100) / 100);
        await finance.updateGoal(gId, { assigned_amount: nextAssigned } as any);
      };

      // If parent previously had a goal, refund it before applying new splits
      const oldGoalId = (parentTx as any).goal_id;
      if (oldGoalId) {
        const oldGoal = goals.find(g => g.id === oldGoalId);
        if (oldGoal) {
          const amtBase = finance.convertToBase(Math.abs(parentTx.amount), txCur);
          const oneInBase = finance.convertToBase(1, oldGoal.currency || baseCur) || 1;
          const refundNative = Math.round((amtBase / oneInBase) * 100) / 100;
          await finance.updateGoal(oldGoalId, {
            assigned_amount: Math.round(((oldGoal.assigned_amount || 0) + refundNative) * 100) / 100,
          } as any);
        }
      }

      // Part 1: Updates the parent transaction
      const part1 = splits[0];
      const part1Amount = isExpense ? -Math.abs(part1.amount) : Math.abs(part1.amount);
      const part1BaseAmount = finance.convertToBase(part1Amount, txCur);

      if (part1.goalId) {
        await deductGoal(part1.goalId, part1.amount);
      }

      await updateTransaction(parentTx.id, {
        amount: part1Amount,
        base_amount: part1BaseAmount,
        category_id: part1.categoryId || parentTx.category_id,
        goal_id: part1.goalId || null,
        raw: {
          ...(parentTx.raw || {}),
          split_meta: {
            is_split_parent: true,
            original_amount: originalAmount,
            original_description: originalDescription,
            split_count: splits.length,
          },
        },
      } as any);

      // Remaining parts: add new child transactions
      for (let i = 1; i < splits.length; i++) {
        const part = splits[i];
        const partAmount = isExpense ? -Math.abs(part.amount) : Math.abs(part.amount);
        const partBaseAmount = finance.convertToBase(partAmount, txCur);

        if (part.goalId) {
          await deductGoal(part.goalId, part.amount);
        }

        const goalObj = part.goalId ? goals.find(g => g.id === part.goalId) : null;
        const partDesc = `${originalDescription} (${part.label || (goalObj ? goalObj.name : 'Weekly')})`;

        await finance.addTransaction({
          account_id: parentTx.account_id,
          amount: partAmount,
          base_amount: partBaseAmount,
          description: partDesc,
          posted_at: parentTx.posted_at,
          category_id: part.categoryId || parentTx.category_id,
          goal_id: part.goalId || null,
          currency: txCur,
          merchant: parentTx.merchant,
          is_fixed: false,
          is_reimbursable: false,
          is_transfer: false,
          raw: {
            ...(parentTx.raw || {}),
            split_meta: {
              is_split_child: true,
              parent_tx_id: parentTx.id,
              original_amount: originalAmount,
            },
          },
        } as any);
      }

      toast.success(`Successfully split into ${splits.length} portions!`);
      await finance.refetch();
    } catch (err) {
      console.error('Error splitting transaction:', err);
      toast.error('Failed to split transaction');
    }
  }, [finance, goals, updateTransaction]);

  const handleUnsplit = useCallback(async (parentTx: any) => {
    if (!parentTx) return;
    const parentId = (parentTx.raw as any)?.split_meta?.is_split_parent
      ? parentTx.id
      : (parentTx.raw as any)?.split_meta?.parent_tx_id || parentTx.id;

    const actualParent = finance.transactions.find(t => t.id === parentId) || parentTx;
    const baseCur = finance.settings?.base_currency || 'GBP';
    const txCur = actualParent.currency || baseCur;

    try {
      const refundGoal = async (gId: string, amountAbs: number) => {
        const goal = goals.find(g => g.id === gId);
        if (!goal) return;
        const amtBase = finance.convertToBase(amountAbs, txCur);
        const oneInBase = finance.convertToBase(1, goal.currency || baseCur) || 1;
        const refundNative = Math.round((amtBase / oneInBase) * 100) / 100;
        await finance.updateGoal(gId, {
          assigned_amount: Math.round(((goal.assigned_amount || 0) + refundNative) * 100) / 100,
        } as any);
      };

      const children = finance.transactions.filter(
        t => (t.raw as any)?.split_meta?.parent_tx_id === parentId
      );

      for (const child of children) {
        if ((child as any).goal_id) {
          await refundGoal((child as any).goal_id, Math.abs(child.amount));
        }
        await deleteTransaction(child.id);
      }

      if ((actualParent as any).goal_id) {
        await refundGoal((actualParent as any).goal_id, Math.abs(actualParent.amount));
      }

      const origAmount = (actualParent.raw as any)?.split_meta?.original_amount ?? actualParent.amount;
      const origDesc = (actualParent.raw as any)?.split_meta?.original_description ?? actualParent.description;
      const origBaseAmount = finance.convertToBase(origAmount, txCur);

      const updatedRaw = { ...(actualParent.raw || {}) };
      delete updatedRaw.split_meta;

      await updateTransaction(actualParent.id, {
        amount: origAmount,
        base_amount: origBaseAmount,
        description: origDesc,
        goal_id: null,
        raw: updatedRaw,
      } as any);

      toast.success('Transaction restored back to full amount!');
      await finance.refetch();
    } catch (err) {
      console.error('Error unsplitting transaction:', err);
      toast.error('Failed to unsplit transaction');
    }
  }, [finance, goals, deleteTransaction, updateTransaction]);

  const handleLinkPayback = useCallback(async (expenseTx: any, incomeTx: any) => {
    if (!expenseTx || !incomeTx) return;

    try {
      const origExpAmt = expenseTx.original_amount !== undefined ? Number(expenseTx.original_amount) : Number(expenseTx.amount) || 0;
      const origExpBase = expenseTx.original_base_amount !== undefined ? Number(expenseTx.original_base_amount) : Number(expenseTx.base_amount ?? expenseTx.amount) || 0;
      const origIncAmt = incomeTx.original_amount !== undefined ? Number(incomeTx.original_amount) : Number(incomeTx.amount) || 0;
      const origIncBase = incomeTx.original_base_amount !== undefined ? Number(incomeTx.original_base_amount) : Number(incomeTx.base_amount ?? incomeTx.amount) || 0;

      const expenseAbs = Math.abs(origExpAmt);
      const expenseBaseAbs = Math.abs(origExpBase);
      const paybackAbs = Math.abs(origIncAmt);
      const paybackBaseAbs = Math.abs(origIncBase);

      const existingExpMeta = (expenseTx.raw as any)?.payback_meta || {};
      const prevLinkedIds: string[] = Array.isArray(existingExpMeta.linked_income_ids)
        ? existingExpMeta.linked_income_ids
        : existingExpMeta.linked_income_id
        ? [existingExpMeta.linked_income_id]
        : [];
      const nextLinkedIncomeIds = Array.from(new Set([...prevLinkedIds, incomeTx.id]));

      // Sum total payback across all linked income transactions for this expense
      const totalPaybackBase = nextLinkedIncomeIds.reduce((sum, id) => {
        if (id === incomeTx.id) return sum + paybackBaseAbs;
        const found = finance.transactions.find(t => t.id === id);
        if (!found) return sum;
        const fOrigBase = (found as any).original_base_amount !== undefined ? Number((found as any).original_base_amount) : Number(found.base_amount ?? found.amount) || 0;
        return sum + Math.abs(fOrigBase);
      }, 0);

      const netSpendBase = Math.max(0, Math.round((expenseBaseAbs - totalPaybackBase) * 100) / 100);
      const netExcessIncomeBase = Math.max(0, Math.round((totalPaybackBase - expenseBaseAbs) * 100) / 100);

      const existingIncMeta = (incomeTx.raw as any)?.payback_meta || {};
      const prevExpIds: string[] = Array.isArray(existingIncMeta.linked_expense_ids)
        ? existingIncMeta.linked_expense_ids
        : existingIncMeta.linked_expense_id
        ? [existingIncMeta.linked_expense_id]
        : [];
      const nextLinkedExpenseIds = Array.from(new Set([...prevExpIds, expenseTx.id]));

      await updateTransaction(incomeTx.id, {
        is_refund: netExcessIncomeBase <= 0.01,
        raw: {
          ...(incomeTx.raw || {}),
          payback_meta: {
            is_payback: true,
            linked_expense_id: expenseTx.id,
            linked_expense_ids: nextLinkedExpenseIds,
            expense_description: expenseTx.description,
            expense_amount: origExpAmt,
            expense_base_amount: origExpBase,
            payback_amount: paybackAbs,
            payback_base_amount: paybackBaseAbs,
          },
        },
      } as any);

      await updateTransaction(expenseTx.id, {
        raw: {
          ...(expenseTx.raw || {}),
          payback_meta: {
            has_payback: true,
            linked_income_id: incomeTx.id,
            linked_income_ids: nextLinkedIncomeIds,
            income_description: incomeTx.description,
            payback_amount: totalPaybackBase,
            payback_base_amount: totalPaybackBase,
            net_amount: netSpendBase,
          },
        },
      } as any);

      const baseCur = finance.settings?.base_currency || 'GBP';
      if (netSpendBase <= 0.01 && netExcessIncomeBase <= 0.01) {
        toast.success(`Paired payback! Both "${expenseTx.description}" and the payback are now neutral (£0 spend · £0 income).`);
      } else if (netSpendBase > 0.01) {
        toast.success(
          `Paired payback! Only the remaining −${formatCurrency(netSpendBase, baseCur)} is deducted from spending (£0 added to income).`
        );
      } else {
        toast.success(
          `Paired payback! "${expenseTx.description}" is neutral (£0 spend) and only the extra +${formatCurrency(netExcessIncomeBase, baseCur)} is added to income.`
        );
      }
      await finance.refetch();
    } catch (err) {
      console.error('Error linking payback:', err);
      toast.error('Failed to link payback');
    }
  }, [finance, updateTransaction]);

  const handleUnlinkPayback = useCallback(async (tx: any) => {
    if (!tx) return;

    try {
      const meta = (tx.raw as any)?.payback_meta;
      if (!meta) return;

      if (meta.is_payback) {
        const expIds: string[] = Array.isArray(meta.linked_expense_ids)
          ? meta.linked_expense_ids
          : meta.linked_expense_id
          ? [meta.linked_expense_id]
          : [];
        const updatedIncomeRaw = { ...(tx.raw || {}) };
        delete updatedIncomeRaw.payback_meta;

        await updateTransaction(tx.id, {
          is_refund: false,
          raw: updatedIncomeRaw,
        } as any);

        for (const linkedExpenseId of expIds) {
          const expenseTx = finance.transactions.find(t => t.id === linkedExpenseId);
          if (expenseTx) {
            const updatedExpenseRaw = { ...(expenseTx.raw || {}) };
            delete updatedExpenseRaw.payback_meta;
            await updateTransaction(expenseTx.id, {
              raw: updatedExpenseRaw,
            } as any);
          }
        }
      } else if (meta.has_payback) {
        const incIds: string[] = Array.isArray(meta.linked_income_ids)
          ? meta.linked_income_ids
          : meta.linked_income_id
          ? [meta.linked_income_id]
          : [];
        const updatedExpenseRaw = { ...(tx.raw || {}) };
        delete updatedExpenseRaw.payback_meta;

        await updateTransaction(tx.id, {
          raw: updatedExpenseRaw,
        } as any);

        for (const linkedIncomeId of incIds) {
          const incomeTx = finance.transactions.find(t => t.id === linkedIncomeId);
          if (incomeTx) {
            const updatedIncomeRaw = { ...(incomeTx.raw || {}) };
            delete updatedIncomeRaw.payback_meta;
            await updateTransaction(incomeTx.id, {
              is_refund: false,
              raw: updatedIncomeRaw,
            } as any);
          }
        }
      }

      toast.success('Payback link removed.');
      await finance.refetch();
    } catch (err) {
      console.error('Error unlinking payback:', err);
      toast.error('Failed to unlink payback');
    }
  }, [finance, updateTransaction]);

  return (
    <div className="space-y-4">
      {/* Filters + Actions */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 w-full">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transactions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 text-xs sm:text-sm"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 touch-scroll">
          <Select value={filterAccount} onValueChange={setFilterAccount}>
            <SelectTrigger className="w-36 sm:w-44 shrink-0 text-xs">
              <SelectValue placeholder="Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts ({transactions.length})</SelectItem>
              {accounts.map(a => {
                const count = transactions.filter(t => t.account_id === a.id).length;
                return (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_name} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-32 sm:w-36 shrink-0 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All Categories</SelectItem>
              {incomeCategoryOptions.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30">Income Streams</div>
                  {incomeCategoryOptions.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color || '#22c55e' }} />
                        {c.name}
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
              {expenseCategoryOptions.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30 border-t my-1">Expense Categories</div>
                  {expenseCategoryOptions.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color || '#888' }} />
                        {c.name}
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        {uncategorizedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleCategorize}
            disabled={categorizing}
            className="gap-1.5"
          >
            {categorizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {categorizing ? 'Categorising...' : `Auto-categorise (${uncategorizedCount})`}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleMatchTransfers}
          disabled={matching}
          className="gap-1.5"
        >
          {matching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeftRight className="w-3.5 h-3.5" />}
          {matching ? 'Matching...' : 'Match Transfers'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSyncAllBanks}
          disabled={syncingBanks}
          className="gap-1.5"
        >
          {syncingBanks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {syncingBanks ? 'Syncing...' : 'Sync Banks'}
        </Button>

        {/* Add Transaction Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 font-bold">
              <Plus className="w-4 h-4" /> Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Log a Transaction</DialogTitle>
              <DialogDescription>
                Manually record a payment, rent transfer, or expense.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Description / Merchant</Label>
                <Input
                  placeholder="e.g. Rent Payment - September"
                  value={newTxDescription}
                  onChange={e => setNewTxDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Amount (£)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 720.00"
                    value={newTxAmount}
                    onChange={e => setNewTxAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Type</Label>
                  <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setNewTxType('expense')}
                      className={`flex-1 py-1 text-xs font-bold rounded-md transition-colors ${
                        newTxType === 'expense' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      Expense
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewTxType('income')}
                      className={`flex-1 py-1 text-xs font-bold rounded-md transition-colors ${
                        newTxType === 'income' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      Income
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Date</Label>
                  <Input
                    type="date"
                    value={newTxDate}
                    onChange={e => setNewTxDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Account</Label>
                  <Select value={newTxAccountId} onValueChange={setNewTxAccountId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder={accounts.find(a => a.provider === 'wise')?.account_name || accounts[0]?.account_name || 'Select account'} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Category (Optional)</Label>
                <Select value={newTxCategoryId} onValueChange={setNewTxCategoryId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    <SelectItem value="__none__">None / Uncategorised</SelectItem>
                    {(newTxType === 'income' ? incomeCategoryOptions : expenseCategoryOptions).map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color || '#888' }} />
                          {c.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="reimbursable_chk"
                  checked={newTxIsReimbursable}
                  onChange={e => setNewTxIsReimbursable(e.target.checked)}
                  className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                />
                <label htmlFor="reimbursable_chk" className="text-xs text-slate-600 font-medium cursor-pointer">
                  Mark as Work Travel Reimbursement claim
                </label>
              </div>

              <Button
                className="w-full font-bold mt-2"
                onClick={handleAddManualTransaction}
                disabled={submittingTx}
              >
                {submittingTx ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                {submittingTx ? 'Saving...' : 'Save Transaction'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1.5 pt-0.5 touch-scroll -mx-1 px-1">
        {([
          { key: 'all' as const, label: 'All' },
          { key: 'exclude_transfers' as const, label: 'Exclude Transfers' },
          { key: 'transfers_only' as const, label: `Transfers (${transferCount})` },
          { key: 'bills_only' as const, label: `Bills (${billsCount})` },
          { key: 'suggested_bills' as const, label: `Suggested Bills (${suggestedCount})` },
          { key: 'reimbursable_only' as const, label: `💼 Work Claims (${reimbursableCount})` },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTransferFilter(key)}
            className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium transition-colors border inline-flex items-center gap-1.5 ${
              transferFilter === key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:border-primary/40'
            }`}
          >
            <span>{label}</span>
            {key === 'reimbursable_only' && reimbursableTotal > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                  transferFilter === 'reimbursable_only'
                    ? 'bg-white/20 text-white'
                    : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                }`}
              >
                {formatCurrency(reimbursableTotal, baseCurrency)}
              </span>
            )}
          </button>
        ))}
      </div>

      {transferFilter === 'reimbursable_only' && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-2xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/50">
          <div className="flex items-center gap-2 text-xs text-sky-950 dark:text-sky-100 font-medium">
            <span>💼 Pending Work Claims</span>
            <span className="text-sky-600/80 dark:text-sky-300/80">
              ({reimbursableCount} {reimbursableCount === 1 ? 'item' : 'items'})
            </span>
          </div>
          <Badge className="bg-sky-600 hover:bg-sky-600 text-white font-display font-bold text-xs px-3 py-1 rounded-full tabular-nums shadow-xs">
            Total Outstanding: {formatCurrency(reimbursableTotal, baseCurrency)}
          </Badge>
        </div>
      )}

      {/* Transaction List */}
      <div className="space-y-5">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              No transactions yet. Import a CSV or sync your bank to get started.
            </CardContent>
          </Card>
        ) : (
          groupedTransactions.map(group => (
            <div key={group.key} className="space-y-1.5">
              {/* Group Section Heading */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-4 sm:px-5 py-2 bg-slate-100/95 dark:bg-slate-800/95 backdrop-blur-md rounded-xl text-xs font-display font-bold text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 shadow-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#FF2EB8]" />
                  <span>{group.label}</span>
                  <span className="text-[10px] text-slate-400 font-medium">({group.txs.length})</span>
                </div>
                <div className="flex items-center gap-3 sm:gap-4 text-[11px] font-semibold tabular-nums pr-2 sm:pr-24">
                  {group.totalSpent > 0 && (
                    <span className="text-slate-600 dark:text-slate-300">
                      Spent: <strong className="text-slate-900 dark:text-white font-bold">{formatCurrency(group.totalSpent, baseCurrency)}</strong>
                    </span>
                  )}
                  {group.totalIncome > 0 && (
                    <span className="text-emerald-600 font-bold">
                      + {formatCurrency(group.totalIncome, baseCurrency)}
                    </span>
                  )}
                </div>
              </div>

              {/* Transactions in this group */}
              <div className="space-y-1">
                {group.txs.map(tx => {
                  const cat = categories.find(c => c.id === tx.category_id);
                  const fullDesc = `${tx.description || ''} ${tx.merchant || ''}`.toLowerCase();
                  const isVentureIncome = tx.amount > 0 && (
                    fullDesc.includes('batchbase') ||
                    fullDesc.includes('batch base') ||
                    fullDesc.includes('venture') ||
                    fullDesc.includes('advisory') ||
                    (fullDesc.includes('gabriella') && !tx.transfer_group_id)
                  );
                  const ventureCategory = categories.find(c => c.name.trim().toLowerCase() === 'income' && c.type === 'income');
                  const displayCat = cat || (isVentureIncome ? ventureCategory : null);
                  const catColor = displayCat ? (CATEGORY_TYPE_COLORS[displayCat.type] || CATEGORY_TYPE_COLORS.variable) : '';

                  const isTransfer = !isVentureIncome && (tx.is_transfer || !!tx.transfer_group_id);
                  const transferStatus = isVentureIncome ? null : ((tx as any).transfer_status as string | null);
                  const isConfirmedTransfer = transferStatus === 'confirmed' || transferStatus === 'auto_confirmed';
                  const isIncomeTransaction = tx.amount > 0 && !isTransfer && !isConfirmedTransfer && !(tx as any).is_refund;

                  const assignedGoal = (tx as any).goal_id ? goals.find(g => g.id === (tx as any).goal_id) : null;
                  const assignedFixedExpense = (tx as any).fixed_expense_id ? fixedExpenses.find(e => e.id === (tx as any).fixed_expense_id) : null;
                  const suggestedBill = assignedFixedExpense ? null : suggestBillFor(tx);

                  const getTransferBadge = () => {
                    if (!isTransfer && !transferStatus) return null;
                    if (transferStatus === 'auto_confirmed') return (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        <ArrowLeftRight className="w-2.5 h-2.5 mr-0.5" />Auto Transfer
                      </Badge>
                    );
                    if (transferStatus === 'confirmed') return (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]">
                        <ArrowLeftRight className="w-2.5 h-2.5 mr-0.5" />Transfer
                      </Badge>
                    );
                    if (transferStatus === 'suggested') return (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <ArrowLeftRight className="w-2.5 h-2.5 mr-0.5" />Suggested
                      </Badge>
                    );
                    if (isTransfer) return (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <ArrowLeftRight className="w-2.5 h-2.5 mr-0.5" />Unmatched
                      </Badge>
                    );
                    return null;
                  };

                  const txAccount = accountMap.get(tx.account_id);
                  const accent = getRowAccent(tx, cat);
                  const isBillCategorized = (tx.is_fixed || cat?.type === 'fixed') && !assignedFixedExpense;

                  const isRealIncome = tx.amount > 0 && !isTransfer && !isConfirmedTransfer && !transferStatus;

                  return (
                    <div
                      key={tx.id}
                      className={`relative flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 py-2.5 px-4 rounded-2xl border transition-all overflow-hidden ${
                        isRealIncome
                          ? 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200/80 dark:bg-emerald-950/25 dark:border-emerald-900/40'
                          : 'bg-white hover:bg-slate-50/80 border-slate-100'
                      }`}
                      style={{ boxShadow: `inset 4px 0 0 0 ${accent}` }}
                    >
                      {/* Left: Description & Metadata */}
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-display font-bold text-slate-900 truncate">{tx.description}</p>
                          {getTransferBadge()}
                          {assignedGoal && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-primary/10 text-primary">
                              <Target className="w-2.5 h-2.5 mr-0.5" />{assignedGoal.name}
                            </Badge>
                          )}
                          {assignedFixedExpense && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 bg-destructive/10 text-destructive">
                              <Receipt className="w-2.5 h-2.5 mr-0.5" />{assignedFixedExpense.name}
                            </Badge>
                          )}
                          {/* Split badges */}
                          {Boolean((tx.raw as any)?.split_meta?.is_split_parent) && (
                            <Badge
                              variant="secondary"
                              onClick={() => {
                                setTxToSplit(tx);
                                setSplitDialogOpen(true);
                              }}
                              className="text-[9px] px-1.5 py-0 shrink-0 cursor-pointer bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 border border-fuchsia-200 transition-colors"
                              title="Split transaction — click to view or unsplit"
                            >
                              <Scissors className="w-2.5 h-2.5 mr-0.5" />
                              Split ({formatCurrency(Math.abs((tx.raw as any).split_meta.original_amount), tx.currency || baseCurrency)})
                            </Badge>
                          )}
                          {Boolean((tx.raw as any)?.split_meta?.is_split_child) && (
                            <Badge
                              variant="secondary"
                              onClick={() => {
                                const parent = finance.transactions.find(t => t.id === (tx.raw as any).split_meta?.parent_tx_id);
                                if (parent) {
                                  setTxToSplit(parent);
                                  setSplitDialogOpen(true);
                                }
                              }}
                              className="text-[9px] px-1.5 py-0 shrink-0 cursor-pointer bg-fuchsia-50 text-fuchsia-600 hover:bg-fuchsia-100 dark:bg-fuchsia-950/20 dark:text-fuchsia-400 border border-fuchsia-200 transition-colors"
                              title="Split portion — click to view parent split"
                            >
                              <Scissors className="w-2.5 h-2.5 mr-0.5" />
                              Split portion
                            </Badge>
                          )}
                          {/* Payback badges */}
                          {Boolean((tx.raw as any)?.payback_meta?.has_payback || (tx as any).is_paired_payback_expense) && (
                            <Badge
                              variant="secondary"
                              onClick={() => {
                                setSourceTxForPayback(tx);
                                setPaybackDialogOpen(true);
                              }}
                              className="text-[9px] px-1.5 py-0 shrink-0 cursor-pointer bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300 transition-colors"
                              title="Friend payback linked — click to view or unlink"
                            >
                              <Handshake className="w-2.5 h-2.5 mr-0.5" />
                              {(tx as any).is_payback_neutral
                                ? 'Paid back · Neutral (£0 spend)'
                                : `Payback: +${formatCurrency((tx as any).payback_covered_base ?? (tx.raw as any)?.payback_meta?.payback_amount ?? 0, baseCurrency)} · Net: ${formatCurrency(tx.base_amount ?? tx.amount, baseCurrency)}`}
                            </Badge>
                          )}
                          {Boolean((tx.raw as any)?.payback_meta?.is_payback || (tx as any).is_paired_payback_income) && (
                            <Badge
                              variant="secondary"
                              onClick={() => {
                                setSourceTxForPayback(tx);
                                setPaybackDialogOpen(true);
                              }}
                              className="text-[9px] px-1.5 py-0 shrink-0 cursor-pointer bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300 transition-colors"
                              title="Friend payback linked to purchase — click to view or unlink"
                            >
                              <Handshake className="w-2.5 h-2.5 mr-0.5" />
                              {(tx as any).is_payback_neutral
                                ? `Payback for: ${(tx.raw as any)?.payback_meta?.expense_description || 'Purchase'} · Neutral (£0 income)`
                                : `Covered ${formatCurrency((tx as any).payback_used_base ?? 0, baseCurrency)} · +${formatCurrency(tx.base_amount ?? tx.amount, baseCurrency)} net income`}
                            </Badge>
                          )}
                          {tx.is_reimbursable && (
                            <Badge
                              variant="secondary"
                              className={`text-[9px] px-1.5 py-0 shrink-0 cursor-pointer hover:opacity-85 transition-opacity flex items-center gap-1 ${
                                tx.reimbursement_status === 'reimbursed'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                              }`}
                              onClick={() => {
                                const newStatus = tx.reimbursement_status === 'reimbursed' ? 'pending' : 'reimbursed';
                                updateTransaction(tx.id, {
                                  is_reimbursable: true,
                                  reimbursement_status: newStatus,
                                  reimbursed_at: newStatus === 'reimbursed' ? new Date().toISOString() : null,
                                } as any);
                                toast.success(newStatus === 'reimbursed' ? '✓ Settled & removed from active Work Claims' : 'Reopened as Pending Claim');
                              }}
                              title={tx.reimbursement_status === 'reimbursed' ? 'Settled (click to reopen)' : 'Pending claim — click to mark settled'}
                            >
                              <Briefcase className="w-2.5 h-2.5 mr-0.5" />
                              {tx.reimbursement_status === 'reimbursed' ? 'Work Reimbursed ✓' : 'Work Claim Pending'}
                            </Badge>
                          )}
                          {suggestedBill && (
                            <button
                              onClick={() => handleFixedExpenseAssign(tx.id, suggestedBill.id)}
                              className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded border border-dashed border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                              title={`Looks like your "${suggestedBill.name}" bill — click to link`}
                            >
                              <Receipt className="w-2.5 h-2.5" />Link to {suggestedBill.name}?
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatUkDate(tx.posted_at, 'dd MMM yyyy')}
                          {tx.merchant && ` · ${tx.merchant}`}
                          {tx.transfer_side && ` · ${tx.transfer_side === 'out' ? '→ Out' : '← In'}`}
                        </p>
                      </div>

                      {/* Right: Category, Amount & Actions in clean aligned columns (mobile responsive) */}
                      <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-6 w-full sm:w-auto shrink-0 mt-1 sm:mt-0 pt-1.5 sm:pt-0 border-t border-slate-100/80 dark:border-slate-800/60 sm:border-0">
                        {/* Category pill */}
                        <div className="w-auto sm:w-28 flex justify-start shrink-0 min-w-0">
                          <Popover>
                            <PopoverTrigger asChild>
                              {displayCat ? (
                                <button className="cursor-pointer shrink-0 max-w-full">
                                  <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 font-semibold truncate max-w-full hover:opacity-80 transition-opacity ${!displayCat.color ? catColor : ''}`}
                                    style={getCategoryBadgeStyle(displayCat)}
                                  >
                                    <span className="truncate">{displayCat.name}</span>
                                  </Badge>
                                </button>
                              ) : (
                                <button className="cursor-pointer shrink-0">
                                  <Badge variant="outline" className="text-[10px] px-2 py-0.5 text-muted-foreground hover:opacity-80">
                                    Uncategorised
                                  </Badge>
                                </button>
                              )}
                            </PopoverTrigger>
                            <PopoverContent className="w-48 p-2" align="end" side="top" sideOffset={8}>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                                {isRealIncome ? 'Assign Income Stream' : 'Assign Expense Category'}
                              </p>
                              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                {(isRealIncome ? incomeCategoryOptions : expenseCategoryOptions).map(c => (
                                  <button
                                    key={c.id}
                                    onClick={() => handleCategoryChange(tx.id, tx.category_id, c.id)}
                                    className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                                      tx.category_id === c.id ? 'bg-muted font-bold' : ''
                                    }`}
                                  >
                                    {c.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                                    <span className="truncate">{c.name}</span>
                                  </button>
                                ))}
                              </div>
                              {tx.category_id && (
                                <>
                                  <div className="border-t my-1.5" />
                                  <button
                                    onClick={() => handleCategoryChange(tx.id, tx.category_id, null)}
                                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-destructive/10 text-destructive flex items-center gap-1.5"
                                  >
                                    <X className="w-3 h-3" /> Clear category
                                  </button>
                                </>
                              )}
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* Amount & Actions container */}
                        <div className="flex items-center gap-2.5 sm:gap-6 shrink-0 ml-auto">
                          {/* Amount */}
                          <div className="w-auto sm:w-36 text-right sm:text-left shrink-0">
                          <p
                            className={`text-xs sm:text-sm font-display font-bold tabular-nums ${
                              (tx as any).is_payback_neutral
                                ? 'text-slate-400'
                                : isRealIncome
                                ? 'text-[hsl(var(--success))]'
                                : 'text-slate-900'
                            }`}
                          >
                            {(() => {
                              if ((tx as any).is_payback_neutral) {
                                return `${formatCurrency(0, finance.settings?.base_currency || 'GBP')} (Neutral)`;
                              }
                              const rawAmt = tx.base_amount !== undefined && tx.base_amount !== null ? tx.base_amount : tx.amount;
                              const formatted = formatCurrency(rawAmt, finance.settings?.base_currency || 'GBP');
                              return isRealIncome && !formatted.startsWith('+') ? `+${formatted}` : formatted;
                            })()}
                          </p>
                          {(tx as any).is_payback_pair && (tx as any).original_base_amount !== undefined && Math.abs(Number((tx as any).original_base_amount) - Number(tx.base_amount || 0)) > 0.01 && (
                            <p className="text-[10px] text-slate-400 line-through tabular-nums truncate">
                              {(() => {
                                const origB = Number((tx as any).original_base_amount) || 0;
                                const f = formatCurrency(origB, finance.settings?.base_currency || 'GBP');
                                return origB > 0 && !f.startsWith('+') ? `+${f}` : f;
                              })()}
                            </p>
                          )}
                          {(() => {
                            const cur = (tx.currency || finance.settings?.base_currency || 'GBP').toUpperCase();
                            const base = (finance.settings?.base_currency || 'GBP').toUpperCase();
                            if (cur && cur !== base) {
                              const nativeFormatted = formatCurrency(tx.amount, cur);
                              return (
                                <p className="text-[10px] text-muted-foreground tabular-nums truncate">
                                  {isRealIncome && !nativeFormatted.startsWith('+') ? `+${nativeFormatted}` : nativeFormatted} {cur}
                                </p>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        {/* Desktop Action Icons Toolbar (Comfortable fixed-width container on larger screens) */}
                        <div className="hidden sm:flex items-center justify-end gap-1.5 shrink-0 w-40 sm:w-48">
                          {/* Pool assignment / refund flag */}
                          {tx.amount < 0 && goals.length > 0 ? (
                            <Popover open={openPoolPopoverTxId === tx.id} onOpenChange={open => setOpenPoolPopoverTxId(open ? tx.id : null)}>
                              <PopoverTrigger asChild>
                                <button
                                  className={`p-1 rounded shrink-0 transition-colors ${assignedGoal ? 'text-primary' : 'text-slate-300 hover:text-slate-600'}`}
                                  title={assignedGoal ? `Pool: ${assignedGoal.name} (click to change)` : 'Assign to pool'}
                                >
                                  <Target className="w-4 h-4" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-48 p-2" align="end" side="top" sideOffset={8}>
                                <p className="text-[10px] font-medium text-muted-foreground mb-1.5 px-1">Assign to pool</p>
                                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                  {goals.map(g => (
                                    <button
                                      key={g.id}
                                      onClick={() => handlePoolAssign(tx.id, g.id)}
                                      className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                                        (tx as any).goal_id === g.id ? 'bg-muted font-medium' : ''
                                      }`}
                                    >
                                      {g.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />}
                                      {g.name}
                                    </button>
                                  ))}
                                </div>
                                {(tx as any).goal_id && (
                                  <>
                                    <div className="border-t my-1.5" />
                                    <button
                                      onClick={() => handlePoolAssign(tx.id, null)}
                                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-destructive/10 text-destructive flex items-center gap-1.5"
                                    >
                                      <X className="w-3 h-3" /> Remove from pool
                                    </button>
                                  </>
                                )}
                                <div className="border-t my-1.5" />
                                <button
                                  onClick={() => {
                                    setOpenPoolPopoverTxId(null);
                                    setTxToSplit(tx);
                                    setSplitDialogOpen(true);
                                  }}
                                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted/60 transition-colors flex items-center gap-1.5 font-semibold text-primary"
                                >
                                  <Scissors className="w-3.5 h-3.5 text-primary" /> Split with a pot...
                                </button>
                              </PopoverContent>
                            </Popover>
                          ) : tx.amount > 0 && !tx.is_transfer ? (
                            <button
                              onClick={() => {
                                const newIsRefund = !(tx as any).is_refund;
                                updateTransaction(tx.id, { is_refund: newIsRefund } as any);
                                toast(newIsRefund ? 'Marked as refund — added back to this week\'s Fun Money' : 'Refund flag removed');
                              }}
                              className={`p-1 rounded shrink-0 transition-colors ${(tx as any).is_refund ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 hover:text-slate-600'}`}
                              title={(tx as any).is_refund ? 'Refund (boosts Fun Money) — click to unmark' : 'Mark as refund (adds to Fun Money this week)'}
                            >
                              <Undo2 className="w-4 h-4" />
                            </button>
                          ) : null}

                          {/* Split button (for expenses) */}
                          {tx.amount < 0 && (
                            <button
                              onClick={() => {
                                setTxToSplit(tx);
                                setSplitDialogOpen(true);
                              }}
                              className={`p-1 rounded shrink-0 transition-colors ${
                                (tx.raw as any)?.split_meta?.is_split_parent
                                  ? 'text-fuchsia-600 font-bold'
                                  : 'text-slate-300 hover:text-slate-600'
                              }`}
                              title={
                                (tx.raw as any)?.split_meta?.is_split_parent
                                  ? 'Split transaction (click to view or unsplit)'
                                  : 'Split expense between pots & weekly budget'
                              }
                            >
                              <Scissors className="w-4 h-4" />
                            </button>
                          )}

                          {/* Payback Link button (for friend paybacks / repayments) */}
                          {!tx.is_transfer && (
                            <button
                              onClick={() => {
                                setSourceTxForPayback(tx);
                                setPaybackDialogOpen(true);
                              }}
                              className={`p-1 rounded shrink-0 transition-colors ${
                                (tx.raw as any)?.payback_meta
                                  ? 'text-emerald-600 font-bold'
                                  : 'text-slate-300 hover:text-slate-600'
                              }`}
                              title={
                                (tx.raw as any)?.payback_meta
                                  ? 'Linked Payback (click to view or unlink)'
                                  : tx.amount > 0
                                  ? 'Link friend payback to a purchase'
                                  : 'Link friend payback received for this expense'
                              }
                            >
                              <Handshake className="w-4 h-4" />
                            </button>
                          )}

                          {/* Fixed expense / bill assignment */}
                          {tx.amount < 0 && fixedExpenses.length > 0 && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className={`p-1 rounded shrink-0 transition-colors ${assignedFixedExpense ? 'text-destructive' : 'text-slate-300 hover:text-slate-600'}`}
                                  title={assignedFixedExpense ? `Bill: ${assignedFixedExpense.name} (click to change)` : 'Mark as bill payment'}
                                >
                                  <Receipt className="w-4 h-4" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-44 p-2" align="end" side="top" sideOffset={8}>
                                <p className="text-[10px] font-medium text-muted-foreground mb-1.5 px-1">Mark as bill</p>
                                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                  {fixedExpenses.map(e => (
                                    <button
                                      key={e.id}
                                      onClick={() => handleFixedExpenseAssign(tx.id, e.id)}
                                      className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                                        (tx as any).fixed_expense_id === e.id ? 'bg-muted font-medium' : ''
                                      }`}
                                    >
                                      {e.name}
                                      <span className="ml-auto text-muted-foreground text-[10px]">{formatCurrency(e.amount, e.currency)}/{e.frequency}</span>
                                    </button>
                                  ))}
                                </div>
                                {(tx as any).fixed_expense_id && (
                                  <>
                                    <div className="border-t my-1.5" />
                                    <button
                                      onClick={() => handleFixedExpenseAssign(tx.id, null)}
                                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-destructive/10 text-destructive flex items-center gap-1.5"
                                    >
                                      <X className="w-3 h-3" /> Remove bill tag
                                    </button>
                                  </>
                                )}
                              </PopoverContent>
                            </Popover>
                          )}

                          {/* Work Travel Reimbursement flag & manage popover */}
                          {!tx.is_reimbursable ? (
                            <button
                              onClick={() => {
                                updateTransaction(tx.id, {
                                  is_reimbursable: true,
                                  reimbursement_status: 'pending',
                                } as any);
                                toast.success('💼 Marked as Work Travel Reimbursement — excluded from personal spend');
                              }}
                              className="p-1 rounded shrink-0 transition-colors text-slate-300 hover:text-slate-600"
                              title="Mark as Work Travel Reimbursement"
                            >
                              <Briefcase className="w-4 h-4" />
                            </button>
                          ) : (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className={`p-1 rounded shrink-0 transition-colors ${
                                    tx.reimbursement_status === 'reimbursed'
                                      ? 'text-emerald-600 font-bold'
                                      : 'text-sky-600 font-bold'
                                  }`}
                                  title={
                                    tx.reimbursement_status === 'reimbursed'
                                      ? 'Work Claim Settled / Reimbursed (click to manage)'
                                      : 'Work Claim Pending (click to settle or remove)'
                                  }
                                >
                                  <Briefcase className="w-4 h-4" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-52 p-2" align="end" side="top" sideOffset={8}>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                                  Work Travel Claim
                                </p>
                                <div className="space-y-1">
                                  <button
                                    onClick={() => {
                                      const newStatus = tx.reimbursement_status === 'reimbursed' ? 'pending' : 'reimbursed';
                                      updateTransaction(tx.id, {
                                        is_reimbursable: true,
                                        reimbursement_status: newStatus,
                                        reimbursed_at: newStatus === 'reimbursed' ? new Date().toISOString() : null,
                                      } as any);
                                      toast.success(newStatus === 'reimbursed' ? '✓ Settled & removed from active Work Claims' : 'Reopened as Pending Claim');
                                    }}
                                    className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors flex items-center gap-2 font-medium ${
                                      tx.reimbursement_status === 'reimbursed'
                                        ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                    }`}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    {tx.reimbursement_status === 'reimbursed' ? 'Reopen Claim as Pending' : 'Mark as Settled / Reimbursed'}
                                  </button>

                                  <div className="border-t my-1" />

                                  <button
                                    onClick={() => {
                                      updateTransaction(tx.id, {
                                        is_reimbursable: false,
                                        reimbursement_status: null,
                                        reimbursed_at: null,
                                        reimbursement_payout_id: null,
                                      } as any);
                                      toast('Removed from Work Claims — returned to personal spend');
                                    }}
                                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-destructive/10 text-destructive flex items-center gap-1.5 font-medium"
                                  >
                                    <X className="w-3.5 h-3.5" /> Remove from Work Claims
                                  </button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}

                          {/* Transfer flag */}
                          <button
                            onClick={() => {
                              const isCurrentlyTransfer = tx.is_transfer || isConfirmedTransfer || transferStatus === 'suggested';
                              if (isCurrentlyTransfer) {
                                updateTransaction(tx.id, {
                                  is_transfer: false,
                                  transfer_status: null,
                                  transfer_side: null,
                                  matched_transaction_id: null,
                                  transfer_group_id: null,
                                } as any);
                                toast('Unmarked as transfer — now counts as income/spending');
                              } else {
                                updateTransaction(tx.id, { is_transfer: true } as any);
                                toast('Marked as transfer — excluded from income/spending');
                              }
                            }}
                            className={`p-1 rounded shrink-0 transition-colors ${(tx.is_transfer || isConfirmedTransfer) ? 'text-purple-600' : 'text-slate-300 hover:text-slate-600'}`}
                            title={(tx.is_transfer || isConfirmedTransfer) ? 'Transfer (click to unmark and treat as income/spending)' : 'Mark as transfer'}
                          >
                            <ArrowLeftRight className="w-4 h-4" />
                          </button>

                          {/* Delete transaction */}
                          <button
                            onClick={async () => {
                              if (window.confirm(`Delete transaction "${tx.description}" (${formatCurrency(tx.amount, finance.settings?.base_currency || 'GBP')})?`)) {
                                await deleteTransaction(tx.id);
                                toast.success('Transaction deleted');
                              }
                            }}
                            className="p-1 rounded shrink-0 transition-colors text-slate-300 hover:text-rose-600"
                            title="Delete transaction"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Mobile Action Menu (Single 3-dots icon button on phone) */}
                        <div className="flex sm:hidden items-center shrink-0">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center shrink-0 transition-colors shadow-2xs"
                                title="Actions"
                                aria-label="Transaction actions"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-56 p-1.5 shadow-xl">
                              <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1">
                                Actions
                              </DropdownMenuLabel>

                              {/* Split */}
                              {tx.amount < 0 && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setTxToSplit(tx);
                                    setSplitDialogOpen(true);
                                  }}
                                  className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium"
                                >
                                  <Scissors className="w-4 h-4 text-fuchsia-600" />
                                  <span>
                                    {(tx.raw as any)?.split_meta?.is_split_parent
                                      ? 'Manage / Unsplit'
                                      : 'Split with a Pot / Weekly'}
                                  </span>
                                </DropdownMenuItem>
                              )}

                              {/* Friend Payback */}
                              {!tx.is_transfer && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSourceTxForPayback(tx);
                                    setPaybackDialogOpen(true);
                                  }}
                                  className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium"
                                >
                                  <Handshake className="w-4 h-4 text-emerald-600" />
                                  <span>
                                    {(tx.raw as any)?.payback_meta
                                      ? 'View / Unlink Payback'
                                      : tx.amount > 0
                                      ? 'Link Payback to Purchase'
                                      : 'Link Friend Payback Received'}
                                  </span>
                                </DropdownMenuItem>
                              )}

                              {/* Assign to Pot (Submenu) */}
                              {tx.amount < 0 && goals.length > 0 && (
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium">
                                    <Target className="w-4 h-4 text-primary" />
                                    <span className="truncate">
                                      {assignedGoal ? `Pot: ${assignedGoal.name}` : 'Assign to Pot'}
                                    </span>
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent className="w-48 p-1 shadow-lg">
                                    <DropdownMenuLabel className="text-[10px] uppercase font-bold text-muted-foreground px-2 py-1">
                                      Select Pot
                                    </DropdownMenuLabel>
                                    {goals.map(g => (
                                      <DropdownMenuItem
                                        key={g.id}
                                        onClick={() => handlePoolAssign(tx.id, g.id)}
                                        className="flex items-center gap-2 text-xs py-1.5 cursor-pointer"
                                      >
                                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color || '#3b82f6' }} />
                                        <span className="truncate">{g.name}</span>
                                        {(tx as any).goal_id === g.id && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                                      </DropdownMenuItem>
                                    ))}
                                    {(tx as any).goal_id && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => handlePoolAssign(tx.id, null)}
                                          className="text-xs text-destructive flex items-center gap-2 py-1.5 cursor-pointer"
                                        >
                                          <X className="w-3.5 h-3.5" /> Remove from pot
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              )}

                              {/* Fixed expense / bill assignment (Submenu) */}
                              {tx.amount < 0 && fixedExpenses.length > 0 && (
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium">
                                    <Receipt className="w-4 h-4 text-amber-600" />
                                    <span className="truncate">
                                      {assignedFixedExpense ? `Bill: ${assignedFixedExpense.name}` : 'Mark as Bill'}
                                    </span>
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent className="w-52 p-1 shadow-lg">
                                    <DropdownMenuLabel className="text-[10px] uppercase font-bold text-muted-foreground px-2 py-1">
                                      Fixed Bills
                                    </DropdownMenuLabel>
                                    {fixedExpenses.map(e => (
                                      <DropdownMenuItem
                                        key={e.id}
                                        onClick={() => handleFixedExpenseAssign(tx.id, e.id)}
                                        className="flex items-center gap-2 text-xs py-1.5 cursor-pointer"
                                      >
                                        <span className="truncate">{e.name}</span>
                                        <span className="ml-auto text-[10px] text-muted-foreground">
                                          {formatCurrency(e.amount, e.currency)}
                                        </span>
                                        {(tx as any).fixed_expense_id === e.id && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                                      </DropdownMenuItem>
                                    ))}
                                    {(tx as any).fixed_expense_id && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => handleFixedExpenseAssign(tx.id, null)}
                                          className="text-xs text-destructive flex items-center gap-2 py-1.5 cursor-pointer"
                                        >
                                          <X className="w-3.5 h-3.5" /> Remove bill tag
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              )}

                              {/* Work Travel Claim */}
                              <DropdownMenuItem
                                onClick={() => {
                                  if (!tx.is_reimbursable) {
                                    updateTransaction(tx.id, { is_reimbursable: true, reimbursement_status: 'pending' } as any);
                                    toast.success('💼 Marked as Work Travel Claim');
                                  } else {
                                    const newStatus = tx.reimbursement_status === 'reimbursed' ? 'pending' : 'reimbursed';
                                    updateTransaction(tx.id, {
                                      is_reimbursable: true,
                                      reimbursement_status: newStatus,
                                      reimbursed_at: newStatus === 'reimbursed' ? new Date().toISOString() : null,
                                    } as any);
                                    toast.success(newStatus === 'reimbursed' ? '✓ Settled & removed from active Work Claims' : 'Reopened as Pending Claim');
                                  }
                                }}
                                className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium"
                              >
                                <Briefcase className={`w-4 h-4 ${tx.is_reimbursable ? 'text-sky-600' : 'text-slate-400'}`} />
                                <span>
                                  {!tx.is_reimbursable
                                    ? 'Mark as Work Claim'
                                    : tx.reimbursement_status === 'reimbursed'
                                    ? 'Reopen Work Claim'
                                    : 'Settle Work Claim'}
                                </span>
                              </DropdownMenuItem>

                              {/* Refund toggle (for income) */}
                              {tx.amount > 0 && !tx.is_transfer && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    const newIsRefund = !(tx as any).is_refund;
                                    updateTransaction(tx.id, { is_refund: newIsRefund } as any);
                                    toast(newIsRefund ? 'Marked as refund — added back to this week\'s Fun Money' : 'Refund flag removed');
                                  }}
                                  className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium"
                                >
                                  <Undo2 className="w-4 h-4 text-emerald-600" />
                                  <span>{(tx as any).is_refund ? 'Unmark Refund' : 'Mark as Refund (Adds to Fun Money)'}</span>
                                </DropdownMenuItem>
                              )}

                              {/* Transfer toggle */}
                              <DropdownMenuItem
                                onClick={() => {
                                  const isCurrentlyTransfer = tx.is_transfer || isConfirmedTransfer || transferStatus === 'suggested';
                                  if (isCurrentlyTransfer) {
                                    updateTransaction(tx.id, {
                                      is_transfer: false,
                                      transfer_status: null,
                                      transfer_side: null,
                                      matched_transaction_id: null,
                                      transfer_group_id: null,
                                    } as any);
                                    toast('Unmarked as transfer — now counts as income/spending');
                                  } else {
                                    updateTransaction(tx.id, { is_transfer: true } as any);
                                    toast('Marked as transfer — excluded from income/spending');
                                  }
                                }}
                                className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium"
                              >
                                <ArrowLeftRight className={`w-4 h-4 ${(tx.is_transfer || isConfirmedTransfer) ? 'text-purple-600' : 'text-slate-400'}`} />
                                <span>{(tx.is_transfer || isConfirmedTransfer) ? 'Unmark Transfer' : 'Mark as Transfer'}</span>
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              {/* Delete */}
                              <DropdownMenuItem
                                onClick={async () => {
                                  if (window.confirm(`Delete transaction "${tx.description}" (${formatCurrency(tx.amount, finance.settings?.base_currency || 'GBP')})?`)) {
                                    await deleteTransaction(tx.id);
                                    toast.success('Transaction deleted');
                                  }
                                }}
                                className="flex items-center gap-2 text-xs py-2 cursor-pointer font-medium text-destructive focus:text-destructive focus:bg-destructive/10"
                              >
                                <Trash2 className="w-4 h-4" />
                                <span>Delete Transaction</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          ))
        )}
        {filtered.length > page * PAGE_SIZE && (
          <div className="text-center py-3 space-y-1">
            <p className="text-xs text-muted-foreground">Showing {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} transactions</p>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)}>
              Load more
            </Button>
          </div>
        )}
        {filtered.length > 0 && filtered.length <= page * PAGE_SIZE && (
          <p className="text-xs text-muted-foreground text-center py-2">{filtered.length} transactions</p>
        )}
      </div>

      {/* Split Transaction Dialog */}
      <SplitTransactionDialog
        open={splitDialogOpen}
        onOpenChange={setSplitDialogOpen}
        transaction={txToSplit}
        goals={goals}
        categories={categories}
        baseCurrency={baseCurrency}
        convertToBase={finance.convertToBase}
        onConfirmSplit={handleConfirmSplit}
        onUnsplit={handleUnsplit}
      />

      {/* Payback / Reimbursement Link Dialog */}
      <PaybackLinkDialog
        open={paybackDialogOpen}
        onOpenChange={setPaybackDialogOpen}
        sourceTransaction={sourceTxForPayback}
        allTransactions={finance.transactions}
        baseCurrency={baseCurrency}
        onLinkPayback={handleLinkPayback}
        onUnlinkPayback={handleUnlinkPayback}
      />
    </div>
  );
}
