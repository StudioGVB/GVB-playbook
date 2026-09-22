import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, Check, Sparkles, Loader2, X, ArrowLeftRight, Target, Receipt, Undo2, DollarSign, Briefcase, RefreshCw, Wallet, Plus, Trash2, Calendar } from 'lucide-react';
import { formatCurrency, formatUkDate } from '@/lib/financeUtils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FixedExpense } from '@/hooks/useFixedExpenses';

type Props = { finance: ReturnType<typeof useFinanceData>; initialAccountFilter?: string; fixedExpenses?: FixedExpense[] };

type TransferFilter = 'all' | 'exclude_transfers' | 'transfers_only' | 'bills_only' | 'suggested_bills' | 'reimbursable_only';

const CATEGORY_TYPE_COLORS: Record<string, string> = {
  fixed: 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary-foreground))]',
  variable: 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent-foreground))]',
  income: 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]',
  transfer: 'bg-muted text-muted-foreground',
};

const INCOME_SOURCE_OPTIONS = [
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
  const { transactions, categories, accounts, goals, updateTransaction, addManualTransaction, deleteTransaction, categorizeTransactions, matchTransfers, addCategory } = finance;

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
        syncTasks.push(finance.syncUpTransactions());
      }
      if (finance.syncWiseTransactions && (accounts.some(a => a.provider === 'wise') || true)) {
        syncTasks.push(finance.syncWiseTransactions());
      }
      if (finance.syncMonzoTransactions && accounts.some(a => a.provider === 'monzo')) {
        syncTasks.push(finance.syncMonzoTransactions());
      }
      if (syncTasks.length === 0) {
        toast.info('No connected bank API accounts found (Wise, Monzo, or Up). Connect an account or import CSV in Accounts.');
      } else {
        await Promise.all(syncTasks);
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

  const categoryOptions = useMemo(() => (
    categories.filter(c => c.type !== 'income' || c.name.trim().toLowerCase() === 'income')
  ), [categories]);

  const uncategorizedCount = transactions.filter(tx => !tx.category_id).length;
  const transferCount = transactions.filter(tx => tx.is_transfer || tx.transfer_group_id).length;

  const billsCount = transactions.filter(tx => tx.is_fixed || (tx as any).fixed_expense_id).length;
  const suggestedCount = transactions.filter(tx => !!suggestBillFor(tx)).length;
  const reimbursableCount = transactions.filter(tx => tx.is_reimbursable).length;

  const filtered = transactions.filter(tx => {
    if (filterAccount !== 'all' && tx.account_id !== filterAccount) return false;
    if (filterCategory !== 'all' && tx.category_id !== filterCategory) return false;
    if (search && !tx.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (transferFilter === 'exclude_transfers' && (tx.is_transfer || tx.transfer_group_id)) return false;
    if (transferFilter === 'transfers_only' && !tx.is_transfer && !tx.transfer_group_id) return false;
    if (transferFilter === 'bills_only' && !(tx.is_fixed || (tx as any).fixed_expense_id)) return false;
    if (transferFilter === 'suggested_bills' && !suggestBillFor(tx)) return false;
    if (transferFilter === 'reimbursable_only' && !tx.is_reimbursable) return false;
    return true;
  });

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

  const handleCategoryChange = useCallback((txId: string, oldCategoryId: string | null, newCategoryId: string | null) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    updateTransaction(txId, { category_id: newCategoryId } as any);
    setLastChange({ txId, oldCategoryId });

    const catName = newCategoryId ? categories.find(c => c.id === newCategoryId)?.name : 'None';
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
  }, [updateTransaction, categories]);

  const handlePoolAssign = useCallback(async (txId: string, goalId: string | null) => {
    const tx = finance.transactions.find(t => t.id === txId);
    if (!tx) return;
    const txAmount = Math.abs(tx.amount);

    const prevGoalId = (tx as any).goal_id as string | null;
    if (prevGoalId) {
      const prevGoal = goals.find(g => g.id === prevGoalId);
      if (prevGoal) {
        await finance.updateGoal(prevGoalId, {
          assigned_amount: (prevGoal.assigned_amount || 0) + txAmount,
        } as any);
      }
    }

    let targetCategoryId: string | null = null;

    if (goalId) {
      const newGoal = goals.find(g => g.id === goalId);
      if (newGoal) {
        await finance.updateGoal(goalId, {
          assigned_amount: Math.max(0, (newGoal.assigned_amount || 0) - txAmount),
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

    updateTransaction(txId, updates);
    const goalName = goalId ? goals.find(g => g.id === goalId)?.name : null;
    toast(goalName ? `Assigned to pool: ${goalName}` : 'Removed from pool');
  }, [updateTransaction, goals, finance, categories, addCategory]);

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
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
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
                    {categories.map(c => (
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
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
              transferFilter === key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:border-primary/40'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Transaction List */}
      <div className="space-y-1">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              No transactions yet. Import a CSV or sync your bank to get started.
            </CardContent>
          </Card>
        ) : (
          filtered.slice(0, page * PAGE_SIZE).map(tx => {
            const cat = categories.find(c => c.id === tx.category_id);
            const isTransfer = tx.is_transfer || !!tx.transfer_group_id;
            const transferStatus = (tx as any).transfer_status as string | null;
            const isConfirmedTransfer = transferStatus === 'confirmed' || transferStatus === 'auto_confirmed';
            const isIncomeTransaction = tx.amount > 0 && !isTransfer && !isConfirmedTransfer && !(tx as any).is_refund;
            const incomeSourceCat = isIncomeTransaction && cat?.type === 'income' && isIncomeSourceName(cat.name) ? cat : null;
            const displayCat = isIncomeTransaction && cat?.type === 'income'
              ? (genericIncomeCategory || { name: 'Income', type: 'income', color: '#22c55e' }) as any
              : cat;
            const catColor = displayCat ? (CATEGORY_TYPE_COLORS[displayCat.type] || CATEGORY_TYPE_COLORS.variable) : '';

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

            return (
              <div
                key={tx.id}
                className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 py-2.5 px-4 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50/80 transition-all overflow-hidden"
                style={{ boxShadow: `inset 4px 0 0 0 ${accent}` }}
              >
                {/* Left: Description & Metadata */}
                <div className="min-w-0 flex-1">
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
                    {tx.is_reimbursable && (
                      <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 shrink-0 ${
                        tx.reimbursement_status === 'reimbursed'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                      }`}>
                        <Briefcase className="w-2.5 h-2.5 mr-0.5" />
                        {tx.reimbursement_status === 'reimbursed' ? 'Work Reimbursed' : 'Work Claim Pending'}
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
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="hover:text-indigo-600 font-medium transition-colors cursor-pointer underline decoration-dotted flex items-center gap-1 text-slate-500"
                          title="Click to edit date"
                        >
                          <Calendar className="w-3 h-3 text-slate-400" />
                          {formatUkDate(tx.posted_at, 'dd MMM yyyy')}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3 font-body space-y-3" align="start">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800">Edit Date</span>
                          <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{tx.description}</span>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-600">Select Date</Label>
                          <Input
                            type="date"
                            className="h-8 text-xs bg-white"
                            defaultValue={formatUkDate(tx.posted_at, 'yyyy-MM-dd')}
                            onChange={async (e) => {
                              if (e.target.value) {
                                const newIso = `${e.target.value}T12:00:00+01:00`;
                                await updateTransaction(tx.id, { posted_at: newIso });
                                toast.success(`Transaction date updated to ${e.target.value}`);
                              }
                            }}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs h-7 font-semibold text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100 flex items-center justify-center gap-1"
                          onClick={async () => {
                            const todayStr = format(new Date(), 'yyyy-MM-dd') + 'T12:00:00+01:00';
                            await updateTransaction(tx.id, { posted_at: todayStr });
                            toast.success('Moved transaction to Today (22 Sep)');
                          }}
                        >
                          📅 Move to Today ({format(new Date(), 'dd MMM')})
                        </Button>
                      </PopoverContent>
                    </Popover>

                    {tx.merchant && <span>· {tx.merchant}</span>}
                    {tx.transfer_side && <span>· {tx.transfer_side === 'out' ? '→ Out' : '← In'}</span>}
                  </div>
                </div>

                {/* Right: Category, Amount & Actions in 1 single flex row */}
                <div className="flex items-center gap-3 shrink-0 ml-auto">
                  {/* Category pill */}
                  <Popover>
                    <PopoverTrigger asChild>
                      {displayCat ? (
                        <button className="cursor-pointer shrink-0">
                          <Badge variant="secondary" className={`text-[10px] px-2.5 py-1 font-semibold hover:opacity-80 transition-opacity ${!displayCat.color ? catColor : ''}`}
                            style={getCategoryBadgeStyle(displayCat)}
                          >
                            {displayCat.name}
                          </Badge>
                        </button>
                      ) : (
                        <button className="cursor-pointer shrink-0">
                          <Badge variant="outline" className="text-[10px] px-2.5 py-1 text-muted-foreground hover:opacity-80">
                            Uncategorised
                          </Badge>
                        </button>
                      )}
                    </PopoverTrigger>
                    <PopoverContent className="w-44 p-2" align="end">
                      <p className="text-[10px] font-medium text-muted-foreground mb-1.5 px-1">Assign category</p>
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        {categoryOptions.map(c => (
                          <button
                            key={c.id}
                            onClick={() => handleCategoryChange(tx.id, tx.category_id, c.id)}
                            className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                              (tx.category_id === c.id || (isIncomeTransaction && c.id === genericIncomeCategory?.id && cat?.type === 'income')) ? 'bg-muted font-medium' : ''
                            }`}
                          >
                            {c.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                            {c.name}
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

                  {/* Amount */}
                  <p className={`text-sm font-display font-bold shrink-0 tabular-nums ${tx.amount >= 0 ? 'text-[hsl(var(--success))]' : 'text-slate-900'}`}>
                    {formatCurrency(tx.base_amount !== undefined && tx.base_amount !== null ? tx.base_amount : tx.amount, finance.settings?.base_currency || 'GBP')}
                  </p>

                  {/* Action Icons Toolbar (single non-wrapping flex row) */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {/* Pool assignment / refund flag */}
                    {tx.amount < 0 && goals.length > 0 ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className={`p-1 rounded transition-colors ${assignedGoal ? 'text-primary' : 'text-slate-300 hover:text-slate-600'}`}
                            title={assignedGoal ? `Pool: ${assignedGoal.name} (click to change)` : 'Assign to pool'}
                          >
                            <Target className="w-4 h-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-2" align="end">
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
                        </PopoverContent>
                      </Popover>
                    ) : tx.amount > 0 && !tx.is_transfer ? (
                      <button
                        onClick={() => {
                          const newIsRefund = !(tx as any).is_refund;
                          updateTransaction(tx.id, { is_refund: newIsRefund } as any);
                          toast(newIsRefund ? 'Marked as refund — added back to this week\'s Fun Money' : 'Refund flag removed');
                        }}
                        className={`p-1 rounded transition-colors ${(tx as any).is_refund ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 hover:text-slate-600'}`}
                        title={(tx as any).is_refund ? 'Refund (boosts Fun Money) — click to unmark' : 'Mark as refund (adds to Fun Money this week)'}
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    ) : null}

                    {/* Fixed expense / bill assignment */}
                    {tx.amount < 0 && fixedExpenses.length > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className={`p-1 rounded transition-colors ${assignedFixedExpense ? 'text-destructive' : 'text-slate-300 hover:text-slate-600'}`}
                            title={assignedFixedExpense ? `Bill: ${assignedFixedExpense.name} (click to change)` : 'Mark as bill payment'}
                          >
                            <Receipt className="w-4 h-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-2" align="end">
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

                    {/* Work Travel Reimbursement flag */}
                    <button
                      onClick={() => {
                        const newIsReimbursable = !tx.is_reimbursable;
                        updateTransaction(tx.id, {
                          is_reimbursable: newIsReimbursable,
                          reimbursement_status: newIsReimbursable ? 'pending' : null,
                        } as any);
                        toast(newIsReimbursable ? '💼 Marked as Work Travel Reimbursement — excluded from personal spend' : 'Removed Work Reimbursement flag');
                      }}
                      className={`p-1 rounded transition-colors ${tx.is_reimbursable ? 'text-sky-600 font-bold' : 'text-slate-300 hover:text-slate-600'}`}
                      title={tx.is_reimbursable ? 'Work Travel Claim (click to unmark)' : 'Mark as Work Travel Reimbursement'}
                    >
                      <Briefcase className="w-4 h-4" />
                    </button>

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
                      className={`p-1 rounded transition-colors ${(tx.is_transfer || isConfirmedTransfer) ? 'text-purple-600' : 'text-slate-300 hover:text-slate-600'}`}
                      title={(tx.is_transfer || isConfirmedTransfer) ? 'Transfer (click to unmark and treat as income/spending)' : 'Mark as transfer'}
                    >
                      <ArrowLeftRight className="w-4 h-4" />
                    </button>

                    {/* Review status */}
                    <button
                      onClick={() => updateTransaction(tx.id, { is_reviewed: !tx.is_reviewed } as any)}
                      className={`p-1 rounded ${tx.is_reviewed ? 'text-emerald-500 font-bold' : 'text-slate-300 hover:text-slate-600'}`}
                      title={tx.is_reviewed ? 'Reviewed' : 'Mark as reviewed'}
                    >
                      <Check className="w-4 h-4" />
                    </button>

                    {/* Delete transaction */}
                    <button
                      onClick={async () => {
                        if (confirm(`Delete transaction "${tx.description}"?`)) {
                          await deleteTransaction(tx.id);
                          toast.success('Transaction deleted');
                        }
                      }}
                      className="p-1 rounded text-slate-300 hover:text-rose-600 transition-colors"
                      title="Delete transaction"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
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
    </div>
  );
}
