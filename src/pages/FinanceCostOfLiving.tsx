import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Wallet, PiggyBank, Target, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  useFixedExpenses,
  type FixedExpense,
  toMonthly,
  toWeekly,
  formatFrequency,
  parseFrequencyWeeks,
  getFrequencyMonthlyMultiplier,
  FREQ_TO_MONTHLY,
} from '@/hooks/useFixedExpenses';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useAutoLinkFixedBills } from '@/hooks/useAutoLinkFixedBills';
import { formatCurrency, parseUkDate } from '@/lib/financeUtils';
import { toast } from 'sonner';

const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly (1 week)' },
  { value: 'fortnightly', label: 'Fortnightly (2 weeks)' },
  { value: 'every_3_weeks', label: 'Every 3 weeks' },
  { value: 'every_4_weeks', label: 'Every 4 weeks' },
  { value: 'every_6_weeks', label: 'Every 6 weeks' },
  { value: 'every_8_weeks', label: 'Every 8 weeks' },
  { value: 'custom_weeks', label: 'Custom weeks…' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
] as const;

export default function FinanceCostOfLiving() {
  const finance = useFinanceData();
  const { assumptions } = useFinanceAssumptions();
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
    const monthly = finance.convertToBase(toMonthly(e.amount, e.frequency), e.currency || baseCurrency);
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
        const d = parseUkDate(tx.posted_at);
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
        const d = parseUkDate(tx.posted_at);
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

  // Saving goals breakdown (active goals with monthly savings target pace or 3-month avg contributions)
  const savingsBreakdown = useMemo(() => {
    const now = new Date();
    const list: {
      id: string;
      name: string;
      target: number;
      assigned: number;
      remaining: number;
      monthlyPace: number;
      weeklyPace: number;
      color: string;
      deadline?: string | null;
      isEmergency?: boolean;
      isCompleted: boolean;
    }[] = [];

    const effectiveIncome = (assumptions?.expected_monthly_income && assumptions.expected_monthly_income > 0)
      ? assumptions.expected_monthly_income
      : 0;

    for (const g of (finance.goals || [])) {
      if ((g as any).is_stash) continue;
      if (g.start_date && new Date(g.start_date) > now) continue;

      const targetBase = finance.convertToBase(g.target_amount || 0, g.currency);
      const assignedBase = finance.convertToBase(g.assigned_amount || 0, g.currency);
      const remainingBase = Math.max(0, targetBase - assignedBase);
      const isEmergency = (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency');
      const isCompleted = targetBase > 0 && remainingBase <= 0.01;

      let weeklyPace = 0;
      let monthlyPace = 0;

      if (!isCompleted) {
        if (g.deadline) {
          const dl = new Date(g.deadline);
          const daysLeft = Math.max(1, Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
          const weeksLeft = Math.max(1, daysLeft / 7);
          weeklyPace = Math.min(remainingBase, remainingBase / weeksLeft);
          monthlyPace = weeklyPace * 4.33;
        } else if (g.percent_allocation && g.percent_allocation > 0 && effectiveIncome > 0) {
          monthlyPace = Math.min(remainingBase, (g.percent_allocation / 100) * effectiveIncome);
          weeklyPace = monthlyPace / 4.33;
        } else {
          // If no deadline, check past 3-month average of transactions assigned to this goal
          let goalTxSum = 0;
          let monthsCount = 0;
          for (let i = 1; i <= 3; i++) {
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
            let mSum = 0;
            for (const tx of finance.transactions) {
              const d = parseUkDate(tx.posted_at);
              if (d >= start && d < end && (tx as any).goal_id === g.id) {
                mSum += finance.convertToBase(Math.abs(tx.amount), tx.currency || baseCurrency);
              }
            }
            if (mSum > 0) { goalTxSum += mSum; monthsCount++; }
          }
          if (monthsCount > 0) {
            monthlyPace = goalTxSum / monthsCount;
            weeklyPace = monthlyPace / 4.33;
          }
        }
      }

      list.push({
        id: g.id,
        name: g.name,
        target: targetBase,
        assigned: assignedBase,
        remaining: remainingBase,
        monthlyPace,
        weeklyPace,
        color: g.color || '#FF2EB8',
        deadline: g.deadline,
        isEmergency,
        isCompleted,
      });
    }

    return list.sort((a, b) => b.monthlyPace - a.monthlyPace);
  }, [finance.goals, finance.transactions, finance.convertToBase, assumptions, baseCurrency]);

  const savingsTotal = savingsBreakdown.reduce((s, r) => s + r.monthlyPace, 0);

  // Total variable and savings combined for the card
  const totalVariableAndSavings = essentialTotal + savingsTotal + funTotal || 1;
  const essentialPct = Math.round((essentialTotal / totalVariableAndSavings) * 100);
  const savingsPct = Math.round((savingsTotal / totalVariableAndSavings) * 100);
  const funPct = Math.max(0, 100 - essentialPct - savingsPct);

  // True total monthly baseline requirement (Fixed Bills + Essential Living + Savings Goals + Discretionary Fun)
  const totalEstimatedMonthly = fixedMonthlyTotal + essentialTotal + savingsTotal + funTotal;
  const dailyBurn = totalEstimatedMonthly / 30.44;

  const baselineSplitDenom = totalEstimatedMonthly || 1;
  const fixedRatio = Math.round((fixedMonthlyTotal / baselineSplitDenom) * 100);
  const essentialRatio = Math.round((essentialTotal / baselineSplitDenom) * 100);
  const savingsRatio = Math.round((savingsTotal / baselineSplitDenom) * 100);
  const funRatio = Math.max(0, 100 - fixedRatio - essentialRatio - savingsRatio);

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
              <Input placeholder="Name (e.g. Rent, Meds, Phone plan)" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" inputMode="decimal" placeholder="Amount (e.g. 200)" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                <Select
                  value={
                    FREQUENCY_OPTIONS.some(opt => opt.value === form.frequency)
                      ? form.frequency
                      : parseFrequencyWeeks(form.frequency)
                        ? 'custom_weeks'
                        : 'monthly'
                  }
                  onValueChange={v => {
                    if (v === 'custom_weeks') {
                      const curWeeks = parseFrequencyWeeks(form.frequency) || 6;
                      setForm(f => ({ ...f, frequency: `every_${curWeeks}_weeks` }));
                    } else {
                      setForm(f => ({ ...f, frequency: v }));
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {parseFrequencyWeeks(form.frequency) !== null && (
                <div className="flex items-center justify-between bg-[#FFF5FA] px-3 py-2 rounded-xl border border-[#FF7AD1]/30">
                  <span className="text-xs font-semibold text-slate-700">Repeats every:</span>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={52}
                      className="w-16 h-8 text-center font-bold bg-white"
                      value={parseFrequencyWeeks(form.frequency) || 6}
                      onChange={e => {
                        const w = parseInt(e.target.value, 10);
                        if (w > 0) setForm(f => ({ ...f, frequency: `every_${w}_weeks` }));
                      }}
                    />
                    <span className="text-xs text-slate-500 font-medium">weeks</span>
                  </div>
                </div>
              )}

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
                <Input type="number" inputMode="numeric" min={1} max={31} placeholder="Due day (1-31, optional)" value={form.due_day}
                  onChange={e => setForm(f => ({ ...f, due_day: e.target.value }))} />
              </div>

              {form.amount && parseFloat(form.amount) > 0 && (
                <div className="bg-[#FFF5FA] p-3 rounded-2xl border border-[#FF7AD1]/30 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-700">Calculated monthly cost:</span>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {parseFrequencyWeeks(form.frequency)
                        ? `(${formatCurrency(parseFloat(form.amount) || 0, form.currency || baseCurrency)} every ${parseFrequencyWeeks(form.frequency)} wks × 52 ÷ 12)`
                        : `(budget baseline)`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display font-black text-sm text-[#FF2EB8] tabular-nums">
                      ≈ {formatCurrency(toMonthly(parseFloat(form.amount) || 0, form.frequency), form.currency || baseCurrency)} / mo
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Tx amount: {formatCurrency(parseFloat(form.amount) || 0, form.currency || baseCurrency)}
                    </p>
                  </div>
                </div>
              )}

              <Button className="w-full bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-2xl" onClick={handleAdd}>Add</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Bento metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div
          className="bg-white rounded-[2rem] p-5 sm:p-6 border-2 border-red-400 relative overflow-hidden"
          style={{ boxShadow: '6px 6px 0px 0px #F87171' }}
        >
          <p className="text-red-500 font-display font-bold uppercase tracking-widest text-[10px] mb-2">Fixed Monthly</p>
          <p className="text-2xl sm:text-3xl font-display font-black text-slate-900 tabular-nums leading-none">{fmt(fixedMonthlyTotal)}</p>
          <p className="text-[11px] text-slate-500 mt-2.5 font-medium">Committed obligations</p>
        </div>
        <div
          className="bg-white rounded-[2rem] p-5 sm:p-6 border-2 border-purple-400 relative overflow-hidden"
          style={{ boxShadow: '6px 6px 0px 0px #A78BFA' }}
        >
          <p className="text-purple-500 font-display font-bold uppercase tracking-widest text-[10px] mb-2">Variable Est.</p>
          <p className="text-2xl sm:text-3xl font-display font-black text-slate-900 tabular-nums leading-none">{fmt(essentialTotal + funTotal)}</p>
          <p className="text-[11px] text-slate-500 mt-2.5 font-medium">Essentials + discretionary</p>
        </div>
        <div
          className="bg-white rounded-[2rem] p-5 sm:p-6 border-2 border-[#FF2EB8] relative overflow-hidden"
          style={{ boxShadow: `6px 6px 0px 0px ${PINK}` }}
        >
          <p className="text-[#FF2EB8] font-display font-bold uppercase tracking-widest text-[10px] mb-2">Savings Goals</p>
          <p className="text-2xl sm:text-3xl font-display font-black text-slate-900 tabular-nums leading-none">{fmt(savingsTotal)}</p>
          <p className="text-[11px] text-slate-500 mt-2.5 font-medium">Active goal pots pace</p>
        </div>
        <div
          className="bg-white rounded-[2rem] p-5 sm:p-6 border-2 border-slate-700 relative overflow-hidden"
          style={{ boxShadow: '6px 6px 0px 0px #334155' }}
        >
          <p className="text-slate-700 font-display font-bold uppercase tracking-widest text-[10px] mb-2">Total Baseline</p>
          <p className="text-2xl sm:text-3xl font-display font-black text-slate-900 tabular-nums leading-none">{fmt(totalEstimatedMonthly)}</p>
          <p className="text-[11px] text-slate-500 mt-2.5 font-medium">Bills + living + savings</p>
        </div>
        <div
          className="bg-[#86EFAC] rounded-[2rem] p-5 sm:p-6 border-2 border-[#22C55E] relative overflow-hidden col-span-2 sm:col-span-1"
          style={{ boxShadow: '6px 6px 0px 0px #22C55E' }}
        >
          <p className="text-[#166534] font-display font-bold uppercase tracking-widest text-[10px] mb-2">Daily Outflow</p>
          <p className="text-2xl sm:text-3xl font-display font-black text-[#166534] tabular-nums leading-none">{fmt(dailyBurn)}</p>
          <p className="text-[11px] text-[#166534]/80 mt-2.5 font-medium">Average cost per day</p>
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
                      { name: 'Meds', amount: 200, frequency: 'every_6_weeks', currency: 'GBP', due_day: null, auto_pay: false, paid_externally: false },
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
                const currentEditWeeks = parseFrequencyWeeks(editForm.frequency);
                return (
                  <div key={e.id} className="p-4 space-y-3 bg-[#FFF5FA]/60">
                    <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                      <Input value={editForm.name} placeholder="Name"
                        onChange={ev => setEditForm(f => ({ ...f, name: ev.target.value }))} />
                      <Select
                        value={
                          FREQUENCY_OPTIONS.some(opt => opt.value === editForm.frequency)
                            ? editForm.frequency
                            : currentEditWeeks
                              ? 'custom_weeks'
                              : 'monthly'
                        }
                        onValueChange={v => {
                          if (v === 'custom_weeks') {
                            const cur = parseFrequencyWeeks(editForm.frequency) || 6;
                            setEditForm(f => ({ ...f, frequency: `every_${cur}_weeks` }));
                          } else {
                            setEditForm(f => ({ ...f, frequency: v }));
                          }
                        }}
                      >
                        <SelectTrigger className="h-9 w-40 shrink-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FREQUENCY_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {currentEditWeeks !== null && (
                        <div className="flex items-center gap-1.5 shrink-0 bg-white px-2.5 py-1 rounded-xl border border-[#FF7AD1]/30">
                          <span className="text-xs text-slate-500 font-medium">Every</span>
                          <Input
                            type="number"
                            min={1}
                            max={52}
                            className="w-14 h-7 text-center font-bold px-1 text-xs"
                            value={currentEditWeeks}
                            onChange={ev => {
                              const w = parseInt(ev.target.value, 10);
                              if (w > 0) setEditForm(f => ({ ...f, frequency: `every_${w}_weeks` }));
                            }}
                          />
                          <span className="text-xs text-slate-500 font-medium">weeks</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 justify-between flex-wrap">
                      <div className="text-xs text-slate-600">
                        {editForm.amount && parseFloat(editForm.amount) > 0 && (
                          <span>
                            Monthly: <strong className="text-[#FF2EB8] font-bold">≈ {formatCurrency(toMonthly(parseFloat(editForm.amount) || 0, editForm.frequency), editForm.currency || baseCurrency)}/mo</strong>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
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
                      </p>
                      <p className="text-[11px] text-slate-500 capitalize">
                        {formatFrequency(e.frequency)}
                        {e.due_day && <span className="ml-2 text-slate-400">· due day {e.due_day}</span>}
                        <button
                          className="ml-2 underline hover:text-[#FF2EB8]"
                          onClick={() => fx.update(e.id, { auto_pay: !e.auto_pay, due_day: e.due_day || 1 } as any)}
                        >
                          {e.auto_pay ? 'disable auto-pay' : 'enable auto-pay'}
                        </button>
                      </p>
                    </div>

                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-base font-display font-black text-slate-900 tabular-nums">{fmt(monthly)}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">{formatCurrency(e.amount, e.currency || baseCurrency)} / {formatFrequency(e.frequency)}</p>
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

        {/* Estimated variable and savings spending */}
        <div className="bg-white rounded-[2rem] border-2 border-[#FF7AD1]/40 shadow-sm p-6 space-y-6">
          <div>
            <h3 className="font-display font-bold text-lg text-slate-900">Estimated Variable & Savings</h3>
            <p className="text-xs text-slate-500 mt-0.5">Living essentials, active goal pots, and discretionary spending</p>
          </div>

          {/* Essentials */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[11px] font-display font-bold text-purple-500 uppercase tracking-widest">Essentials</p>
                <p className="text-2xl font-display font-black text-slate-900 tabular-nums">{fmt(essentialTotal)}</p>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">{essentialPct}% of variable & savings</p>
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

          {/* Saving Goals (Pots) */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[11px] font-display font-bold text-[#FF2EB8] uppercase tracking-widest flex items-center gap-1.5">
                  <PiggyBank className="w-3.5 h-3.5" />
                  Saving Goals (Pots)
                </p>
                <p className="text-2xl font-display font-black text-slate-900 tabular-nums">{fmt(savingsTotal)}</p>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">{savingsPct}% of variable & savings</p>
            </div>
            <div className="w-full h-2 bg-pink-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#FF2EB8] rounded-full transition-all" style={{ width: `${savingsPct}%` }} />
            </div>
            <ul className="text-[11px] text-slate-500 space-y-1.5">
              {savingsBreakdown.filter(s => s.monthlyPace > 0 || !s.isCompleted).slice(0, 4).map(s => (
                <li key={s.id} className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5 truncate max-w-[140px] sm:max-w-[180px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="text-slate-900 font-semibold tabular-nums text-right">
                    {s.isCompleted ? (
                      <span className="text-emerald-600 font-bold text-[10px]">Fully funded 🎉</span>
                    ) : (
                      <>
                        {fmt(s.monthlyPace)}<span className="text-slate-400">/mo</span>
                        {s.weeklyPace > 0 && (
                          <span className="text-[10px] text-slate-400 ml-1">({fmt(s.weeklyPace)}/wk)</span>
                        )}
                      </>
                    )}
                  </span>
                </li>
              ))}
              {savingsBreakdown.length === 0 && (
                <li className="text-slate-400">No active savings pots configured yet.</li>
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
              <p className="text-[10px] text-slate-500 font-medium">{funPct}% of variable & savings</p>
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

          {/* Complete Baseline Split */}
          <div className="pt-2">
            <div className="p-4 bg-[#FFF5FA] rounded-2xl border-2 border-[#FF7AD1]/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-xs">
                    <Wallet className="w-4 h-4 text-[#FF2EB8]" />
                  </div>
                  <div>
                    <p className="text-[10px] text-[#FF2EB8] font-display font-bold uppercase tracking-widest">Complete Baseline Split</p>
                    <p className="text-xs font-bold text-slate-900">Total Monthly Outflow: {fmt(totalEstimatedMonthly)}</p>
                  </div>
                </div>
              </div>

              {/* Multi-segment visual progress bar */}
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                {fixedRatio > 0 && <div style={{ width: `${fixedRatio}%` }} className="bg-red-400 h-full" title={`Fixed Bills: ${fixedRatio}%`} />}
                {essentialRatio > 0 && <div style={{ width: `${essentialRatio}%` }} className="bg-purple-500 h-full" title={`Essentials: ${essentialRatio}%`} />}
                {savingsRatio > 0 && <div style={{ width: `${savingsRatio}%` }} className="bg-[#FF2EB8] h-full" title={`Savings Goals: ${savingsRatio}%`} />}
                {funRatio > 0 && <div style={{ width: `${funRatio}%` }} className="bg-emerald-500 h-full" title={`Discretionary Fun: ${funRatio}%`} />}
              </div>

              {/* 4-Pillar Grid */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 pt-1 text-[11px] font-semibold text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  <span>Fixed Bills: <strong className="text-slate-900">{fixedRatio}%</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                  <span>Essentials: <strong className="text-slate-900">{essentialRatio}%</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#FF2EB8] shrink-0" />
                  <span>Saving Goals: <strong className="text-slate-900">{savingsRatio}%</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>Discretionary: <strong className="text-slate-900">{funRatio}%</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
