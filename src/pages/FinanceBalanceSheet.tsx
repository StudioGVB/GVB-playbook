import { useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Receipt, ShoppingBag, Scale } from 'lucide-react';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFixedExpenses, type FixedExpense } from '@/hooks/useFixedExpenses';
import { baseAmt, formatCurrency, isExcludedSpendDate } from '@/lib/financeUtils';
import { Button } from '@/components/ui/button';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, LayoutGrid } from 'lucide-react';
import FinanceSpreadsheetTab from '@/components/finance/FinanceSpreadsheetTab';
import MonthlyCashFlowBreakdown from '@/components/finance/MonthlyCashFlowBreakdown';
import { calcTakeHome } from '@/lib/ukTakeHome';

// Candy-jar palette (matches Accounts & Settings)
const PINK = '#FF2EB8';
const PINK_SOFT = '#FF7AD1';
const PINK_WASH = '#FFF5FA';
const GREEN = '#22C55E';
const GREEN_SOFT = '#86EFAC';
const GREEN_DEEP = '#166534';
const RED = '#FF4D6D';
const RED_SOFT = '#FFB4B4';
const RED_DEEP = '#7A0F1F';
const BLUE_SOFT = '#CDECFF';
const ORANGE_SOFT = '#FFD6A5';
const PURPLE_SOFT = '#E8D5FF';

const normalizeBillText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const billTokens = (value: string) =>
  normalizeBillText(value).split(' ').filter(token => token.length >= 3);

const TELECOM_TRANSACTION = /\b(lyca|lycamobile|mobile|phone|sim|vodafone|optus|telstra|ee|o2|giffgaff|three)\b/i;
const TELECOM_BILL = /\b(phone|mobile|sim|plan|bill)\b/i;

function billNameMatches(expense: FixedExpense, rawText: string): boolean {
  const expenseText = normalizeBillText(`${expense.name || ''} ${expense.notes || ''}`);
  const txText = normalizeBillText(rawText);
  if (!expenseText || !txText) return false;
  if (txText.includes(expenseText) || expenseText.includes(txText)) return true;
  if (TELECOM_TRANSACTION.test(rawText) && TELECOM_BILL.test(`${expense.name || ''} ${expense.notes || ''}`)) return true;
  const txTokenSet = new Set(billTokens(rawText));
  return billTokens(`${expense.name || ''} ${expense.notes || ''}`).some(token => txTokenSet.has(token));
}

export default function FinanceBalanceSheet() {
  const finance = useFinanceData();
  const { transactions, categories, settings } = finance;
  const { expenses: fixedExpenses } = useFixedExpenses();
  const baseCurrency = settings?.base_currency || 'AUD';
  const fxRates = (settings as any)?.fx_rates || { AUD_GBP: 0.52, GBP_AUD: 1.92 };

  const [monthOffset, setMonthOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<string>('overview');

  const monthStart = useMemo(() => startOfMonth(addMonths(new Date(), monthOffset)), [monthOffset]);
  const monthEnd = useMemo(() => endOfMonth(monthStart), [monthStart]);
  const monthLabel = format(monthStart, 'MMMM yyyy');

  const stats = useMemo(() => {
    let income = 0;
    let fixed = 0;
    let variable = 0;
    const bills: { name: string; amount: number; fixedExpenseId?: string | null; tx?: any }[] = [];
    const variableByCat = new Map<string, number>();
    const reimbursements: { name: string; amount: number }[] = [];
    // Fixed expense IDs already covered by a real transaction this month —
    // used to avoid double-adding an auto-pay synthesis on top.
    const matchedFixedIds = new Set<string>();

    for (const tx of transactions) {
      const d = new Date(tx.posted_at);
      if (d < monthStart || d > monthEnd) continue;
      if (isExcludedSpendDate(d)) continue;
      if (tx.is_transfer) continue;
      if (tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed') continue;
      if ((tx as any).goal_id) continue;
      const cat = categories.find(c => c.id === tx.category_id);
      if (cat?.exclude_from_reports) continue;

      const amt = baseAmt(tx);
      if (amt > 0) {
        income += amt;
      } else {
        const abs = Math.abs(amt);
        if ((tx as any).fixed_expense_id) {
          fixed += abs;
          const label = tx.merchant || tx.description || 'Bill';
          bills.push({ name: label, amount: abs, fixedExpenseId: (tx as any).fixed_expense_id, tx });
          if ((tx as any).fixed_expense_id) matchedFixedIds.add((tx as any).fixed_expense_id as string);
        } else {
          variable += abs;
          const key = cat?.name || 'Uncategorised';
          variableByCat.set(key, (variableByCat.get(key) || 0) + abs);
        }
      }
    }

    // Include auto-pay fixed expenses (e.g. rent) that don't appear in transactions
    const monthIso = format(monthStart, 'yyyy-MM-dd');
    const convert = (amt: number, from: string) => {
      if (from === baseCurrency) return amt;
      const key = `${from}_${baseCurrency}`;
      if (fxRates[key]) return amt * fxRates[key];
      const inv = fxRates[`${baseCurrency}_${from}`];
      if (inv) return amt / inv;
      return amt;
    };

    const isActiveExpense = (expense: FixedExpense) => {
      if (expense.frequency !== 'monthly') return false;
      if (expense.effective_from && monthIso < expense.effective_from.slice(0, 10)) return false;
      if (expense.effective_to && monthIso > expense.effective_to.slice(0, 10)) return false;
      return true;
    };

    const monthlyExpenseAmount = (expense: FixedExpense) =>
      convert(Number(expense.amount) || 0, expense.currency || baseCurrency);

    const findActiveBillMatch = (tx: any, txAbs: number) => {
      const rawText = `${tx.merchant || ''} ${tx.description || ''}`;
      const candidates = fixedExpenses.filter(expense => {
        if (!isActiveExpense(expense)) return false;
        const expenseAmount = monthlyExpenseAmount(expense);
        const diff = Math.abs(expenseAmount - txAbs);
        return diff <= Math.max(0.5, expenseAmount * 0.03);
      });
      return candidates.find(expense => billNameMatches(expense, rawText)) || (candidates.length === 1 ? candidates[0] : null);
    };

    for (const row of bills) {
      const linkedId = (row as any).fixedExpenseId as string | undefined;
      const replacement = findActiveBillMatch((row as any).tx, row.amount);
      if (replacement) {
        row.name = replacement.name;
        matchedFixedIds.add(replacement.id);
        continue;
      }

      if (!linkedId) continue;
      const linked = fixedExpenses.find(e => e.id === linkedId);
      if (linked && isActiveExpense(linked)) {
        matchedFixedIds.add(linked.id);
      }
    }

    // Committed fixed bills for the month — always show full expected total,
    // not just what's cleared. Avoid double-counting where a real tx exists.
    for (const e of fixedExpenses) {
      if (!isActiveExpense(e)) continue;
      const abs = monthlyExpenseAmount(e);
      if (abs <= 0) continue;

      if (matchedFixedIds.has(e.id)) {
        // Already included via a real transaction — skip to avoid double count.
      } else {
        fixed += abs;
        bills.push({ name: e.auto_pay ? `${e.name} (auto)` : `${e.name} (due)`, amount: abs });
      }

      // Phantom reimbursement income for bills paid from an external account.
      if (e.paid_externally) {
        income += abs;
        reimbursements.push({ name: `${e.name} reimbursement`, amount: abs });
      }
    }

    bills.sort((a, b) => b.amount - a.amount);
    const variableRows = Array.from(variableByCat.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      income,
      fixed,
      variable,
      totalExpenses: fixed + variable,
      net: income - fixed - variable,
      bills,
      variableRows,
      reimbursements,
    };
  }, [transactions, categories, fixedExpenses, monthStart, monthEnd, baseCurrency, fxRates]);

  const isPositive = stats.net >= 0;
  const heroBg = isPositive ? GREEN_SOFT : RED_SOFT;
  const heroBorder = isPositive ? GREEN : RED;
  const heroText = isPositive ? GREEN_DEEP : RED_DEEP;

  const poolSavingsMonthly = useMemo(() => {
    let monthlyTargetSum = 0;
    const now = new Date();
    for (const g of finance.goals) {
      if ((g as any).is_stash) continue;
      const targetBase = finance.convertToBase(g.target_amount || 0, g.currency);
      const assignedBase = finance.convertToBase(g.assigned_amount || 0, g.currency);
      const remainingBase = Math.max(0, targetBase - assignedBase);
      if (remainingBase <= 0.01) continue;
      if (g.deadline) {
        const daysLeft = Math.max(1, Math.ceil((new Date(g.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        const weeksLeft = Math.max(1, daysLeft / 7);
        const weeklyRequired = remainingBase / weeksLeft;
        monthlyTargetSum += weeklyRequired * 4.33;
      } else if (g.percent_allocation && g.percent_allocation > 0) {
        monthlyTargetSum += (g.percent_allocation / 100) * 400;
      }
    }
    return monthlyTargetSum;
  }, [finance.goals, finance.convertToBase]);

  const variableAllowanceMonthly = useMemo(() => {
    const essentialWeekly = finance.assumptions?.estimated_essential_variable || 115;
    const funWeekly = finance.assumptions?.weekly_fun_budget || 100;
    return (essentialWeekly + funWeekly) * 4.33;
  }, [finance.assumptions]);

  const expectedIncomeValue = useMemo(() => {
    if (!finance.assumptions) return 0;
    if (finance.assumptions.expected_monthly_income) return finance.assumptions.expected_monthly_income;
    if (finance.assumptions.gross_annual_salary) {
      return calcTakeHome({
        grossAnnual: finance.assumptions.gross_annual_salary,
        pensionPercent: finance.assumptions.pension_percent || 0,
        studentLoanPlan: finance.assumptions.student_loan_plan as any,
      }).netMonthly;
    }
    return 0;
  }, [finance.assumptions]);

  return (
    <div className="min-h-screen -mx-4 sm:-mx-6 -my-6 px-4 sm:px-6 py-6 bg-[#FFF5FA] font-body">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">
              Balance Sheet
            </h1>
            <p className="text-slate-500 mt-1">In vs out — the monthly candy count.</p>
          </div>
          <div className="flex items-center gap-1 bg-white/80 backdrop-blur-md rounded-2xl p-1.5 shadow-sm border border-[#FF7AD1]/30">
            <Button size="sm" variant="ghost" onClick={() => setMonthOffset(o => o - 1)} className="h-9 w-9 p-0 rounded-xl text-[#FF2EB8] hover:bg-[#FFF5FA]">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="px-3 font-display font-bold text-sm text-[#FF2EB8] min-w-[120px] text-center">{monthLabel}</div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMonthOffset(o => Math.min(0, o + 1))}
              disabled={monthOffset >= 0}
              className="h-9 w-9 p-0 rounded-xl text-[#FF2EB8] hover:bg-[#FFF5FA]"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-white/80 backdrop-blur-md p-1.5 rounded-2xl border border-[#FF7AD1]/30 shadow-sm inline-flex mb-2">
            <TabsTrigger
              value="overview"
              className="rounded-xl px-4 py-2 font-display font-bold text-sm data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white transition-all flex items-center gap-2"
            >
              <LayoutGrid className="w-4 h-4" />
              Balance Sheet Overview
            </TabsTrigger>
            <TabsTrigger
              value="spreadsheet"
              className="rounded-xl px-4 py-2 font-display font-bold text-sm data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white transition-all flex items-center gap-2"
            >
              <Table className="w-4 h-4" />
              Spreadsheet View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="spreadsheet" className="mt-4 focus-visible:outline-none">
            <FinanceSpreadsheetTab />
          </TabsContent>

          <TabsContent value="overview" className="mt-4 space-y-6 focus-visible:outline-none">
            {/* Super Clear Cash Flow Breakdown Card (Weekly / Monthly Toggle) */}
            <MonthlyCashFlowBreakdown
              income={stats.income}
              expectedIncome={expectedIncomeValue}
              fixedBills={stats.fixed}
              essentialBudget={(finance.assumptions?.estimated_essential_variable || 115) * 4.33}
              essentialSpent={stats.variable}
              poolSavings={poolSavingsMonthly}
              baseCurrency={baseCurrency}
              monthLabel={monthLabel}
              defaultViewMode="weekly"
            />

            {/* Net Hero */}
            <div
              className="rounded-[2rem] p-7 border-2 relative overflow-hidden"
              style={{ background: heroBg, borderColor: heroBorder, boxShadow: `8px 8px 0px 0px ${heroBorder}` }}
            >
              <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-widest" style={{ color: heroText }}>
                    <Scale className="h-4 w-4" /> Net · {monthLabel}
                  </div>
                  <div className="mt-2 flex items-baseline gap-3 flex-wrap">
                    <div className="text-5xl md:text-6xl font-display font-black tabular-nums leading-none" style={{ color: heroText }}>
                      {isPositive ? '+' : ''}{formatCurrency(stats.net, baseCurrency)}
                    </div>
                  </div>
                  <div className="mt-4 inline-flex items-center gap-1.5 bg-white/60 px-3 py-1 rounded-full text-sm font-bold" style={{ color: heroText }}>
                    {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {formatCurrency(stats.income, baseCurrency)} in − {formatCurrency(stats.totalExpenses, baseCurrency)} out
                  </div>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-white/50 flex items-center justify-center" style={{ color: heroText }}>
                  <Scale className="w-7 h-7" />
                </div>
              </div>
              <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full" style={{ background: `${heroBorder}20` }} />
              <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full" style={{ background: `${heroBorder}15` }} />
            </div>

            {/* Three KPI tiles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KpiTile
                label="Income"
                value={formatCurrency(stats.income, baseCurrency)}
                icon={<TrendingUp className="w-5 h-5" />}
                bg={BLUE_SOFT}
                border="#60A5FA"
                text="#0C4A6E"
                sub={stats.reimbursements.length > 0
                  ? `incl. ${formatCurrency(stats.reimbursements.reduce((s, r) => s + r.amount, 0), baseCurrency)} reimbursement`
                  : undefined}
              />
              <KpiTile label="Fixed Bills"   value={formatCurrency(stats.fixed, baseCurrency)}    icon={<Receipt className="w-5 h-5" />}    bg={ORANGE_SOFT} border="#F59E0B" text="#7C2D12" sub={`${stats.bills.length} payment${stats.bills.length === 1 ? '' : 's'}`} />
              <KpiTile label="Variable Spend" value={formatCurrency(stats.variable, baseCurrency)} icon={<ShoppingBag className="w-5 h-5" />} bg={PURPLE_SOFT} border="#A855F7" text="#4C1D95" sub={`${stats.variableRows.length} categor${stats.variableRows.length === 1 ? 'y' : 'ies'}`} />
            </div>

            {/* Reimbursements note */}
            {stats.reimbursements.length > 0 && (
              <div className="bg-white rounded-2xl border-2 border-sky-200 p-4 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-[10px] font-display font-bold uppercase tracking-widest text-sky-600">External reimbursements</div>
                    <div className="text-xs text-slate-500 mt-0.5">Bills paid from an outside account — offset added to income so the net isn't double-counted.</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.reimbursements.map((r, i) => (
                      <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 font-semibold border border-sky-100">
                        {r.name} · +{formatCurrency(r.amount, baseCurrency)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Breakdown lists */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <BreakdownCard title="Fixed Bills"       accent="#F59E0B" bg={ORANGE_SOFT} total={stats.fixed}    baseCurrency={baseCurrency} rows={stats.bills}        empty="No bills logged this month." />
              <BreakdownCard title="Variable Spending" accent="#A855F7" bg={PURPLE_SOFT} total={stats.variable} baseCurrency={baseCurrency} rows={stats.variableRows} empty="No variable spending yet." />
            </div>

            {/* Summary strip */}
            <div className="bg-white rounded-[2rem] p-6 border-2 border-[#FF7AD1]/30 shadow-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryRow label="Income"        value={stats.income}   baseCurrency={baseCurrency} tone="positive" />
                <SummaryRow label="− Fixed Bills" value={stats.fixed}    baseCurrency={baseCurrency} tone="neutral" />
                <SummaryRow label="− Variable"    value={stats.variable} baseCurrency={baseCurrency} tone="neutral" />
                <SummaryRow label="= Net"         value={stats.net}      baseCurrency={baseCurrency} tone={isPositive ? 'positive' : 'negative'} bold />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function KpiTile({ label, value, icon, bg, border, text, sub }: { label: string; value: string; icon: React.ReactNode; bg: string; border: string; text: string; sub?: string }) {
  return (
    <div className="rounded-[2rem] p-6 border-2 shadow-sm" style={{ background: bg, borderColor: border }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-display font-bold uppercase tracking-widest" style={{ color: text }}>{label}</span>
        <div className="w-9 h-9 rounded-xl bg-white/60 flex items-center justify-center" style={{ color: text }}>{icon}</div>
      </div>
      <div className="text-3xl md:text-4xl font-display font-black tabular-nums leading-none" style={{ color: text }}>
        {value}
      </div>
      {sub && <div className="mt-2 text-xs font-medium" style={{ color: text, opacity: 0.75 }}>{sub}</div>}
    </div>
  );
}

function BreakdownCard({
  title, accent, bg, total, baseCurrency, rows, empty,
}: {
  title: string; accent: string; bg: string; total: number; baseCurrency: string;
  rows: { name: string; amount: number }[]; empty: string;
}) {
  return (
    <div className="bg-white rounded-[2rem] p-6 border-2 border-slate-100 shadow-sm">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-lg font-display font-bold text-slate-900">{title}</h3>
        <div className="text-sm font-display font-bold tabular-nums px-3 py-1 rounded-full" style={{ background: bg, color: accent }}>
          {formatCurrency(total, baseCurrency)}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-6 text-center">{empty}</div>
      ) : (
        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
          {rows.slice(0, 25).map((r, i) => {
            const pct = total > 0 ? (r.amount / total) * 100 : 0;
            return (
              <div key={`${r.name}-${i}`} className="rounded-xl px-3 py-2.5" style={{ background: `${bg}80` }}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700 truncate pr-2">{r.name}</span>
                  <span className="font-display font-bold tabular-nums text-slate-900">{formatCurrency(r.amount, baseCurrency)}</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-white/70 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: accent }} />
                </div>
              </div>
            );
          })}
          {rows.length > 25 && (
            <div className="text-xs text-slate-400 text-center pt-1">+{rows.length - 25} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, baseCurrency, tone, bold }: { label: string; value: number; baseCurrency: string; tone: 'positive' | 'negative' | 'neutral'; bold?: boolean }) {
  const color = tone === 'positive' ? '#166534' : tone === 'negative' ? '#7A0F1F' : '#334155';
  return (
    <div>
      <div className="text-[10px] font-display font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div
        className={`mt-1 font-display tabular-nums ${bold ? 'text-2xl font-black' : 'text-lg font-bold'}`}
        style={{ color }}
      >
        {value >= 0 && tone === 'positive' ? '+' : ''}{formatCurrency(value, baseCurrency)}
      </div>
    </div>
  );
}
