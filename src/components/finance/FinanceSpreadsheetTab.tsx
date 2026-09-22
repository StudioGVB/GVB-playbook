import { useState, useMemo, useEffect, useCallback } from 'react';
import { subDays } from 'date-fns';
import { Plus, Trash2, Pencil, RefreshCw, ChevronDown, ChevronUp, DollarSign, Wallet, Sparkles, AlertCircle, CheckCircle2, ArrowUp, ArrowDown, Percent, Settings2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { formatCurrency } from '@/lib/financeUtils';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { calcTakeHome, StudentLoanPlan, STUDENT_LOAN_LABELS } from '@/lib/ukTakeHome';
import { toast } from 'sonner';

export interface SpreadsheetLineItem {
  id: string;
  name: string;
  weeklyAmount: number;
  section: 'income' | 'survival' | 'optional' | 'savings';
  subheading?: string; // income stream or category group
  notes?: string;
  isUkTaxed?: boolean;
  pensionPercent?: number;
  studentLoanPlan?: StudentLoanPlan;
}

const STORAGE_KEY = 'gvb_balance_sheet_spreadsheet_items_v4';
const AFFORDABLE_KEY = 'gvb_balance_sheet_affordable_amount_v4';
const INCOME_ORDER_KEY = 'gvb_balance_sheet_income_order_v4';
const TAX_VIEW_MODE_KEY = 'gvb_balance_sheet_tax_view_mode_v4';

export function getItemValues(item: SpreadsheetLineItem, taxViewMode: 'net' | 'gross' = 'net') {
  const grossAnnual = item.weeklyAmount * 52;
  const grossMonthly = (item.weeklyAmount * 52) / 12;
  const grossWeekly = item.weeklyAmount;

  if (!item.isUkTaxed) {
    return {
      grossWeekly,
      grossMonthly,
      grossAnnual,
      effectiveWeekly: grossWeekly,
      effectiveMonthly: grossMonthly,
      effectiveAnnual: grossAnnual,
      taxWeekly: 0,
      taxMonthly: 0,
      taxAnnual: 0,
      taxRate: 0,
      isTaxed: false,
      incomeTax: 0,
      ni: 0,
      pension: 0,
      studentLoan: 0,
    };
  }

  const tb = calcTakeHome({
    grossAnnual,
    pensionPercent: item.pensionPercent || 0,
    studentLoanPlan: item.studentLoanPlan || null,
  });

  const isNetMode = taxViewMode === 'net';

  return {
    grossWeekly,
    grossMonthly,
    grossAnnual,
    effectiveWeekly: isNetMode ? tb.netWeekly : grossWeekly,
    effectiveMonthly: isNetMode ? tb.netMonthly : grossMonthly,
    effectiveAnnual: isNetMode ? tb.netAnnual : grossAnnual,
    taxWeekly: (grossAnnual - tb.netAnnual) / 52,
    taxMonthly: (grossAnnual - tb.netAnnual) / 12,
    taxAnnual: grossAnnual - tb.netAnnual,
    taxRate: tb.effectiveTaxRate,
    isTaxed: true,
    incomeTax: tb.incomeTax,
    ni: tb.nationalInsurance,
    pension: tb.pension,
    studentLoan: tb.studentLoan,
    netWeekly: tb.netWeekly,
    netMonthly: tb.netMonthly,
    netAnnual: tb.netAnnual,
  };
}

export default function FinanceSpreadsheetTab() {
  const finance = useFinanceData();
  const { categories, transactions, settings, goals } = finance;
  const { expenses: fixedExpenses, reimbursementsOn } = useFixedExpenses();
  const baseCurrency = settings?.base_currency || 'AUD';

  // Global Tax View Mode ('net' take-home vs 'gross')
  const [taxViewMode, setTaxViewMode] = useState<'net' | 'gross'>(() => {
    try {
      const saved = localStorage.getItem(TAX_VIEW_MODE_KEY);
      if (saved === 'gross' || saved === 'net') return saved;
    } catch (e) {
      console.error(e);
    }
    return 'net';
  });

  useEffect(() => {
    localStorage.setItem(TAX_VIEW_MODE_KEY, taxViewMode);
  }, [taxViewMode]);

  // Section collapse state
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // State for Income stream ordering
  const [incomeOrder, setIncomeOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(INCOME_ORDER_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error loading income order', e);
    }
    return [];
  });

  useEffect(() => {
    if (incomeOrder.length > 0) {
      localStorage.setItem(INCOME_ORDER_KEY, JSON.stringify(incomeOrder));
    }
  }, [incomeOrder]);

  // Compute real line items dynamically from actual transactions, fixed expenses, categories, and pools
  const computeRealLineItems = useCallback(() => {
    const seeded: SpreadsheetLineItem[] = [];

    const getTxBaseAmount = (tx: any) => {
      const v = tx.base_amount;
      if (typeof v === 'number' && v !== 0) return Math.abs(v);
      return Math.abs(Number(tx.amount) || 0);
    };

    const now = new Date();
    const ninetyDaysAgo = subDays(now, 90);

    // 1. REAL INCOME STREAMS
    const incomeCats = categories.filter(c => c.type === 'income');
    const incomeTxs = transactions.filter(tx => {
      if (tx.amount <= 0) return false;
      const cat = categories.find(c => c.id === tx.category_id);
      const isIncomeCat = cat?.type === 'income';
      if (!isIncomeCat) {
        if (tx.is_transfer) return false;
        if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') return false;
      }
      const d = new Date(tx.posted_at);
      return d >= ninetyDaysAgo && d <= now;
    });

    const incomeTotalsByCatId = new Map<string, number>();
    const incomeTotalsByMerchant = new Map<string, number>();

    for (const tx of incomeTxs) {
      const amt = getTxBaseAmount(tx);
      if (tx.category_id) {
        incomeTotalsByCatId.set(tx.category_id, (incomeTotalsByCatId.get(tx.category_id) || 0) + amt);
      }
      const mKey = (tx.merchant || tx.description || '').trim();
      if (mKey) {
        incomeTotalsByMerchant.set(mKey, (incomeTotalsByMerchant.get(mKey) || 0) + amt);
      }
    }

    if (incomeCats.length > 0) {
      incomeCats.forEach(c => {
        const catTotal90 = incomeTotalsByCatId.get(c.id) || 0;
        let keywordTotal = 0;
        const cLower = c.name.toLowerCase();
        for (const [mName, amt] of incomeTotalsByMerchant.entries()) {
          if (mName.toLowerCase().includes(cLower)) {
            keywordTotal += amt;
          }
        }
        const totalInWindow = Math.max(catTotal90, keywordTotal);
        const monthlyAvg = totalInWindow > 0 ? totalInWindow / 3 : (c.monthly_target || 0);
        const weekly = (monthlyAvg * 12) / 52;

        const displayName = c.name === 'Income' ? 'Gamma' : c.name;
        const isGamma = displayName.toLowerCase().includes('gamma') || displayName.toLowerCase().includes('salary') || displayName.toLowerCase().includes('uk');

        seeded.push({
          id: `inc_${c.id}`,
          name: displayName,
          weeklyAmount: Math.round(weekly * 100) / 100,
          section: 'income',
          subheading: displayName,
          isUkTaxed: isGamma,
        });
      });
    }

    // Add external reimbursements
    const todayIso = now.toISOString().slice(0, 10);
    const reimbs = reimbursementsOn ? reimbursementsOn(todayIso) : [];
    if (reimbs.length > 0) {
      reimbs.forEach(r => {
        const weekly = (r.amount * 12) / 52;
        seeded.push({
          id: `reimb_${r.id}`,
          name: `${r.name} (Reimbursement)`,
          weeklyAmount: Math.round(weekly * 100) / 100,
          section: 'income',
          subheading: 'Reimbursements',
          isUkTaxed: false,
        });
      });
    }

    // 2. REAL SURVIVAL EXPENSES (Fixed Expenses)
    if (fixedExpenses.length > 0) {
      fixedExpenses.forEach(fe => {
        let weekly = fe.amount;
        if (fe.frequency === 'monthly') weekly = (fe.amount * 12) / 52;
        else if (fe.frequency === 'fortnightly') weekly = fe.amount / 2;
        else if (fe.frequency === 'yearly') weekly = fe.amount / 52;
        else if (fe.frequency === 'quarterly') weekly = (fe.amount * 4) / 52;

        seeded.push({
          id: `surv_${fe.id}`,
          name: fe.name,
          weeklyAmount: Math.round(weekly * 100) / 100,
          section: 'survival',
          subheading: fe.notes?.toLowerCase().includes('bill') ? 'Bills' : 'Survival Expenses',
        });
      });
    }

    // 3. REAL OPTIONAL EXPENSES (Variable Spend)
    const variableCats = categories.filter(c => c.type !== 'income' && c.type !== 'fixed' && !c.exclude_from_reports);
    const variableTxs = transactions.filter(tx => {
      if (tx.amount >= 0) return false;
      if (tx.is_transfer) return false;
      if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') return false;
      if ((tx as any).fixed_expense_id || tx.is_fixed) return false;
      const d = new Date(tx.posted_at);
      return d >= ninetyDaysAgo && d <= now;
    });

    const varSpendByCatId = new Map<string, number>();
    for (const tx of variableTxs) {
      if (tx.category_id) {
        varSpendByCatId.set(tx.category_id, (varSpendByCatId.get(tx.category_id) || 0) + getTxBaseAmount(tx));
      }
    }

    if (variableCats.length > 0) {
      variableCats.forEach(c => {
        const catTotal90 = varSpendByCatId.get(c.id) || 0;
        const monthlyAvg = catTotal90 > 0 ? catTotal90 / 3 : (c.monthly_target || 0);
        const weekly = (monthlyAvg * 12) / 52;

        seeded.push({
          id: `opt_${c.id}`,
          name: c.name,
          weeklyAmount: Math.round(weekly * 100) / 100,
          section: 'optional',
          subheading: 'Optional Expenses',
        });
      });
    }

    // 4. REAL SAVINGS ACCOUNTS / POOLS
    if (goals.length > 0) {
      goals.forEach(g => {
        const weekly = g.assigned_amount ? (g.assigned_amount * 12) / 52 : 0;
        seeded.push({
          id: `sav_${g.id}`,
          name: g.name,
          weeklyAmount: Math.round(weekly * 100) / 100,
          section: 'savings',
          subheading: 'Saving Accounts',
        });
      });
    }

    return seeded;
  }, [categories, transactions, fixedExpenses, goals, reimbursementsOn]);

  // Local spreadsheet state initialized with actual system data
  const [items, setItems] = useState<SpreadsheetLineItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Error loading saved spreadsheet items', e);
    }
    return [];
  });

  const [affordableWeeklyInput, setAffordableWeeklyInput] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(AFFORDABLE_KEY);
      if (saved) return saved;
    } catch (e) {
      console.error('Error loading affordable amount', e);
    }
    return '';
  });

  // Automatically rename any title or subheading named "Income" to "Gamma" and set UK tax flag
  useEffect(() => {
    setItems(prev => {
      let modified = false;
      const updated = prev.map(i => {
        const isGamma = i.name === 'Gamma' || i.subheading === 'Gamma' || i.name === 'Income' || i.subheading === 'Income';
        const name = i.name === 'Income' ? 'Gamma' : i.name;
        const subheading = i.subheading === 'Income' ? 'Gamma' : i.subheading;
        const isUkTaxed = isGamma ? true : i.isUkTaxed;

        if (name !== i.name || subheading !== i.subheading || isUkTaxed !== i.isUkTaxed) {
          modified = true;
          return { ...i, name, subheading, isUkTaxed };
        }
        return i;
      });
      return modified ? updated : prev;
    });
    setIncomeOrder(prev => prev.map(s => (s === 'Income' ? 'Gamma' : s)));
  }, []);

  // Save to localStorage when items change
  useEffect(() => {
    if (items.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  }, [items]);

  useEffect(() => {
    if (affordableWeeklyInput) {
      localStorage.setItem(AFFORDABLE_KEY, affordableWeeklyInput);
    }
  }, [affordableWeeklyInput]);

  // Auto-sync real actuals on first load if state is empty
  useEffect(() => {
    if (items.length === 0) {
      const real = computeRealLineItems();
      setItems(real);
      const incTotal = real.filter(i => i.section === 'income').reduce((s, i) => s + getItemValues(i, 'net').effectiveWeekly, 0);
      const survTotal = real.filter(i => i.section === 'survival').reduce((s, i) => s + i.weeklyAmount, 0);
      const aff = Math.max(0, incTotal - survTotal);
      setAffordableWeeklyInput(String(Math.round(aff * 100) / 100));
    }
  }, [items.length, computeRealLineItems]);

  const handleSyncRealData = () => {
    const real = computeRealLineItems();
    setItems(real);
    const incTotal = real.filter(i => i.section === 'income').reduce((s, i) => s + getItemValues(i, 'net').effectiveWeekly, 0);
    const survTotal = real.filter(i => i.section === 'survival').reduce((s, i) => s + i.weeklyAmount, 0);
    const aff = Math.max(0, incTotal - survTotal);
    setAffordableWeeklyInput(String(Math.round(aff * 100) / 100));
    toast.success('Spreadsheet updated with your actual income & expenses!');
  };

  const handleUpdateItem = (id: string, updates: Partial<SpreadsheetLineItem>) => {
    setItems(prev => prev.map(item => (item.id === id ? { ...item, ...updates } : item)));
  };

  // Subheading Rename State
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameForm, setRenameForm] = useState<{ section: string; oldSub: string; newSub: string }>({
    section: '',
    oldSub: '',
    newSub: '',
  });

  const handleOpenRenameSubheading = (section: string, oldSub: string) => {
    setRenameForm({ section, oldSub, newSub: oldSub });
    setRenameDialogOpen(true);
  };

  const handleSaveRenameSubheading = () => {
    const newName = renameForm.newSub.trim();
    if (!newName) {
      toast.error('Please enter a valid title');
      return;
    }
    const { section, oldSub } = renameForm;
    setItems(prev =>
      prev.map(i =>
        i.section === section && i.subheading === oldSub
          ? { ...i, subheading: newName, name: i.name === oldSub ? newName : i.name }
          : i
      )
    );
    if (section === 'income') {
      setIncomeOrder(prev => prev.map(s => (s === oldSub ? newName : s)));
    }
    toast.success(`Stream renamed to "${newName}"`);
    setRenameDialogOpen(false);
  };

  // UK Tax Configuration Modal State
  const [taxConfigOpen, setTaxConfigOpen] = useState(false);
  const [taxConfigItem, setTaxConfigItem] = useState<SpreadsheetLineItem | null>(null);
  const [taxForm, setTaxForm] = useState<{
    isUkTaxed: boolean;
    pensionPercent: string;
    studentLoanPlan: StudentLoanPlan;
  }>({
    isUkTaxed: true,
    pensionPercent: '0',
    studentLoanPlan: null,
  });

  const handleOpenTaxConfig = (item: SpreadsheetLineItem) => {
    setTaxConfigItem(item);
    setTaxForm({
      isUkTaxed: !!item.isUkTaxed,
      pensionPercent: String(item.pensionPercent || 0),
      studentLoanPlan: item.studentLoanPlan || null,
    });
    setTaxConfigOpen(true);
  };

  const handleSaveTaxConfig = () => {
    if (!taxConfigItem) return;
    const pen = parseFloat(taxForm.pensionPercent) || 0;
    handleUpdateItem(taxConfigItem.id, {
      isUkTaxed: taxForm.isUkTaxed,
      pensionPercent: pen,
      studentLoanPlan: taxForm.studentLoanPlan,
    });
    toast.success('UK Tax settings updated for ' + taxConfigItem.name);
    setTaxConfigOpen(false);
  };

  // Dialog State for Adding / Editing Line Items
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SpreadsheetLineItem | null>(null);
  const [form, setForm] = useState<{
    name: string;
    weeklyAmount: string;
    monthlyAmount: string;
    section: 'income' | 'survival' | 'optional' | 'savings';
    subheading: string;
    isUkTaxed: boolean;
  }>({
    name: '',
    weeklyAmount: '',
    monthlyAmount: '',
    section: 'survival',
    subheading: 'Survival Expenses',
    isUkTaxed: false,
  });

  const handleOpenAdd = (section: 'income' | 'survival' | 'optional' | 'savings', subheading?: string) => {
    setEditingItem(null);
    setForm({
      name: '',
      weeklyAmount: '',
      monthlyAmount: '',
      section,
      subheading: subheading || (section === 'income' ? 'Income Stream' : section === 'survival' ? 'Survival Expenses' : section === 'optional' ? 'Optional Expenses' : 'Saving Accounts'),
      isUkTaxed: false,
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (item: SpreadsheetLineItem) => {
    setEditingItem(item);
    const w = item.weeklyAmount;
    const m = (w * 52) / 12;
    setForm({
      name: item.name,
      weeklyAmount: String(Math.round(w * 100) / 100),
      monthlyAmount: String(Math.round(m * 100) / 100),
      section: item.section,
      subheading: item.subheading || '',
      isUkTaxed: !!item.isUkTaxed,
    });
    setDialogOpen(true);
  };

  const handleWeeklyFormChange = (valStr: string) => {
    const w = parseFloat(valStr);
    if (!isNaN(w)) {
      const m = (w * 52) / 12;
      setForm(f => ({ ...f, weeklyAmount: valStr, monthlyAmount: String(Math.round(m * 100) / 100) }));
    } else {
      setForm(f => ({ ...f, weeklyAmount: valStr }));
    }
  };

  const handleMonthlyFormChange = (valStr: string) => {
    const m = parseFloat(valStr);
    if (!isNaN(m)) {
      const w = (m * 12) / 52;
      setForm(f => ({ ...f, monthlyAmount: valStr, weeklyAmount: String(Math.round(w * 100) / 100) }));
    } else {
      setForm(f => ({ ...f, monthlyAmount: valStr }));
    }
  };

  const handleSaveItem = () => {
    if (!form.name.trim()) {
      toast.error('Please enter an item name');
      return;
    }
    const amt = parseFloat(form.weeklyAmount);
    if (isNaN(amt) || amt < 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (editingItem) {
      handleUpdateItem(editingItem.id, {
        name: form.name,
        weeklyAmount: amt,
        section: form.section,
        subheading: form.subheading,
        isUkTaxed: form.isUkTaxed,
      });
      toast.success('Line item updated');
    } else {
      const newItem: SpreadsheetLineItem = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        name: form.name,
        weeklyAmount: amt,
        section: form.section,
        subheading: form.subheading || (form.section === 'income' ? 'Income Stream' : 'Expenses'),
        isUkTaxed: form.isUkTaxed,
      };
      setItems(prev => [...prev, newItem]);
      toast.success('Line item added');
    }
    setDialogOpen(false);
  };

  const handleDeleteItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success('Item deleted');
  };

  // ---- Calculations with UK Tax Awareness ----
  const incomeItems = useMemo(() => items.filter(i => i.section === 'income'), [items]);
  const survivalItems = useMemo(() => items.filter(i => i.section === 'survival'), [items]);
  const optionalItems = useMemo(() => items.filter(i => i.section === 'optional'), [items]);
  const savingsItems = useMemo(() => items.filter(i => i.section === 'savings'), [items]);

  const totalWeeklyIncome = useMemo(
    () => incomeItems.reduce((s, i) => s + getItemValues(i, taxViewMode).effectiveWeekly, 0),
    [incomeItems, taxViewMode]
  );
  const totalWeeklySurvival = useMemo(() => survivalItems.reduce((s, i) => s + i.weeklyAmount, 0), [survivalItems]);
  const totalWeeklyOptional = useMemo(() => optionalItems.reduce((s, i) => s + i.weeklyAmount, 0), [optionalItems]);
  const totalWeeklySavings = useMemo(() => savingsItems.reduce((s, i) => s + i.weeklyAmount, 0), [savingsItems]);

  // Group income items by subheadings with custom order support
  const groupedIncomeMap = useMemo(() => {
    const map = new Map<string, SpreadsheetLineItem[]>();
    incomeItems.forEach(item => {
      const sub = item.subheading || 'General';
      if (!map.has(sub)) map.set(sub, []);
      map.get(sub)!.push(item);
    });
    return map;
  }, [incomeItems]);

  const orderedIncomeSubheadings = useMemo(() => {
    const existingSubs = Array.from(groupedIncomeMap.keys());
    const fullOrder = [...incomeOrder];
    existingSubs.forEach(s => {
      if (!fullOrder.includes(s)) fullOrder.push(s);
    });
    return fullOrder.filter(s => groupedIncomeMap.has(s));
  }, [groupedIncomeMap, incomeOrder]);

  const handleMoveIncomeSubheading = (sub: string, direction: 'up' | 'down') => {
    const currentSubs = orderedIncomeSubheadings;
    const idx = currentSubs.indexOf(sub);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentSubs.length) return;

    const newOrder = [...currentSubs];
    const temp = newOrder[idx];
    newOrder[idx] = newOrder[targetIdx];
    newOrder[targetIdx] = temp;

    setIncomeOrder(newOrder);
    toast.success('Income streams reordered');
  };

  // Aggregate Top Bar Metrics
  const weeklyCostWSavings = totalWeeklySurvival + totalWeeklyOptional + totalWeeklySavings;
  const monthlyCostWSavings = (weeklyCostWSavings * 52) / 12;
  const total6MonthsWSavings = weeklyCostWSavings * 26;
  const totalAnnualWSavings = weeklyCostWSavings * 52;

  const weeklyCostNoSavings = totalWeeklySurvival + totalWeeklyOptional;
  const monthlyCostNoSavings = (weeklyCostNoSavings * 52) / 12;
  const total6MonthsNoSavings = weeklyCostNoSavings * 26;
  const totalAnnualNoSavings = weeklyCostNoSavings * 52;

  const affordableWeekly = parseFloat(affordableWeeklyInput) || Math.max(0, totalWeeklyIncome - totalWeeklySurvival);
  
  const weeklyShortfallWSavings = Math.max(0, weeklyCostWSavings - affordableWeekly);
  const weeklyShortfallNoSavings = Math.max(0, weeklyCostNoSavings - affordableWeekly);

  return (
    <div className="space-y-6">
      {/* Top Action Bar (Compact) */}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleSyncRealData}
          className="rounded-xl font-bold text-xs border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-slate-500" /> Sync System Cashflow
        </Button>
        <Button
          size="sm"
          onClick={() => handleOpenAdd('survival')}
          className="rounded-xl font-bold text-xs bg-[#FF2EB8] hover:bg-[#FF2EB8]/90 text-white shadow-2xs"
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Expense Line
        </Button>
      </div>

      {/* Top Section Summary KPI Cards */}
      {(() => {
        const netWeeklyBalance = totalWeeklyIncome - (totalWeeklySurvival + totalWeeklyOptional + totalWeeklySavings);
        const netMonthlyBalance = (netWeeklyBalance * 52) / 12;
        const netAnnualBalance = netWeeklyBalance * 52;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Card 1: Income (Green) */}
            <div className="rounded-[2rem] p-5 border-2 bg-[#86EFAC]/40 border-[#22C55E] shadow-sm">
              <div className="text-[11px] font-display font-bold uppercase tracking-wider text-[#166534]">
                Income
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs text-slate-600 font-medium">Weekly Total</span>
                <span className="text-xl font-display font-black text-[#166534] tabular-nums">
                  {formatCurrency(totalWeeklyIncome, baseCurrency)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between pt-1 border-t border-[#22C55E]/30">
                <span className="text-[11px] text-slate-500 font-medium">Monthly / Annual</span>
                <span className="text-xs font-display font-bold text-[#166534] tabular-nums">
                  {formatCurrency((totalWeeklyIncome * 52) / 12, baseCurrency)} / {formatCurrency(totalWeeklyIncome * 52, baseCurrency)}
                </span>
              </div>
            </div>

            {/* Card 2: Fixed Expenses (Red) */}
            <div className="rounded-[2rem] p-5 border-2 bg-[#FFB4B4]/40 border-[#FF4D6D] shadow-sm">
              <div className="text-[11px] font-display font-bold uppercase tracking-wider text-[#7A0F1F]">
                Fixed Expenses
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs text-slate-600 font-medium">Weekly Total</span>
                <span className="text-xl font-display font-black text-[#7A0F1F] tabular-nums">
                  {formatCurrency(totalWeeklySurvival, baseCurrency)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between pt-1 border-t border-[#FF4D6D]/30">
                <span className="text-[11px] text-slate-500 font-medium">Monthly / Annual</span>
                <span className="text-xs font-display font-bold text-[#7A0F1F] tabular-nums">
                  {formatCurrency((totalWeeklySurvival * 52) / 12, baseCurrency)} / {formatCurrency(totalWeeklySurvival * 52, baseCurrency)}
                </span>
              </div>
            </div>

            {/* Card 3: Variable Expenses (Red) */}
            <div className="rounded-[2rem] p-5 border-2 bg-[#FFB4B4]/40 border-[#FF4D6D] shadow-sm">
              <div className="text-[11px] font-display font-bold uppercase tracking-wider text-[#7A0F1F]">
                Variable Expenses
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs text-slate-600 font-medium">Weekly Total</span>
                <span className="text-xl font-display font-black text-[#7A0F1F] tabular-nums">
                  {formatCurrency(totalWeeklyOptional, baseCurrency)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between pt-1 border-t border-[#FF4D6D]/30">
                <span className="text-[11px] text-slate-500 font-medium">Monthly / Annual</span>
                <span className="text-xs font-display font-bold text-[#7A0F1F] tabular-nums">
                  {formatCurrency((totalWeeklyOptional * 52) / 12, baseCurrency)} / {formatCurrency(totalWeeklyOptional * 52, baseCurrency)}
                </span>
              </div>
            </div>

            {/* Card 4: Savings (Pink) */}
            <div className="rounded-[2rem] p-5 border-2 bg-[#FCE7F3]/80 border-[#EC4899] shadow-sm">
              <div className="text-[11px] font-display font-bold uppercase tracking-wider text-[#9D174D]">
                Savings
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs text-slate-600 font-medium">Weekly Total</span>
                <span className="text-xl font-display font-black text-[#9D174D] tabular-nums">
                  {formatCurrency(totalWeeklySavings, baseCurrency)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between pt-1 border-t border-[#EC4899]/30">
                <span className="text-[11px] text-slate-500 font-medium">Monthly / Annual</span>
                <span className="text-xs font-display font-bold text-[#9D174D] tabular-nums">
                  {formatCurrency((totalWeeklySavings * 52) / 12, baseCurrency)} / {formatCurrency(totalWeeklySavings * 52, baseCurrency)}
                </span>
              </div>
            </div>

            {/* Card 5: Net Balance (Blue / Red depending on surplus/deficit) */}
            <div className={`rounded-[2rem] p-5 border-2 shadow-sm ${
              netWeeklyBalance >= 0 
                ? 'bg-[#CDECFF]/40 border-[#60A5FA]' 
                : 'bg-[#FFB4B4]/40 border-[#FF4D6D]'
            }`}>
              <div className={`text-[11px] font-display font-bold uppercase tracking-wider ${
                netWeeklyBalance >= 0 ? 'text-[#0C4A6E]' : 'text-[#7A0F1F]'
              }`}>
                Net Balance
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs text-slate-600 font-medium">Weekly Total</span>
                <span className={`text-xl font-display font-black tabular-nums ${
                  netWeeklyBalance >= 0 ? 'text-[#0C4A6E]' : 'text-[#7A0F1F]'
                }`}>
                  {formatCurrency(netWeeklyBalance, baseCurrency)}
                </span>
              </div>
              <div className={`mt-1 flex items-baseline justify-between pt-1 border-t ${
                netWeeklyBalance >= 0 ? 'border-[#60A5FA]/30' : 'border-[#FF4D6D]/30'
              }`}>
                <span className="text-[11px] text-slate-500 font-medium">Monthly / Annual</span>
                <span className={`text-xs font-display font-bold tabular-nums ${
                  netWeeklyBalance >= 0 ? 'text-[#0C4A6E]' : 'text-[#7A0F1F]'
                }`}>
                  {formatCurrency(netMonthlyBalance, baseCurrency)} / {formatCurrency(netAnnualBalance, baseCurrency)}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================== */}
      {/* SECTION 1: INCOME STREAMS */}
      {/* ========================================== */}
      <div className="bg-white rounded-[2rem] border-2 border-slate-200 shadow-sm overflow-hidden">
        {/* Main Income Banner with UK Tax Mode Toggle */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white px-6 py-4 flex items-center justify-between flex-wrap gap-4">
          <button
            onClick={() => toggleCollapse('main_income')}
            className="flex items-center gap-3 text-left group transition-all"
          >
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-bold">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-display font-black tracking-wide text-white">INCOME</h3>
                {collapsedIds.has('main_income') ? (
                  <ChevronDown className="w-5 h-5 text-white/80 group-hover:text-white" />
                ) : (
                  <ChevronUp className="w-5 h-5 text-white/80 group-hover:text-white" />
                )}
              </div>
              <p className="text-xs text-blue-100 font-medium">Multi-stream revenue & UK Tax / AU exempt breakdown</p>
            </div>
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Global Tax View Mode Toggle */}
            <div className="flex items-center bg-white/10 p-1 rounded-xl border border-white/20 text-xs font-bold">
              <button
                onClick={() => setTaxViewMode('net')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  taxViewMode === 'net' ? 'bg-white text-blue-900 shadow-xs' : 'text-blue-100 hover:text-white'
                }`}
              >
                🇬🇧 Net Take-Home
              </button>
              <button
                onClick={() => setTaxViewMode('gross')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  taxViewMode === 'gross' ? 'bg-white text-blue-900 shadow-xs' : 'text-blue-100 hover:text-white'
                }`}
              >
                Gross Income
              </button>
            </div>

            <div className="text-right">
              <div className="text-[10px] uppercase font-bold text-blue-200">
                Total Income ({taxViewMode === 'net' ? 'Net' : 'Gross'}) / Wk
              </div>
              <div className="text-lg font-display font-black text-white tabular-nums">
                {formatCurrency(totalWeeklyIncome, baseCurrency)}
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => handleOpenAdd('income')}
              className="bg-white/20 hover:bg-white/30 text-white border-0 font-bold rounded-xl text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Income Stream
            </Button>
          </div>
        </div>

        {/* Collapsible Main Income Body - Master Spreadsheet Table */}
        {!collapsedIds.has('main_income') && (
          <div className="p-0">
            {incomeItems.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No income streams logged yet. Click "Add Income Stream" above.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {/* Single Master Table Header Row for Income */}
                <div className="bg-blue-50/90 border-b border-blue-200/80 px-4 py-2 grid grid-cols-12 text-[11px] font-display font-bold uppercase tracking-wider text-blue-900 gap-2">
                  <div className="col-span-4">Line Item</div>
                  <div className="col-span-2 text-right">By week /pp</div>
                  <div className="col-span-2 text-right">Monthly</div>
                  <div className="col-span-3 text-right">Annual (total)</div>
                  <div className="col-span-1 text-center">Actions</div>
                </div>

                {orderedIncomeSubheadings.map((sub, idx) => {
                  const subItems = groupedIncomeMap.get(sub) || [];
                  const isFirst = idx === 0;
                  const isLast = idx === orderedIncomeSubheadings.length - 1;
                  const isSubCollapsed = collapsedIds.has(`inc_sub_${sub}`);

                  // Calculate Net/Gross totals for this stream
                  const subValues = subItems.map(item => getItemValues(item, taxViewMode));
                  const subWeekly = subValues.reduce((s, v) => s + v.effectiveWeekly, 0);
                  const subMonthly = (subWeekly * 52) / 12;
                  const subAnnual = subWeekly * 52;

                  const primaryItem = subItems[0];
                  const isUkTaxedStream = subItems.some(i => i.isUkTaxed);
                  const primaryTaxInfo = primaryItem ? getItemValues(primaryItem, 'net') : null;

                  return (
                    <div key={sub} className="bg-white">
                      {/* Slim Section Divider Row */}
                      <div className="bg-slate-100/90 px-4 py-1.5 flex items-center justify-between border-b border-slate-200/80 flex-wrap gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleCollapse(`inc_sub_${sub}`)}
                            className="flex items-center gap-1 font-display font-bold text-slate-900 hover:text-blue-700 transition-colors"
                          >
                            {isSubCollapsed ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
                            ) : (
                              <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
                            )}
                            <span>{sub}</span>
                          </button>
                          <button
                            onClick={() => handleOpenRenameSubheading('income', sub)}
                            className="p-0.5 text-slate-400 hover:text-slate-800 rounded transition-colors"
                            title="Rename Stream Title"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <div className="flex items-center ml-1 border-l border-slate-300 pl-1.5 gap-0.5">
                            <button
                              disabled={isFirst}
                              onClick={() => handleMoveIncomeSubheading(sub, 'up')}
                              className="p-0.5 text-slate-500 hover:text-slate-900 disabled:opacity-20 rounded transition-colors"
                              title="Move Stream Up"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              disabled={isLast}
                              onClick={() => handleMoveIncomeSubheading(sub, 'down')}
                              className="p-0.5 text-slate-500 hover:text-slate-900 disabled:opacity-20 rounded transition-colors"
                              title="Move Stream Down"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Tax Country Badge (Only for UK Taxed streams like Gamma) */}
                          {isUkTaxedStream && (
                            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] font-bold gap-1 ml-1 py-0 px-1.5">
                              <span>🇬🇧</span> UK PAYE Taxed
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-display font-semibold text-slate-600 tabular-nums">
                            Subtotal: <strong>{formatCurrency(subWeekly, baseCurrency)}</strong>/wk | <strong>{formatCurrency(subMonthly, baseCurrency)}</strong>/mo
                          </span>
                          {isUkTaxedStream && primaryItem && (
                            <button
                              onClick={() => handleOpenTaxConfig(primaryItem)}
                              className="p-1 text-indigo-700 hover:bg-indigo-100 rounded transition-colors"
                              title="Configure UK Tax Settings"
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Tax Summary Banner for Gamma / UK Streams */}
                      {isUkTaxedStream && primaryTaxInfo && primaryTaxInfo.isTaxed && (
                        <div className="bg-indigo-950 text-white px-4 py-1.5 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] border-b border-indigo-800 gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🇬🇧</span>
                            <div>
                              <span className="font-bold text-indigo-200">UK PAYE Breakdown: </span>
                              <span className="text-indigo-100">
                                Gross {formatCurrency(primaryTaxInfo.grossMonthly, baseCurrency)}/mo → Tax -{formatCurrency(primaryTaxInfo.incomeTax / 12, baseCurrency)}/mo, NI -{formatCurrency(primaryTaxInfo.ni / 12, baseCurrency)}/mo → <strong className="text-emerald-400 font-bold">Net Take-Home {formatCurrency(primaryTaxInfo.netMonthly, baseCurrency)}/mo</strong>
                              </span>
                            </div>
                          </div>
                          <Badge className="bg-indigo-800 text-indigo-100 border-indigo-700 self-start sm:self-auto text-[10px]">
                            {(primaryTaxInfo.taxRate * 100).toFixed(1)}% Effective Tax & NI
                          </Badge>
                        </div>
                      )}

                      {!isSubCollapsed && (
                        <div className="divide-y divide-slate-100">
                          {subItems.map(item => (
                            <LineRow
                              key={item.id}
                              item={item}
                              baseCurrency={baseCurrency}
                              taxViewMode={taxViewMode}
                              onUpdateItem={handleUpdateItem}
                              onEdit={() => handleOpenEdit(item)}
                              onDelete={() => handleDeleteItem(item.id)}
                              onConfigureTax={() => handleOpenTaxConfig(item)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Income Summary Footer Row */}
            <div className="bg-blue-50/90 px-4 py-3 border-t border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-display font-black text-blue-900 text-sm">
                  TOTAL INCOME ({taxViewMode === 'net' ? 'NET TAKE-HOME' : 'GROSS'})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-5 font-display font-bold text-blue-900 text-xs sm:text-sm">
                <div>
                  <span className="text-[10px] text-blue-600 block uppercase font-semibold">Weekly</span>
                  <span>{formatCurrency(totalWeeklyIncome, baseCurrency)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-blue-600 block uppercase font-semibold">Monthly</span>
                  <span>{formatCurrency((totalWeeklyIncome * 52) / 12, baseCurrency)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-blue-600 block uppercase font-semibold">Annual Total</span>
                  <span className="font-black text-base">{formatCurrency(totalWeeklyIncome * 52, baseCurrency)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================== */}
      {/* SECTION 2: EXPENSES (Survival, Optional, Savings) */}
      {/* ========================================== */}
      <div className="bg-white rounded-[2rem] border-2 border-slate-200 shadow-sm overflow-hidden">
        {/* Main Expenses Banner with Collapse Toggle */}
        <div className="bg-gradient-to-r from-red-600 to-rose-700 text-white px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => toggleCollapse('main_expenses')}
            className="flex items-center gap-3 text-left group transition-all"
          >
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-bold">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-display font-black tracking-wide text-white">EXPENSES</h3>
                {collapsedIds.has('main_expenses') ? (
                  <ChevronDown className="w-5 h-5 text-white/80 group-hover:text-white" />
                ) : (
                  <ChevronUp className="w-5 h-5 text-white/80 group-hover:text-white" />
                )}
              </div>
              <p className="text-xs text-red-100 font-medium">Survival, Optional & Saving Accounts</p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold text-red-200">Total Expenses / Wk</div>
              <div className="text-lg font-display font-black text-white tabular-nums">
                {formatCurrency(weeklyCostWSavings, baseCurrency)}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Main Expenses Body - Master Spreadsheet Table */}
        {!collapsedIds.has('main_expenses') && (
          <div className="p-0">
            <div className="divide-y divide-slate-200">
              {/* Single Master Table Header Row for Expenses */}
              <div className="bg-red-50/90 border-b border-red-200/80 px-4 py-2 grid grid-cols-12 text-[11px] font-display font-bold uppercase tracking-wider text-red-900 gap-2">
                <div className="col-span-4">Line Item</div>
                <div className="col-span-2 text-right">By week /pp</div>
                <div className="col-span-2 text-right">Monthly</div>
                <div className="col-span-3 text-right">Annual (total)</div>
                <div className="col-span-1 text-center">Actions</div>
              </div>

              {/* Sub-heading 1: Survival Expenses */}
              <ExpenseGroupSection
                title="Survival Expenses"
                badge="Fixed & Essential"
                accentColor="#DC2626"
                headerBg="bg-red-600 text-white"
                subtotalText="TOTAL"
                subtotalColor="text-red-600"
                items={survivalItems}
                baseCurrency={baseCurrency}
                taxViewMode={taxViewMode}
                isCollapsed={collapsedIds.has('sub_survival')}
                onToggleCollapse={() => toggleCollapse('sub_survival')}
                onUpdateItem={handleUpdateItem}
                onAdd={() => handleOpenAdd('survival', 'Survival Expenses')}
                onEdit={handleOpenEdit}
                onDelete={handleDeleteItem}
              />

              {/* Sub-heading 2: Optional Expenses */}
              <ExpenseGroupSection
                title="Optional Expenses"
                badge="Variable & Fun"
                accentColor="#E11D48"
                headerBg="bg-rose-500 text-white"
                subtotalText="TOTAL"
                subtotalColor="text-rose-600"
                items={optionalItems}
                baseCurrency={baseCurrency}
                taxViewMode={taxViewMode}
                isCollapsed={collapsedIds.has('sub_optional')}
                onToggleCollapse={() => toggleCollapse('sub_optional')}
                onUpdateItem={handleUpdateItem}
                onAdd={() => handleOpenAdd('optional', 'Optional Expenses')}
                onEdit={handleOpenEdit}
                onDelete={handleDeleteItem}
              />

              {/* Sub-heading 3: Saving Accounts / Pools */}
              <ExpenseGroupSection
                title="Saving Accounts"
                badge="Pools & Reserves"
                accentColor="#0284C7"
                headerBg="bg-[#38BDF8] text-slate-900"
                subtotalText="TOTAL"
                subtotalColor="text-sky-700"
                items={savingsItems}
                baseCurrency={baseCurrency}
                taxViewMode={taxViewMode}
                isCollapsed={collapsedIds.has('sub_savings')}
                onToggleCollapse={() => toggleCollapse('sub_savings')}
                onUpdateItem={handleUpdateItem}
                onAdd={() => handleOpenAdd('savings', 'Saving Accounts')}
                onEdit={handleOpenEdit}
                onDelete={handleDeleteItem}
              />
            </div>

            {/* Expenses Grand Summary Footer Row */}
            <div className="bg-red-50/90 px-4 py-3 border-t border-red-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="font-display font-black text-red-950 text-sm uppercase">TOTAL EXPENSES (ALL CATEGORIES)</div>
              </div>
              <div className="flex flex-wrap gap-5 font-display font-bold text-red-950 text-xs sm:text-sm">
                <div>
                  <span className="text-[10px] text-red-600 block font-semibold uppercase">Weekly</span>
                  <span>{formatCurrency(weeklyCostWSavings, baseCurrency)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-red-600 block font-semibold uppercase">Monthly</span>
                  <span>{formatCurrency(monthlyCostWSavings, baseCurrency)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-red-600 block font-semibold uppercase">6 Months</span>
                  <span>{formatCurrency(total6MonthsWSavings, baseCurrency)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-red-600 block font-semibold uppercase">Annual Total</span>
                  <span className="font-black text-base">{formatCurrency(totalAnnualWSavings, baseCurrency)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* UK Tax Configuration Modal */}
      <Dialog open={taxConfigOpen} onOpenChange={setTaxConfigOpen}>
        <DialogContent className="sm:max-w-[420px] rounded-3xl p-6 font-body">
          <DialogHeader>
            <DialogTitle className="font-display font-bold text-xl text-slate-900 flex items-center gap-2">
              <span>🇬🇧</span> UK PAYE Tax Settings
            </DialogTitle>
          </DialogHeader>
          {taxConfigItem && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-900">{taxConfigItem.name}</div>
                <div className="text-slate-600">
                  Gross Salary: <strong>{formatCurrency((taxConfigItem.weeklyAmount * 52) / 12, baseCurrency)}/mo</strong> ({formatCurrency(taxConfigItem.weeklyAmount * 52, baseCurrency)}/yr)
                </div>
              </div>

              <div className="flex items-center justify-between bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100">
                <div>
                  <div className="font-display font-bold text-xs text-indigo-950">Subject to UK PAYE Tax & NI</div>
                  <div className="text-[11px] text-indigo-700">Applies UK personal allowance & tax bands</div>
                </div>
                <Switch
                  checked={taxForm.isUkTaxed}
                  onCheckedChange={val => setTaxForm({ ...taxForm, isUkTaxed: val })}
                />
              </div>

              {taxForm.isUkTaxed && (
                <>
                  <div>
                    <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
                      Pension Contribution (% of Gross)
                    </label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      placeholder="0"
                      value={taxForm.pensionPercent}
                      onChange={e => setTaxForm({ ...taxForm, pensionPercent: e.target.value })}
                      className="rounded-xl border-slate-200 font-display font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
                      Student Loan Plan
                    </label>
                    <Select
                      value={taxForm.studentLoanPlan || 'none'}
                      onValueChange={(val: any) => setTaxForm({ ...taxForm, studentLoanPlan: val === 'none' ? null : val })}
                    >
                      <SelectTrigger className="rounded-xl border-slate-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="none">No Student Loan</SelectItem>
                        <SelectItem value="plan1">Plan 1</SelectItem>
                        <SelectItem value="plan2">Plan 2</SelectItem>
                        <SelectItem value="plan4">Plan 4 (Scotland)</SelectItem>
                        <SelectItem value="plan5">Plan 5</SelectItem>
                        <SelectItem value="postgrad">Postgraduate Loan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="ghost" onClick={() => setTaxConfigOpen(false)} className="rounded-xl font-bold">
              Cancel
            </Button>
            <Button onClick={handleSaveTaxConfig} className="rounded-xl font-bold bg-[#FF2EB8] hover:bg-[#FF2EB8]/90 text-white">
              Save Tax Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Subheading Modal */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[380px] rounded-3xl p-6 font-body">
          <DialogHeader>
            <DialogTitle className="font-display font-bold text-lg text-slate-900">
              Rename Section Title
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
              Section Title
            </label>
            <Input
              placeholder="e.g. Gamma, Side Hustle..."
              value={renameForm.newSub}
              onChange={e => setRenameForm({ ...renameForm, newSub: e.target.value })}
              className="rounded-xl border-slate-200 font-display font-bold"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="ghost" onClick={() => setRenameDialogOpen(false)} className="rounded-xl font-bold">
              Cancel
            </Button>
            <Button onClick={handleSaveRenameSubheading} className="rounded-xl font-bold bg-[#FF2EB8] hover:bg-[#FF2EB8]/90 text-white">
              Save Title
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Line Item Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px] rounded-3xl p-6 font-body">
          <DialogHeader>
            <DialogTitle className="font-display font-bold text-xl text-slate-900">
              {editingItem ? 'Edit Line Item' : 'Add Line Item'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
                Item Name
              </label>
              <Input
                placeholder="e.g. Rent, Groceries, Holiday..."
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="rounded-xl border-slate-200 font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
                  Weekly Amount ({baseCurrency})
                </label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.weeklyAmount}
                  onChange={e => handleWeeklyFormChange(e.target.value)}
                  className="rounded-xl border-slate-200 font-display font-bold text-base"
                />
              </div>

              <div>
                <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
                  Monthly Amount ({baseCurrency})
                </label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.monthlyAmount}
                  onChange={e => handleMonthlyFormChange(e.target.value)}
                  className="rounded-xl border-slate-200 font-display font-bold text-base"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
                Category Section
              </label>
              <Select
                value={form.section}
                onValueChange={(val: any) => setForm({ ...form, section: val })}
              >
                <SelectTrigger className="rounded-xl border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="income">Income Stream</SelectItem>
                  <SelectItem value="survival">Survival Expenses (Fixed)</SelectItem>
                  <SelectItem value="optional">Optional Expenses (Variable)</SelectItem>
                  <SelectItem value="savings">Saving Accounts (Pools)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-display font-bold text-slate-700 uppercase tracking-wide block mb-1.5">
                Subheading / Group Name
              </label>
              <Input
                placeholder="e.g. Gamma, Survival Expenses, Bills, Side Hustle..."
                value={form.subheading}
                onChange={e => setForm({ ...form, subheading: e.target.value })}
                className="rounded-xl border-slate-200 font-medium"
              />
            </div>

            {form.section === 'income' && (
              <div className="flex items-center justify-between bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100">
                <div>
                  <div className="font-display font-bold text-xs text-indigo-950">🇬🇧 UK PAYE Taxed Income</div>
                  <div className="text-[11px] text-indigo-700">Applies UK personal allowance & tax rates</div>
                </div>
                <Switch
                  checked={form.isUkTaxed}
                  onCheckedChange={val => setForm({ ...form, isUkTaxed: val })}
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              className="rounded-xl font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveItem}
              className="rounded-xl font-bold bg-[#FF2EB8] hover:bg-[#FF2EB8]/90 text-white"
            >
              {editingItem ? 'Save Changes' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Sub-components ----

function ExpenseGroupSection({
  title,
  badge,
  accentColor,
  headerBg,
  subtotalText,
  subtotalColor,
  items,
  baseCurrency,
  taxViewMode,
  isCollapsed,
  onToggleCollapse,
  onUpdateItem,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  badge: string;
  accentColor: string;
  headerBg: string;
  subtotalText: string;
  subtotalColor: string;
  items: SpreadsheetLineItem[];
  baseCurrency: string;
  taxViewMode: 'net' | 'gross';
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onUpdateItem: (id: string, updates: Partial<SpreadsheetLineItem>) => void;
  onAdd: () => void;
  onEdit: (item: SpreadsheetLineItem) => void;
  onDelete: (id: string) => void;
}) {
  const totalWeekly = items.reduce((s, i) => s + getItemValues(i, taxViewMode).effectiveWeekly, 0);
  const totalMonthly = (totalWeekly * 52) / 12;
  const totalAnnual = totalWeekly * 52;

  return (
    <div className="bg-white">
      {/* Subheading Section Row */}
      <div className="bg-slate-100/90 px-4 py-1.5 flex items-center justify-between border-b border-slate-200/80 text-xs">
        <div className="flex items-center gap-2">
          {onToggleCollapse ? (
            <button
              onClick={onToggleCollapse}
              className="flex items-center gap-1 font-display font-bold text-slate-900 hover:text-red-700 transition-colors"
            >
              {isCollapsed ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
              )}
              <span>{title}</span>
            </button>
          ) : (
            <span className="font-display font-bold text-slate-900">{title}</span>
          )}
          <span className="text-[10px] bg-slate-200/70 font-semibold px-2 py-0.5 rounded text-slate-700">
            {badge}
          </span>
        </div>
        <Button
          size="sm"
          onClick={onAdd}
          className="bg-slate-200 hover:bg-slate-300 text-slate-800 border-0 font-bold rounded-md text-[11px] h-6 px-2"
        >
          <Plus className="w-3 h-3 mr-1" /> Add Line
        </Button>
      </div>

      {!isCollapsed && (
        <div className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <div className="text-center py-4 text-slate-400 text-xs">
              No items in {title.toLowerCase()}.
            </div>
          ) : (
            items.map(item => (
              <LineRow
                key={item.id}
                item={item}
                baseCurrency={baseCurrency}
                taxViewMode={taxViewMode}
                onUpdateItem={onUpdateItem}
                onEdit={() => onEdit(item)}
                onDelete={() => onDelete(item.id)}
              />
            ))
          )}
        </div>
      )}

      {/* Subtotal Row */}
      <div className="bg-slate-50/90 px-4 py-2 border-t border-slate-200/80 grid grid-cols-12 items-center gap-2 text-xs">
        <div className="col-span-4">
          <span className={`font-display font-bold uppercase tracking-wider text-[11px] ${subtotalColor}`}>
            {subtotalText} {title.toUpperCase()}
          </span>
        </div>
        <div className="col-span-2 text-right">
          <span className="font-display font-bold text-slate-900 tabular-nums">
            {formatCurrency(totalWeekly, baseCurrency)}
          </span>
        </div>
        <div className="col-span-2 text-right">
          <span className="font-display font-bold text-slate-900 tabular-nums">
            {formatCurrency(totalMonthly, baseCurrency)}
          </span>
        </div>
        <div className="col-span-3 text-right">
          <span className="font-display font-bold text-slate-900 tabular-nums">
            {formatCurrency(totalAnnual, baseCurrency)}
          </span>
        </div>
        <div className="col-span-1"></div>
      </div>
    </div>
  );
}

function LineRow({
  item,
  baseCurrency,
  taxViewMode,
  onUpdateItem,
  onEdit,
  onDelete,
  onConfigureTax,
}: {
  item: SpreadsheetLineItem;
  baseCurrency: string;
  taxViewMode?: 'net' | 'gross';
  onUpdateItem: (id: string, updates: Partial<SpreadsheetLineItem>) => void;
  onEdit: () => void;
  onDelete: () => void;
  onConfigureTax?: () => void;
}) {
  const symbol = baseCurrency === 'GBP' ? '£' : 'A$';
  const tv = getItemValues(item, taxViewMode || 'net');

  // Input fields always represent Gross input values so typing Gross Annual (e.g. 37000) is 100% natural
  const grossWeekly = Math.round(tv.grossWeekly * 100) / 100;
  const grossMonthly = Math.round(tv.grossMonthly * 100) / 100;
  const grossAnnual = Math.round(tv.grossAnnual * 100) / 100;

  // Local string state to allow unhindered typing (e.g. typing "37000" or decimals)
  const [weeklyStr, setWeeklyStr] = useState<string | null>(null);
  const [monthlyStr, setMonthlyStr] = useState<string | null>(null);
  const [annualStr, setAnnualStr] = useState<string | null>(null);

  const displayWeekly = weeklyStr !== null ? weeklyStr : grossWeekly.toString();
  const displayMonthly = monthlyStr !== null ? monthlyStr : grossMonthly.toString();
  const displayAnnual = annualStr !== null ? annualStr : grossAnnual.toString();

  const handleWeeklyChange = (valStr: string) => {
    setWeeklyStr(valStr);
    const val = parseFloat(valStr);
    if (!isNaN(val) && val >= 0) {
      onUpdateItem(item.id, { weeklyAmount: val });
    }
  };

  const handleMonthlyChange = (valStr: string) => {
    setMonthlyStr(valStr);
    const val = parseFloat(valStr);
    if (!isNaN(val) && val >= 0) {
      onUpdateItem(item.id, { weeklyAmount: (val * 12) / 52 });
    }
  };

  const handleAnnualChange = (valStr: string) => {
    setAnnualStr(valStr);
    const val = parseFloat(valStr);
    if (!isNaN(val) && val >= 0) {
      onUpdateItem(item.id, { weeklyAmount: val / 52 });
    }
  };

  return (
    <div className="px-4 py-1.5 grid grid-cols-12 items-center text-xs hover:bg-slate-50/80 transition-colors group gap-2">
      <div className="col-span-4 font-semibold text-slate-800 flex flex-col justify-center truncate">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{item.name}</span>
          {item.isUkTaxed && (
            <Badge
              variant="outline"
              className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[9px] font-bold py-0 px-1 cursor-pointer hover:bg-indigo-100 shrink-0"
              onClick={onConfigureTax}
              title="Click to configure UK tax"
            >
              🇬🇧 UK Taxed
            </Badge>
          )}
        </div>
      </div>

      {/* Weekly Input */}
      <div className="col-span-2 text-right flex flex-col items-end justify-center">
        <div className="inline-flex items-center justify-end gap-0.5 bg-slate-50 group-hover:bg-white border border-slate-200/80 hover:border-slate-300 focus-within:border-[#FF2EB8] focus-within:bg-white rounded-md px-1.5 py-0.5 transition-all w-full h-7">
          <span className="text-[11px] text-slate-400 font-bold">{symbol}</span>
          <input
            type="number"
            step="0.01"
            value={displayWeekly}
            onFocus={() => setWeeklyStr(grossWeekly.toString())}
            onBlur={() => setWeeklyStr(null)}
            onChange={e => handleWeeklyChange(e.target.value)}
            className="w-full text-right font-display font-bold text-slate-900 bg-transparent focus:outline-none tabular-nums text-xs"
          />
        </div>
        {item.isUkTaxed && (
          <span className="text-[9px] font-bold text-emerald-700 tabular-nums">
            Net: {formatCurrency(tv.effectiveWeekly, baseCurrency)}
          </span>
        )}
      </div>

      {/* Monthly Input */}
      <div className="col-span-2 text-right flex flex-col items-end justify-center">
        <div className="inline-flex items-center justify-end gap-0.5 bg-slate-50 group-hover:bg-white border border-slate-200/80 hover:border-slate-300 focus-within:border-[#FF2EB8] focus-within:bg-white rounded-md px-1.5 py-0.5 transition-all w-full h-7">
          <span className="text-[11px] text-slate-400 font-bold">{symbol}</span>
          <input
            type="number"
            step="0.01"
            value={displayMonthly}
            onFocus={() => setMonthlyStr(grossMonthly.toString())}
            onBlur={() => setMonthlyStr(null)}
            onChange={e => handleMonthlyChange(e.target.value)}
            className="w-full text-right font-display font-semibold text-slate-700 bg-transparent focus:outline-none tabular-nums text-xs"
          />
        </div>
        {item.isUkTaxed && (
          <span className="text-[9px] font-bold text-emerald-700 tabular-nums">
            Net: {formatCurrency(tv.effectiveMonthly, baseCurrency)}
          </span>
        )}
      </div>

      {/* Annual Input */}
      <div className="col-span-3 text-right flex flex-col items-end justify-center">
        <div className="inline-flex items-center justify-end gap-0.5 bg-slate-50 group-hover:bg-white border border-slate-200/80 hover:border-slate-300 focus-within:border-[#FF2EB8] focus-within:bg-white rounded-md px-1.5 py-0.5 transition-all w-full h-7">
          <span className="text-[11px] text-slate-400 font-bold">{symbol}</span>
          <input
            type="number"
            step="0.01"
            value={displayAnnual}
            onFocus={() => setAnnualStr(grossAnnual.toString())}
            onBlur={() => setAnnualStr(null)}
            onChange={e => handleAnnualChange(e.target.value)}
            className="w-full text-right font-display font-semibold text-slate-700 bg-transparent focus:outline-none tabular-nums text-xs"
          />
        </div>
        {item.isUkTaxed && (
          <span className="text-[9px] font-bold text-emerald-700 tabular-nums">
            Net: {formatCurrency(tv.effectiveAnnual, baseCurrency)}
          </span>
        )}
      </div>

      <div className="col-span-1 text-center flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1 text-slate-400 hover:text-[#FF2EB8] rounded transition-colors"
          title="Edit Details"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
          title="Delete Line"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
