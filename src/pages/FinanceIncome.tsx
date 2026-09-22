import { useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, TrendingUp, DollarSign, Tag, X, Briefcase, HelpCircle, Home, Download, CheckCircle2, Clock, FileText, Check, ArrowRightLeft } from 'lucide-react';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { baseAmt, formatCurrency, formatUkDate } from '@/lib/financeUtils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';

// Candy-jar tokens (match Accounts & Settings)
const PINK = '#FF2EB8';
const PINK_SOFT = '#FF7AD1';
const PINK_WASH = '#FFF5FA';
const GREEN = '#22C55E';
const GREEN_DEEP = '#166534';

// Fallback palette for income sources without a category color set
const FALLBACK_PALETTE = ['#2563EB', '#EA580C', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#DC2626', '#F59E0B'];

type Bucket = {
  key: string;                 // category id, or 'reimbursement' / 'other'
  label: string;
  bg: string;
  border: string;
  accent: string;
  text: string;
  icon: any;
  categoryId?: string;
  matchers: string[];          // legacy name-based fallback matchers
};

// Legacy matchers to keep prior data flowing into the seeded sources.
const LEGACY_MATCHERS: Record<string, string[]> = {
  'venture advisory': ['venture advisory', 'venture'],
  'etsy': ['etsy'],
  'back pocket games': ['back pocket', 'bpg', 'back pocket games'],
};

// Hex → transparent-ish tile bg / border
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function FinanceIncome() {
  const finance = useFinanceData();
  const { transactions, categories, settings, updateTransaction } = finance;
  const { reimbursementsOn } = useFixedExpenses();
  const baseCurrency = settings?.base_currency || 'GBP';

  const [activeTab, setActiveTab] = useState<'income' | 'reimbursements'>('income');
  const [monthOffset, setMonthOffset] = useState(0);
  const [assigningTxId, setAssigningTxId] = useState<string | null>(null);
  const [reimbursementFilter, setReimbursementFilter] = useState<'all' | 'pending' | 'reimbursed'>('all');
  const [matchingTxId, setMatchingTxId] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(addMonths(new Date(), monthOffset)), [monthOffset]);
  const monthEnd = useMemo(() => endOfMonth(monthStart), [monthStart]);
  const monthLabel = format(monthStart, 'MMMM yyyy');

  // Dynamic income sources: one bucket per user-defined income category.
  const incomeCats = useMemo(() => {
    const seen = new Set<string>();
    return categories
      .filter(c => c.type === 'income')
      .filter(c => {
        const k = c.name.trim().toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [categories]);

  const BUCKETS: Bucket[] = useMemo(() => {
    const sourceBuckets: Bucket[] = incomeCats.map((c, i) => {
      const color = c.color || FALLBACK_PALETTE[i % FALLBACK_PALETTE.length];
      const key = c.name.trim().toLowerCase();
      return {
        key: c.id,
        label: c.name,
        bg: tint(color, 0.18),
        border: color,
        accent: color,
        text: color,
        icon: Briefcase,
        categoryId: c.id,
        matchers: LEGACY_MATCHERS[key] || [],
      };
    });
    sourceBuckets.push({
      key: 'reimbursement',
      label: 'Reimbursements',
      bg: '#E0F2FE',
      border: '#38BDF8',
      accent: '#0284C7',
      text: '#075985',
      icon: Home,
      matchers: [],
    });
    sourceBuckets.push({
      key: 'other',
      label: 'Other',
      bg: PINK_WASH,
      border: PINK_SOFT,
      accent: PINK,
      text: '#831843',
      icon: HelpCircle,
      matchers: [],
    });
    return sourceBuckets;
  }, [incomeCats]);

  function classifyTx(tx: any): string {
    if (tx.category_id) {
      const hit = BUCKETS.find(b => b.categoryId === tx.category_id);
      if (hit) return hit.key;
    }
    const hay = `${(tx.merchant || '').toLowerCase()} ${(tx.description || '').toLowerCase()}`;
    for (const b of BUCKETS) {
      if (b.key === 'other' || b.key === 'reimbursement') continue;
      if (b.matchers.some(m => hay.includes(m))) return b.key;
    }
    return 'other';
  }

  const incomeTxs = useMemo(() => transactions.filter(tx => {
    if (tx.amount <= 0) return false;
    const cat = categories.find(c => c.id === tx.category_id);
    const isIncomeCat = cat?.type === 'income';

    if (!isIncomeCat) {
      if (tx.is_transfer) return false;
      if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') return false;
    }
    if (tx.is_reimbursable) return false; // Exclude employer work payback deposits from earned personal income
    const d = new Date(tx.posted_at);
    return d >= monthStart && d <= monthEnd;
  }), [transactions, categories, monthStart, monthEnd]);

  const grandTotal = useMemo(() => incomeTxs.reduce((s, tx) => s + baseAmt(tx), 0), [incomeTxs]);

  const reimbursementTotal = useMemo(() => {
    const monthIso = format(monthStart, 'yyyy-MM-dd');
    return reimbursementsOn(monthIso).reduce((s, r) => s + r.amount, 0);
  }, [monthStart, reimbursementsOn]);
  const grandTotalWithReimbursements = grandTotal + reimbursementTotal;

  const bucketed = useMemo(() => {
    const map: Record<string, { total: number; count: number; txs: any[] }> = {};
    for (const b of BUCKETS) map[b.key] = { total: 0, count: 0, txs: [] };
    for (const tx of incomeTxs) {
      const k = classifyTx(tx);
      if (!map[k]) map[k] = { total: 0, count: 0, txs: [] };
      map[k].total += baseAmt(tx);
      map[k].count += 1;
      map[k].txs.push(tx);
    }
    const monthIso = format(monthStart, 'yyyy-MM-dd');
    for (const r of reimbursementsOn(monthIso)) {
      map.reimbursement.total += r.amount;
      map.reimbursement.count += 1;
      map.reimbursement.txs.push({ id: `phantom-${r.id}`, description: r.name, amount: r.amount, currency: baseCurrency, posted_at: monthIso, phantom: true });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeTxs, BUCKETS, monthStart, reimbursementsOn]);

  const handleAssignTx = async (txId: string, categoryId: string | null) => {
    await updateTransaction(txId, { category_id: categoryId } as any);
    setAssigningTxId(null);
    toast.success(categoryId ? 'Moved to source' : 'Moved to Other');
  };

  const topBucket = [...BUCKETS].sort((a, b) => (bucketed[b.key]?.total || 0) - (bucketed[a.key]?.total || 0))[0];
  const topShare = grandTotal > 0 && topBucket ? ((bucketed[topBucket.key]?.total || 0) / grandTotal) * 100 : 0;

  // --- Work Travel Reimbursements Logic ---
  const allReimbursements = useMemo(() => (
    transactions.filter(tx => tx.is_reimbursable && tx.amount < 0)
  ), [transactions]);

  const pendingReimbursements = useMemo(() => (
    allReimbursements.filter(tx => tx.reimbursement_status !== 'reimbursed')
  ), [allReimbursements]);

  const clearedReimbursements = useMemo(() => (
    allReimbursements.filter(tx => tx.reimbursement_status === 'reimbursed')
  ), [allReimbursements]);

  const totalPendingAmount = useMemo(() => (
    pendingReimbursements.reduce((s, tx) => s + Math.abs(baseAmt(tx)), 0)
  ), [pendingReimbursements]);

  const totalClearedAmount = useMemo(() => (
    clearedReimbursements.reduce((s, tx) => s + Math.abs(baseAmt(tx)), 0)
  ), [clearedReimbursements]);

  const displayedReimbursements = useMemo(() => {
    if (reimbursementFilter === 'pending') return pendingReimbursements;
    if (reimbursementFilter === 'reimbursed') return clearedReimbursements;
    return allReimbursements;
  }, [reimbursementFilter, pendingReimbursements, clearedReimbursements, allReimbursements]);

  const positiveDeposits = useMemo(() => (
    transactions.filter(tx => tx.amount > 0 && !tx.is_transfer)
  ), [transactions]);

  const handleToggleReimbursementStatus = async (txId: string, currentStatus?: string | null) => {
    const newStatus = currentStatus === 'reimbursed' ? 'pending' : 'reimbursed';
    await updateTransaction(txId, {
      reimbursement_status: newStatus,
      reimbursed_at: newStatus === 'reimbursed' ? new Date().toISOString() : null,
    } as any);
    toast.success(newStatus === 'reimbursed' ? 'Marked as Reimbursed & Settled' : 'Reopened as Pending Claim');
  };

  const handleMatchPayoutDeposit = async (claimId: string, payoutTxId: string) => {
    // 1) Mark claim settled
    await updateTransaction(claimId, {
      reimbursement_status: 'reimbursed',
      reimbursement_payout_id: payoutTxId,
      reimbursed_at: new Date().toISOString(),
    } as any);
    // 2) Flag payout transaction as reimbursable so it doesn't inflate personal income
    await updateTransaction(payoutTxId, {
      is_reimbursable: true,
      reimbursement_status: 'reimbursed',
    } as any);
    setMatchingTxId(null);
    toast.success('Matched payout deposit! Payback excluded from earned income.');
  };

  const handleUnflagReimbursement = async (txId: string) => {
    await updateTransaction(txId, {
      is_reimbursable: false,
      reimbursement_status: null,
      reimbursement_payout_id: null,
      reimbursed_at: null,
    } as any);
    toast('Removed from Work Reimbursements — returned to personal expenses');
  };

  const exportClaimsCSV = () => {
    if (allReimbursements.length === 0) {
      toast.info('No work claims to export');
      return;
    }
    const headers = ['Date', 'Merchant', 'Description', 'Category', 'Amount', 'Currency', 'Status'];
    const rows = allReimbursements.map(tx => {
      const cat = categories.find(c => c.id === tx.category_id);
      return [
        formatUkDate(tx.posted_at, 'yyyy-MM-dd'),
        `"${(tx.merchant || '').replace(/"/g, '""')}"`,
        `"${(tx.description || '').replace(/"/g, '""')}"`,
        `"${(cat?.name || 'Uncategorised').replace(/"/g, '""')}"`,
        Math.abs(baseAmt(tx)).toFixed(2),
        tx.currency || baseCurrency,
        tx.reimbursement_status || 'pending',
      ].join(',');
    });
    const content = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work_travel_expense_claims_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded expense claim CSV');
  };

  const copyClaimsSummary = () => {
    if (pendingReimbursements.length === 0) {
      toast.info('No pending claims to copy');
      return;
    }
    const lines = pendingReimbursements.map(tx => {
      const cat = categories.find(c => c.id === tx.category_id);
      return `• ${formatUkDate(tx.posted_at, 'dd MMM yyyy')} - ${tx.merchant || tx.description} (${cat?.name || 'Work Expense'}): ${formatCurrency(Math.abs(baseAmt(tx)), baseCurrency)}`;
    });
    const total = pendingReimbursements.reduce((s, tx) => s + Math.abs(baseAmt(tx)), 0);
    const text = `💼 Work Travel Expense Claim Summary:\n\n${lines.join('\n')}\n\nTotal Pending Claim: ${formatCurrency(total, baseCurrency)}`;
    navigator.clipboard.writeText(text);
    toast.success('Copied expense claim summary to clipboard!');
  };

  return (
    <div className="min-h-screen -mx-4 sm:-mx-6 -my-6 px-4 sm:px-6 py-6 bg-[#FFF5FA] font-body">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header & Sub-Page Tabs */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">
              Income &amp; Reimbursements
            </h1>
            <p className="text-slate-500 mt-1">Track earned cash and double-check out-of-pocket work travel claims.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Main view toggle */}
            <div className="bg-white/80 backdrop-blur-md p-1 rounded-2xl border border-[#FF7AD1]/30 flex items-center gap-1 shadow-sm">
              <button
                onClick={() => setActiveTab('income')}
                className={`px-4 py-2 rounded-xl text-xs font-display font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'income'
                    ? 'bg-[#FF2EB8] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-[#FFF5FA]'
                }`}
              >
                <DollarSign className="w-3.5 h-3.5" />
                Earned Income
              </button>
              <button
                onClick={() => setActiveTab('reimbursements')}
                className={`px-4 py-2 rounded-xl text-xs font-display font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'reimbursements'
                    ? 'bg-[#0284C7] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-[#FFF5FA]'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                Work Reimbursements
                {pendingReimbursements.length > 0 && (
                  <span className="ml-1 bg-white/20 text-white px-1.5 py-0.5 rounded-full text-[10px]">
                    {pendingReimbursements.length}
                  </span>
                )}
              </button>
            </div>

            {/* Month Switcher (Income tab) */}
            {activeTab === 'income' && (
              <div className="flex items-center gap-1 bg-white/80 backdrop-blur-md rounded-2xl p-1.5 shadow-sm border border-[#FF7AD1]/30">
                <Button size="sm" variant="ghost" onClick={() => setMonthOffset(m => m - 1)} className="h-9 w-9 p-0 rounded-xl text-[#FF2EB8] hover:bg-[#FFF5FA]">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="px-3 font-display font-bold text-sm text-[#FF2EB8] min-w-[120px] text-center">{monthLabel}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMonthOffset(m => Math.min(0, m + 1))}
                  disabled={monthOffset >= 0}
                  className="h-9 w-9 p-0 rounded-xl text-[#FF2EB8] hover:bg-[#FFF5FA]"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* --- VIEW TAB 1: EARNED INCOME --- */}
        {activeTab === 'income' && (
          <div className="space-y-6">
            {/* Bento hero */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Total earned hero */}
              <div
                className="md:col-span-2 md:row-span-2 bg-white rounded-[2rem] p-7 border-2 border-[#FF2EB8] relative overflow-hidden flex flex-col justify-between min-h-[220px]"
                style={{ boxShadow: `8px 8px 0px 0px ${PINK}` }}
              >
                <div className="relative z-10">
                  <p className="text-[#FF2EB8] font-display font-bold uppercase tracking-widest text-xs mb-2">
                    Total earned · {monthLabel}
                  </p>
                  <h2 className="text-4xl sm:text-5xl font-display font-black text-slate-900 tabular-nums leading-none">
                    {formatCurrency(grandTotalWithReimbursements, baseCurrency)}
                  </h2>
                  <div className="mt-4 inline-flex items-center gap-1.5 bg-[#86EFAC] px-3 py-1 rounded-full text-[#166534] text-sm font-bold">
                    <TrendingUp className="w-4 h-4" />
                    {incomeTxs.length} payment{incomeTxs.length === 1 ? '' : 's'} · {BUCKETS.length} sources
                    {reimbursementTotal > 0 && <span className="ml-1 opacity-80">· incl. {formatCurrency(reimbursementTotal, baseCurrency)} reimb.</span>}
                  </div>
                </div>
                {/* Bar viz of buckets */}
                <div className="mt-8 flex items-end gap-2 h-20">
                  {BUCKETS.map(b => {
                    const v = bucketed[b.key]?.total || 0;
                    const max = Math.max(1, ...BUCKETS.map(x => bucketed[x.key]?.total || 0));
                    return (
                      <div key={b.key} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t-lg transition-all"
                          style={{ height: `${Math.max(8, (v / max) * 100)}%`, backgroundColor: b.accent, opacity: v > 0 ? 1 : 0.25 }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="absolute -top-12 -right-12 w-40 h-40 bg-[#FF7AD1]/15 rounded-full" />
                <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-[#86EFAC]/20 rounded-full" />
              </div>

              {/* Top source tile */}
              <div className="md:col-span-2 bg-[#86EFAC] rounded-[2rem] p-6 border-2 border-[#22C55E] flex flex-col justify-between min-h-[160px]">
                <div className="flex justify-between items-start">
                  <div className="bg-white/50 p-3 rounded-2xl">
                    <TrendingUp className="w-6 h-6 text-[#166534]" />
                  </div>
                  <span className="bg-white px-3 py-1 rounded-full text-[#166534] text-xs font-bold uppercase font-display tracking-wide">
                    Top source
                  </span>
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-[#166534]">{topBucket?.label || '—'}</h3>
                  <div className="mt-3 w-full bg-white/50 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full transition-all duration-500"
                      style={{ width: `${topShare}%`, backgroundColor: GREEN }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-[#166534]/90 font-medium tabular-nums">
                    {formatCurrency(topBucket ? bucketed[topBucket.key]?.total || 0 : 0, baseCurrency)} · {topShare.toFixed(0)}% of month
                  </p>
                </div>
              </div>

              {/* Untagged nudge / Other summary tile */}
              <button
                type="button"
                onClick={() => {
                  document.getElementById('bucket-other')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className="bg-[#FF7AD1] rounded-[2rem] p-6 border-2 border-[#FF2EB8] text-white flex flex-col items-center justify-center gap-2 group cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform min-h-[160px]"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/25 flex items-center justify-center group-hover:rotate-12 transition-transform">
                  <HelpCircle className="w-6 h-6" />
                </div>
                <span className="font-display font-bold text-sm">
                  {bucketed.other?.count || 0} in Other
                </span>
                <span className="text-white/80 text-xs">Tap to tag them</span>
              </button>

              {/* Payments count tile */}
              <div className="bg-white rounded-[2rem] p-6 border-2 border-slate-200 flex flex-col items-center justify-center gap-2 min-h-[160px]">
                <div className="w-12 h-12 rounded-2xl bg-[#FFF5FA] flex items-center justify-center text-[#FF2EB8]">
                  <DollarSign className="w-6 h-6" />
                </div>
                <span className="font-display font-black text-2xl text-slate-900 tabular-nums">{incomeTxs.length}</span>
                <span className="text-slate-400 text-xs font-medium">payments this month</span>
              </div>
            </div>

            {/* Source widgets — one per income source */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {BUCKETS.map(b => {
                const data = bucketed[b.key] || { total: 0, count: 0, txs: [] };
                const pct = grandTotalWithReimbursements > 0 ? (data.total / grandTotalWithReimbursements) * 100 : 0;
                const Icon = b.icon;
                return (
                  <Collapsible key={b.key}>
                    <div
                      id={`bucket-${b.key}`}
                      className="rounded-[2rem] p-6 border-2 shadow-sm"
                      style={{ background: b.bg, borderColor: b.border }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="w-11 h-11 rounded-2xl bg-white/60 flex items-center justify-center shrink-0" style={{ color: b.text }}>
                              <Icon className="w-5 h-5" strokeWidth={2.4} />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-display font-bold text-lg truncate" style={{ color: b.text }}>{b.label}</h3>
                              <p className="text-xs font-medium mt-0.5" style={{ color: b.text, opacity: 0.75 }}>
                                {data.count} {data.count === 1 ? 'payment' : 'payments'} · {pct.toFixed(0)}% of month
                              </p>
                            </div>
                            {b.key === 'other' && data.count > 0 && (
                              <Badge variant="outline" className="text-[10px] font-display font-bold px-2 py-0.5 rounded-full border-white/70 bg-white/60" style={{ color: b.text }}>
                                Needs tagging
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-2xl md:text-3xl font-display font-black tabular-nums leading-none" style={{ color: b.text }}>
                            {formatCurrency(data.total, baseCurrency)}
                          </p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-4 h-2 rounded-full bg-white/60 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: b.accent }}
                        />
                      </div>

                      {data.count > 0 && (
                        <>
                          <CollapsibleTrigger asChild>
                            <button className="mt-3 text-xs font-display font-bold hover:underline transition-colors" style={{ color: b.text }}>
                              View {data.count} transaction{data.count === 1 ? '' : 's'} ↓
                            </button>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <div className="mt-3 pt-3 border-t border-white/70 space-y-1.5">
                              {data.txs.map(tx => (
                                <div key={tx.id} className="flex items-center gap-2 text-xs bg-white/60 rounded-xl px-3 py-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="truncate font-semibold text-slate-800">{tx.description}</p>
                                    <p className="text-slate-500 text-[10px]">
                                      {formatUkDate(tx.posted_at, 'd MMM')}
                                      {tx.merchant && ` · ${tx.merchant}`}
                                    </p>
                                  </div>
                                  <span className="font-display font-bold tabular-nums" style={{ color: GREEN_DEEP }}>
                                    +{formatCurrency(tx.base_amount !== undefined && tx.base_amount !== null ? tx.base_amount : tx.amount, baseCurrency)}
                                  </span>
                                  {!tx.phantom && (
                                    <Popover open={assigningTxId === tx.id} onOpenChange={o => setAssigningTxId(o ? tx.id : null)}>
                                      <PopoverTrigger asChild>
                                        <button className="p-1 rounded-lg hover:bg-white transition-colors text-slate-500 hover:text-slate-900" title="Move to source">
                                          <Tag className="h-3.5 w-3.5" />
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent align="end" className="w-52 p-2 rounded-2xl border-2 border-[#FF7AD1]/30">
                                        <p className="text-[10px] font-display font-bold uppercase tracking-widest text-slate-400 mb-1.5 px-1">Move to source</p>
                                        <div className="space-y-0.5">
                                          {incomeCats.map(c => (
                                            <button
                                              key={c.id}
                                              onClick={() => handleAssignTx(tx.id, c.id)}
                                              className={`w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-[#FFF5FA] flex items-center gap-2 ${
                                                tx.category_id === c.id ? 'bg-[#FFF5FA] font-bold' : 'font-medium'
                                              }`}
                                            >
                                              {c.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                                              {c.name}
                                            </button>
                                          ))}
                                          {tx.category_id && (
                                            <>
                                              <div className="border-t border-slate-100 my-1" />
                                              <button
                                                onClick={() => handleAssignTx(tx.id, null)}
                                                className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-[#FFF5FA] text-[#FF2EB8] flex items-center gap-1.5 font-semibold"
                                              >
                                                <X className="h-3 w-3" /> Move to Other
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  )}
                                </div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </>
                      )}
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </div>
        )}

        {/* --- VIEW TAB 2: WORK TRAVEL REIMBURSEMENTS --- */}
        {activeTab === 'reimbursements' && (
          <div className="space-y-6">
            {/* Reimbursable Bento Hero */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: Pending Claims */}
              <div
                className="bg-white rounded-[2rem] p-7 border-2 border-[#0284C7] relative overflow-hidden flex flex-col justify-between min-h-[180px]"
                style={{ boxShadow: '6px 6px 0px 0px #0284C7' }}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[#0284C7] font-display font-bold uppercase tracking-widest text-xs">
                      Pending Payback
                    </span>
                    <Clock className="w-5 h-5 text-[#0284C7]" />
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-display font-black text-slate-900 tabular-nums leading-none">
                    {formatCurrency(totalPendingAmount, baseCurrency)}
                  </h2>
                  <p className="text-xs font-medium text-slate-500 mt-2">
                    {pendingReimbursements.length} out-of-pocket claim{pendingReimbursements.length === 1 ? '' : 's'} owed by work
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-sky-100 flex items-center justify-between text-xs text-sky-800 font-semibold">
                  <span>Pass-through receivable</span>
                  <span className="bg-sky-100 px-2 py-0.5 rounded-full text-[10px]">Excluded from spend</span>
                </div>
              </div>

              {/* Card 2: Cleared & Settled YTD */}
              <div className="bg-white rounded-[2rem] p-7 border-2 border-[#22C55E] flex flex-col justify-between min-h-[180px]">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[#166534] font-display font-bold uppercase tracking-widest text-xs">
                      Reimbursed YTD
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-[#22C55E]" />
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-display font-black text-slate-900 tabular-nums leading-none">
                    {formatCurrency(totalClearedAmount, baseCurrency)}
                  </h2>
                  <p className="text-xs font-medium text-slate-500 mt-2">
                    {clearedReimbursements.length} claim{clearedReimbursements.length === 1 ? '' : 's'} paid back &amp; settled
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-emerald-100 flex items-center justify-between text-xs text-emerald-800 font-semibold">
                  <span>Employer Payback Deposits</span>
                  <span className="bg-emerald-100 px-2 py-0.5 rounded-full text-[10px]">Zero tax/income inflation</span>
                </div>
              </div>

              {/* Card 3: Claim Actions & Exporter */}
              <div className="bg-[#E0F2FE] rounded-[2rem] p-7 border-2 border-[#38BDF8] flex flex-col justify-between min-h-[180px]">
                <div>
                  <h3 className="font-display font-bold text-slate-900 text-lg">Expense Report Exporter</h3>
                  <p className="text-xs text-sky-800 mt-1">Export itemized out-of-pocket claims to file with company finance or HR.</p>
                </div>
                <div className="flex flex-col gap-2 mt-4">
                  <Button
                    onClick={exportClaimsCSV}
                    size="sm"
                    className="w-full bg-[#0284C7] hover:bg-[#075985] text-white font-display font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" /> Download Claims CSV
                  </Button>
                  <Button
                    onClick={copyClaimsSummary}
                    variant="outline"
                    size="sm"
                    className="w-full border-sky-300 bg-white text-sky-900 hover:bg-sky-50 font-display font-bold text-xs rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <FileText className="w-4 h-4" /> Copy Claim Summary Text
                  </Button>
                </div>
              </div>
            </div>

            {/* Claims Table Container */}
            <div className="bg-white rounded-[2rem] p-6 border-2 border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-display font-bold text-slate-900 text-xl">Work Expense Claims</h3>
                  <p className="text-xs text-slate-500">Toggle claims, match incoming payback deposits, or unflag expenses.</p>
                </div>

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                  {(['all', 'pending', 'reimbursed'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setReimbursementFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold capitalize transition-all ${
                        reimbursementFilter === f
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {f === 'all' ? `All (${allReimbursements.length})` : f === 'pending' ? `Pending (${pendingReimbursements.length})` : `Cleared (${clearedReimbursements.length})`}
                    </button>
                  ))}
                </div>
              </div>

              {displayedReimbursements.length === 0 ? (
                <div className="py-12 text-center text-slate-500 space-y-3">
                  <Briefcase className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="font-display font-semibold text-base text-slate-700">No work reimbursement claims found</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    To mark an expense as a work reimbursement, go to the <span className="font-bold text-[#FF2EB8]">Transactions</span> page and tap the briefcase button <Briefcase className="w-3.5 h-3.5 inline mx-1 text-sky-600" /> on any work travel or transport expense.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {displayedReimbursements.map(tx => {
                    const cat = categories.find(c => c.id === tx.category_id);
                    const isSettled = tx.reimbursement_status === 'reimbursed';
                    const payoutTx = tx.reimbursement_payout_id ? transactions.find(t => t.id === tx.reimbursement_payout_id) : null;

                    return (
                      <div
                        key={tx.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                          isSettled
                            ? 'bg-slate-50/70 border-slate-200 opacity-80'
                            : 'bg-sky-50/30 border-sky-200/80 hover:border-sky-300'
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            isSettled ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                          }`}>
                            <Briefcase className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-display font-bold text-slate-900 text-sm truncate">{tx.description}</p>
                              <Badge variant="outline" className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                isSettled
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : 'border-sky-300 bg-sky-50 text-sky-700'
                              }`}>
                                {isSettled ? '✓ Reimbursed' : '⏳ Claim Pending'}
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {formatUkDate(tx.posted_at, 'dd MMM yyyy')}
                              {tx.merchant && ` · ${tx.merchant}`}
                              {cat && ` · ${cat.name}`}
                            </p>
                            {payoutTx && (
                              <p className="text-[11px] text-emerald-700 font-medium mt-1 flex items-center gap-1">
                                <ArrowRightLeft className="w-3 h-3" /> Matched Payout Deposit: +{formatCurrency(baseAmt(payoutTx), baseCurrency)} ({formatUkDate(payoutTx.posted_at, 'd MMM')})
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100">
                          <span className="font-display font-black text-slate-900 text-lg tabular-nums">
                            {formatCurrency(Math.abs(baseAmt(tx)), baseCurrency)}
                          </span>

                          <div className="flex items-center gap-1.5">
                            {/* Toggle Reimbursed Status */}
                            <Button
                              onClick={() => handleToggleReimbursementStatus(tx.id, tx.reimbursement_status)}
                              size="sm"
                              variant={isSettled ? 'outline' : 'default'}
                              className={`h-8 text-xs font-display font-bold rounded-xl ${
                                isSettled
                                  ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                                  : 'bg-[#0284C7] hover:bg-[#075985] text-white shadow-sm'
                              }`}
                            >
                              {isSettled ? 'Reopen Claim' : 'Mark Reimbursed'}
                            </Button>

                            {/* Match Payout Deposit Popover */}
                            {!isSettled && (
                              <Popover open={matchingTxId === tx.id} onOpenChange={o => setMatchingTxId(o ? tx.id : null)}>
                                <PopoverTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-8 text-xs font-display font-bold rounded-xl border-sky-300 text-sky-800 hover:bg-sky-50">
                                    <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Match Deposit
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-72 p-3 rounded-2xl border-2 border-sky-200 shadow-lg">
                                  <p className="text-xs font-display font-bold text-slate-900 mb-1">Match Employer Payback Deposit</p>
                                  <p className="text-[11px] text-slate-500 mb-2">Select the incoming bank deposit that settled this £{Math.abs(baseAmt(tx)).toFixed(2)} claim:</p>
                                  <div className="space-y-1 max-h-56 overflow-y-auto">
                                    {positiveDeposits.slice(0, 10).map(dep => (
                                      <button
                                        key={dep.id}
                                        onClick={() => handleMatchPayoutDeposit(tx.id, dep.id)}
                                        className="w-full text-left p-2 rounded-xl hover:bg-sky-50 border border-slate-100 hover:border-sky-200 transition-colors flex items-center justify-between text-xs"
                                      >
                                        <div className="min-w-0 flex-1 pr-2">
                                          <p className="font-semibold text-slate-800 truncate">{dep.merchant || dep.description}</p>
                                          <p className="text-[10px] text-slate-400">{formatUkDate(dep.posted_at, 'dd MMM yyyy')}</p>
                                        </div>
                                        <span className="font-display font-bold text-emerald-600 shrink-0">
                                          +{formatCurrency(baseAmt(dep), baseCurrency)}
                                        </span>
                                      </button>
                                    ))}
                                    {positiveDeposits.length === 0 && (
                                      <p className="text-xs text-slate-400 py-2 text-center">No incoming bank deposits found.</p>
                                    )}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}

                            {/* Unflag / remove claim */}
                            <Button
                              onClick={() => handleUnflagReimbursement(tx.id)}
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              title="Unflag as work reimbursement"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {incomeCats.length === 0 && activeTab === 'income' && (
          <div className="bg-white/70 rounded-2xl p-5 border-2 border-dashed border-[#FF7AD1]/50 text-center">
            <p className="text-sm text-slate-600">
              No income sources yet. Add them in <span className="font-bold text-[#FF2EB8]">Accounts &amp; Settings → Settings → Income Sources</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
