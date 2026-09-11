import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useFixedExpenses, type FixedExpense } from '@/hooks/useFixedExpenses';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useAutoLinkFixedBills } from '@/hooks/useAutoLinkFixedBills';
import { formatCurrency } from '@/lib/financeUtils';

const FREQ_TO_MONTHLY: Record<string, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

const FREQ_OPTIONS = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'] as const;

export default function FinanceCostOfLiving() {
  const finance = useFinanceData();
  const fx = useFixedExpenses();
  const baseCurrency = finance.settings?.base_currency || 'AUD';

  useAutoLinkFixedBills({
    transactions: finance.transactions as any,
    fixedExpenses: fx.expenses as any,
    refetch: finance.refetch,
    baseCurrency,
  });


  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', frequency: 'monthly', currency: baseCurrency, due_day: '', paid_externally: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; amount: string; frequency: string; currency: string; due_day: string; paid_externally: boolean }>({
    name: '', amount: '', frequency: 'monthly', currency: baseCurrency, due_day: '', paid_externally: false,
  });

  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const today = new Date().toISOString().slice(0, 10);
  const activeExpenses = fx.expenses.filter(e => {
    if (e.effective_from && today < e.effective_from) return false;
    if (e.effective_to && today > e.effective_to) return false;
    return true;
  });

  const rows = activeExpenses.map(e => {
    const mult = FREQ_TO_MONTHLY[e.frequency] || 1;
    const monthly = finance.convertToBase(e.amount * mult, e.currency || baseCurrency);
    return { e, monthly };
  }).sort((a, b) => b.monthly - a.monthly);

  const fixedMonthlyTotal = rows.reduce((s, r) => s + r.monthly, 0);

  // Estimated monthly variable spending (excludes fixed, transfers, income, and excluded categories)
  const variableMonthly = useMemo(() => {
    const monthsBack = 3;
    let total = 0;
    let months = 0;
    for (let i = 1; i <= monthsBack + 3 && months < monthsBack; i++) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      let variable = 0;
      let any = false;
      for (const tx of finance.transactions) {
        const d = new Date(tx.posted_at);
        if (d < start || d >= end) continue;
        any = true;
        if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
        if (tx.is_transfer) continue;
        if ((tx as any).trip_id || (tx as any).is_travel_spend) continue;
        if ((tx as any).goal_id) continue;
        if ((tx as any).fixed_expense_id) continue;
        if (tx.is_fixed) continue;
        const cat = finance.categories.find(c => c.id === tx.category_id);
        if (cat?.exclude_from_reports) continue;
        if (cat?.type === 'fixed' || cat?.type === 'transfer') continue;
        if ((tx as any).is_refund && tx.amount > 0) {
          variable -= finance.convertToBase(tx.amount, tx.currency || baseCurrency);
          continue;
        }
        if (tx.amount >= 0) continue;
        variable += finance.convertToBase(Math.abs(tx.amount), tx.currency || baseCurrency);
      }
      if (any) { total += Math.max(0, variable); months++; }
    }
    return { avg: months > 0 ? total / months : 0, months };
  }, [finance.transactions, finance.categories, finance.convertToBase, baseCurrency]);

  // Per-category breakdown driving the variable estimate (avg per month)
  const variableBreakdown = useMemo(() => {
    const monthsBack = 3;
    const byCat = new Map<string, number>();
    let months = 0;
    for (let i = 1; i <= monthsBack + 3 && months < monthsBack; i++) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      let any = false;
      for (const tx of finance.transactions) {
        const d = new Date(tx.posted_at);
        if (d < start || d >= end) continue;
        any = true;
        if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
        if (tx.is_transfer) continue;
        if ((tx as any).trip_id || (tx as any).is_travel_spend) continue;
        if ((tx as any).goal_id) continue;
        if ((tx as any).fixed_expense_id) continue;
        if (tx.is_fixed) continue;
        const cat = finance.categories.find(c => c.id === tx.category_id);
        if (cat?.exclude_from_reports) continue;
        if (cat?.type === 'fixed' || cat?.type === 'transfer') continue;
        const name = cat?.name || 'Uncategorized';
        if ((tx as any).is_refund && tx.amount > 0) {
          byCat.set(name, (byCat.get(name) || 0) - finance.convertToBase(tx.amount, tx.currency || baseCurrency));
          continue;
        }
        if (tx.amount >= 0) continue;
        byCat.set(name, (byCat.get(name) || 0) + finance.convertToBase(Math.abs(tx.amount), tx.currency || baseCurrency));
      }
      if (any) months++;
    }
    const divisor = Math.max(1, months);
    return Array.from(byCat.entries())
      .map(([name, total]) => ({ name, avg: total / divisor }))
      .filter(r => r.avg > 0)
      .sort((a, b) => b.avg - a.avg);
  }, [finance.transactions, finance.categories, finance.convertToBase, baseCurrency]);

  const essentialBreakdown = useMemo(() =>
    variableBreakdown.filter(row => finance.categories.find(c => c.name === row.name)?.is_essential),
  [variableBreakdown, finance.categories]);

  const funBreakdown = useMemo(() =>
    variableBreakdown.filter(row => !finance.categories.find(c => c.name === row.name)?.is_essential),
  [variableBreakdown, finance.categories]);

  const essentialTotal = essentialBreakdown.reduce((s, r) => s + r.avg, 0);
  const funTotal = funBreakdown.reduce((s, r) => s + r.avg, 0);
  const totalVariable = essentialTotal + funTotal || variableMonthly.avg;
  const essentialPct = totalVariable > 0 ? Math.round((essentialTotal / totalVariable) * 100) : 0;
  const funPct = totalVariable > 0 ? 100 - essentialPct : 0;

  const totalEstimatedMonthly = fixedMonthlyTotal + variableMonthly.avg;
  const dailyBurn = totalEstimatedMonthly / 30.44;
  const fixedRatio = totalEstimatedMonthly > 0 ? Math.round((fixedMonthlyTotal / totalEstimatedMonthly) * 100) : 0;

  const handleAdd = async () => {
    const amt = parseFloat(form.amount);
    if (!form.name.trim() || !amt || amt <= 0) return;
    const dueDay = form.due_day ? Math.min(31, Math.max(1, parseInt(form.due_day))) : null;
    await fx.add({
      name: form.name.trim(),
      amount: amt,
      frequency: form.frequency,
      currency: form.currency || baseCurrency,
      due_day: dueDay,
      paid_externally: form.paid_externally,
    });
    setForm({ name: '', amount: '', frequency: 'monthly', currency: baseCurrency, due_day: '', paid_externally: false });
    setAddOpen(false);
  };

  const startEdit = (e: FixedExpense) => {
    setEditingId(e.id);
    setEditForm({
      name: e.name,
      amount: String(e.amount),
      frequency: e.frequency,
      currency: e.currency || baseCurrency,
      due_day: e.due_day ? String(e.due_day) : '',
      paid_externally: !!e.paid_externally,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const amt = parseFloat(editForm.amount);
    if (!editForm.name.trim() || !amt) { setEditingId(null); return; }
    const dueDay = editForm.due_day ? Math.min(31, Math.max(1, parseInt(editForm.due_day))) : null;
    await fx.update(editingId, {
      name: editForm.name.trim(),
      amount: amt,
      frequency: editForm.frequency as FixedExpense['frequency'],
      currency: editForm.currency || baseCurrency,
      due_day: dueDay,
      paid_externally: editForm.paid_externally,
    });
    setEditingId(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from your monthly expenses?`)) return;
    await fx.remove(id);
  };

  const PINK = '#FF2EB8';
  const PINK_SOFT = '#FF7AD1';

  return (
    <div className="space-y-6 font-body">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">Cost of Living</h1>
          <p className="text-slate-500 mt-1">Baseline monthly requirements and variable projections.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-2xl px-5 py-5 h-auto shadow-lg shadow-[#FF2EB8]/25">
              <Plus className="w-4 h-4 mr-1.5" /> Add expense
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add monthly expense</DialogTitle></DialogHeader>

            <div className="space-y-3 mt-2">
              <Input placeholder="Name (e.g. Rent, Phone plan)" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" inputMode="decimal" placeholder="Amount" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQ_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" inputMode="numeric" min={1} max={31} placeholder="Due day (1-31)" value={form.due_day}
                  onChange={e => setForm(f => ({ ...f, due_day: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-[#FF2EB8]"
                  checked={form.paid_externally}
                  onChange={e => setForm(f => ({ ...f, paid_externally: e.target.checked }))}
                />
                <span>Paid from external account (offsets as reimbursement)</span>
              </label>
              <Button className="w-full bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-2xl" onClick={handleAdd}>Add</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Bento metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div
          className="bg-white rounded-[2rem] p-6 border-2 border-red-400 relative overflow-hidden"
          style={{ boxShadow: '6px 6px 0px 0px #F87171' }}
        >
          <p className="text-red-500 font-display font-bold uppercase tracking-widest text-[10px] mb-2">Fixed Monthly</p>
          <p className="text-3xl sm:text-4xl font-display font-black text-slate-900 tabular-nums leading-none">{fmt(fixedMonthlyTotal)}</p>
          <p className="text-[11px] text-slate-500 mt-3 font-medium">Committed obligations</p>
        </div>
        <div
          className="bg-white rounded-[2rem] p-6 border-2 border-purple-400 relative overflow-hidden"
          style={{ boxShadow: '6px 6px 0px 0px #A78BFA' }}
        >
          <p className="text-purple-500 font-display font-bold uppercase tracking-widest text-[10px] mb-2">Variable Est.</p>
          <p className="text-3xl sm:text-4xl font-display font-black text-slate-900 tabular-nums leading-none">{fmt(variableMonthly.avg)}</p>
          <p className="text-[11px] text-slate-500 mt-3 font-medium">Essentials + fun projection</p>
        </div>
        <div
          className="bg-white rounded-[2rem] p-6 border-2 border-[#FF2EB8] relative overflow-hidden"
          style={{ boxShadow: `6px 6px 0px 0px ${PINK}` }}
        >
          <p className="text-[#FF2EB8] font-display font-bold uppercase tracking-widest text-[10px] mb-2">Total Baseline</p>
          <p className="text-3xl sm:text-4xl font-display font-black text-slate-900 tabular-nums leading-none">{fmt(totalEstimatedMonthly)}</p>
          <p className="text-[11px] text-slate-500 mt-3 font-medium">Estimated total outflow</p>
        </div>
        <div
          className="bg-[#86EFAC] rounded-[2rem] p-6 border-2 border-[#22C55E] relative overflow-hidden"
          style={{ boxShadow: '6px 6px 0px 0px #22C55E' }}
        >
          <p className="text-[#166534] font-display font-bold uppercase tracking-widest text-[10px] mb-2">Daily Burn</p>
          <p className="text-3xl sm:text-4xl font-display font-black text-[#166534] tabular-nums leading-none">{fmt(dailyBurn)}</p>
          <p className="text-[11px] text-[#166534]/80 mt-3 font-medium">Average cost per day</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fixed monthly expenses */}
        <div className="lg:col-span-2 bg-white rounded-[2rem] border-2 border-[#FF7AD1]/40 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[#FF7AD1]/20 flex justify-between items-center bg-[#FFF5FA]/60">
            <h3 className="font-display font-bold text-lg text-slate-900">Fixed Monthly Expenses</h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-[11px] h-7 px-2.5 text-pink-600 border-[#FF7AD1]/40 hover:bg-[#FFF5FA] hover:text-[#FF2EB8] rounded-full font-bold uppercase tracking-wider"
                onClick={async () => {
                  if (!confirm("This will replace all your current fixed expenses with the ones from the screenshot. Proceed?")) return;
                  try {
                    // Delete all existing
                    await Promise.all(fx.expenses.map(e => fx.remove(e.id)));
                    // Add new ones
                    const presets = [
                      { name: 'UK Flat (rent + bills incl.)', amount: 720, frequency: 'monthly', currency: 'GBP', due_day: 1, auto_pay: true, paid_externally: false },
                      { name: 'Meds', amount: 120, frequency: 'monthly', currency: 'GBP', due_day: null, auto_pay: false, paid_externally: false },
                      { name: 'Gym', amount: 30, frequency: 'monthly', currency: 'GBP', due_day: 24, auto_pay: false, paid_externally: false },
                      { name: 'cineworld', amount: 18, frequency: 'monthly', currency: 'GBP', due_day: 24, auto_pay: false, paid_externally: false },
                      { name: 'Phone Plan', amount: 9, frequency: 'monthly', currency: 'GBP', due_day: 31, auto_pay: false, paid_externally: false },
                      { name: 'Amazon', amount: 9, frequency: 'monthly', currency: 'GBP', due_day: 24, auto_pay: false, paid_externally: false },
                    ];
                    for (const p of presets) {
                      await fx.add(p);
                    }
                    toast.success('Bills updated to match screenshot!');
                  } catch (err) {
                    toast.error('Failed to sync bills');
                  }
                }}
              >
                Import Preset Bills
              </Button>
              <span className="text-[10px] px-3 py-1 bg-red-100 text-red-600 rounded-full font-display font-bold uppercase tracking-wide">Priority High</span>
            </div>
          </div>
          <div className="divide-y divide-[#FF7AD1]/15">
            {rows.length === 0 && !fx.loading && (
              <div className="p-8 text-center text-sm text-slate-500">
                No monthly expenses yet. Add rent, bills, phone, subscriptions…
              </div>
            )}
            {rows.map(({ e, monthly }) => {
              const isEditing = editingId === e.id;
              if (isEditing) {
                return (
                  <div key={e.id} className="p-4 space-y-3 bg-[#FFF5FA]/60">
                    <div className="flex items-center gap-3">
                      <Input value={editForm.name} placeholder="Name"
                        onChange={ev => setEditForm(f => ({ ...f, name: ev.target.value }))} />
                      <Select value={editForm.frequency} onValueChange={v => setEditForm(f => ({ ...f, frequency: v }))}>
                        <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FREQ_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3 justify-end flex-wrap">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-slate-500">Day</span>
                        <Input type="number" inputMode="numeric" min={1} max={31} className="w-16 text-right"
                          placeholder="—"
                          value={editForm.due_day}
                          onChange={ev => setEditForm(f => ({ ...f, due_day: ev.target.value }))} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Input type="number" inputMode="decimal" className="w-24 text-right"
                          value={editForm.amount}
                          onChange={ev => setEditForm(f => ({ ...f, amount: ev.target.value }))} />
                        <Select value={editForm.currency} onValueChange={v => setEditForm(f => ({ ...f, currency: v }))}>
                          <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="AUD">AUD</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveEdit}>
                          <Check className="w-4 h-4 text-emerald-600" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingId(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={e.id} className="p-4 flex items-center justify-between hover:bg-[#FFF5FA]/60 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-red-100 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                    </div>
                    <div>
                      <p className="text-sm font-display font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                        {e.name}
                        {e.auto_pay && (
                          <span className="text-[9px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold uppercase tracking-wide">Auto</span>
                        )}
                        {e.paid_externally && (
                          <span className="text-[9px] px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full font-bold uppercase tracking-wide">External</span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500 capitalize">
                        {e.frequency}
                        {e.due_day && <span className="ml-2 text-slate-400">· due day {e.due_day}</span>}
                        <button
                          className="ml-2 underline hover:text-[#FF2EB8]"
                          onClick={() => fx.update(e.id, { auto_pay: !e.auto_pay, due_day: e.due_day || 1 } as any)}
                        >
                          {e.auto_pay ? 'disable auto-pay' : 'enable auto-pay'}
                        </button>
                        <button
                          className="ml-2 underline hover:text-sky-600"
                          onClick={() => fx.update(e.id, { paid_externally: !e.paid_externally } as any)}
                        >
                          {e.paid_externally ? 'not external' : 'mark external'}
                        </button>
                      </p>
                    </div>

                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-base font-display font-black text-slate-900 tabular-nums">{fmt(monthly)}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">{formatCurrency(e.amount, e.currency || baseCurrency)} / {e.frequency}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl hover:bg-[#FFF5FA]" onClick={() => startEdit(e)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl hover:bg-red-50" onClick={() => handleDelete(e.id, e.name)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {rows.length > 0 && (
              <div className="p-4 flex items-center justify-between bg-[#FFF5FA]">
                <span className="text-xs font-display font-bold uppercase tracking-wider text-[#FF2EB8]">Fixed monthly total</span>
                <span className="text-xl font-display font-black tabular-nums text-slate-900">{fmt(fixedMonthlyTotal)}</span>
              </div>
            )}
          </div>
          <div className="p-4 bg-white">
            <button
              onClick={() => setAddOpen(true)}
              className="w-full py-2.5 border-2 border-dashed border-[#FF7AD1]/50 rounded-2xl text-xs font-display font-bold uppercase tracking-wide text-[#FF2EB8] hover:bg-[#FFF5FA] transition-all"
            >
              Manage Fixed Bills
            </button>
          </div>
        </div>

        {/* Estimated variable spending */}
        <div className="bg-white rounded-[2rem] border-2 border-[#FF7AD1]/40 shadow-sm p-6 space-y-6">
          <h3 className="font-display font-bold text-lg text-slate-900">Estimated Variable</h3>

          {/* Essentials */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[11px] font-display font-bold text-purple-500 uppercase tracking-widest">Essentials</p>
                <p className="text-2xl font-display font-black text-slate-900 tabular-nums">{fmt(essentialTotal)}</p>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">{essentialPct}% of variable</p>
            </div>
            <div className="w-full h-2 bg-purple-100 rounded-full overflow-hidden">
              <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${essentialPct}%` }} />
            </div>
            <ul className="text-[11px] text-slate-500 space-y-1.5">
              {essentialBreakdown.slice(0, 3).map(row => (
                <li key={row.name} className="flex justify-between">
                  <span>{row.name}</span>
                  <span className="text-slate-900 font-semibold tabular-nums">{fmt(row.avg)}<span className="text-slate-400">/mo</span></span>
                </li>
              ))}
              {essentialBreakdown.length === 0 && (
                <li className="text-slate-400">No essential categories tracked yet.</li>
              )}
            </ul>
          </div>

          {/* Fun Money */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[11px] font-display font-bold text-emerald-500 uppercase tracking-widest">Fun Money</p>
                <p className="text-2xl font-display font-black text-slate-900 tabular-nums">{fmt(funTotal)}</p>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">{funPct}% of variable</p>
            </div>
            <div className="w-full h-2 bg-emerald-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${funPct}%` }} />
            </div>
            <ul className="text-[11px] text-slate-500 space-y-1.5">
              {funBreakdown.slice(0, 3).map(row => (
                <li key={row.name} className="flex justify-between">
                  <span>{row.name}</span>
                  <span className="text-slate-900 font-semibold tabular-nums">{fmt(row.avg)}<span className="text-slate-400">/mo</span></span>
                </li>
              ))}
              {funBreakdown.length === 0 && (
                <li className="text-slate-400">No fun categories tracked yet.</li>
              )}
            </ul>
          </div>

          <div className="pt-2">
            <div className="p-4 bg-[#FFF5FA] rounded-2xl border-2 border-[#FF7AD1]/30">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-2xl bg-white flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-[#FF2EB8]" />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-[#FF2EB8] font-display font-bold uppercase tracking-widest">Baseline split</p>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    Fixed bills make up <span className="font-display font-black text-slate-900">{fixedRatio}%</span> of your monthly baseline. The remaining <span className="font-display font-black text-slate-900">{100 - fixedRatio}%</span> is variable spending.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
