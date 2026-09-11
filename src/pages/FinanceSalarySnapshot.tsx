import { useMemo, useState, useEffect, useRef } from 'react';
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns';
import { Edit3, ArrowDown, Plus, Minus, Equal, Sparkles, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useFinanceData, type FinanceGoal } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { calcTakeHome, STUDENT_LOAN_LABELS, StudentLoanPlan } from '@/lib/ukTakeHome';
import { formatCurrency, baseAmt, isExcludedSpendDate } from '@/lib/financeUtils';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import WhatIfSimulator from '@/components/finance/WhatIfSimulator';
import SnapshotBento from '@/components/finance/SnapshotBento';
import AllocationSlider from '@/components/finance/AllocationSlider';
import TaxModelTab from '@/components/finance/TaxModelTab';

const gbp = (n: number) =>
  formatCurrency(Math.round(n * 100) / 100, 'GBP');

// Convert any frequency to monthly cost
function toMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly': return amount * 4.33;
    case 'fortnightly': return amount * 2.17;
    case 'yearly': return amount / 12;
    default: return amount; // monthly / one-off
  }
}

export default function FinanceSalarySnapshot() {
  const finance = useFinanceData();
  const { assumptions, update } = useFinanceAssumptions();
  const {
    activeExpenses: fixedExpenses,
    monthlyTotalInternal: fixedInternal,
    monthlyTotal: fixedAll,
    reimbursementsOn,
  } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap } = useWeekTypes();
  const { trips } = useFinanceTrips();

  const [editOpen, setEditOpen] = useState(false);
  const [gross, setGross] = useState('');
  const [pension, setPension] = useState('');
  const [slPlan, setSlPlan] = useState<StudentLoanPlan>(null);
  const [alloc, setAlloc] = useState<{ goalId: string; pct: number; amount: number }[]>([]);

  const openEdit = () => {
    setGross(String(assumptions?.gross_annual_salary || 37000));
    setPension(String(assumptions?.pension_percent || 0));
    setSlPlan((assumptions?.student_loan_plan as StudentLoanPlan) || null);
    setEditOpen(true);
  };

  const saveSalary = async () => {
    await update({
      gross_annual_salary: Number(gross) || 0,
      pension_percent: Number(pension) || 0,
      student_loan_plan: slPlan,
    } as any);
    setEditOpen(false);
  };

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions, finance.categories,
      finance.goals, finance.convertToBase, fixedInternal, totalBoostThisWeek,
      weekTypeMap(), trips, fixedAll,
    );
  }, [assumptions, finance, fixedInternal, fixedAll, totalBoostThisWeek, weekTypeMap, trips]);

  const takeHome = useMemo(() => calcTakeHome({
    grossAnnual: assumptions?.gross_annual_salary || 0,
    pensionPercent: assumptions?.pension_percent || 0,
    studentLoanPlan: (assumptions?.student_loan_plan as StudentLoanPlan) || null,
  }), [assumptions]);

  // ---------- INCOME: this month's actual received + reimbursements ----------
  // Salary projection only kicks in once the job start date has passed.
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const monthLabel = format(monthStart, 'MMMM');
  const jobStart = assumptions?.income_start_date ? new Date(assumptions.income_start_date) : null;
  const salaryActive = !jobStart || jobStart <= monthEnd;
  const salaryLandsThisMonth = jobStart && jobStart >= monthStart && jobStart <= monthEnd;

  const receivedIncomeSources = useMemo(() => {
    const byCat = new Map<string, { label: string; total: number }>();
    for (const t of finance.transactions) {
      if (t.amount <= 0) continue;
      if (t.is_transfer) continue;
      if ((t as any).is_refund) continue;
      const d = new Date(t.posted_at);
      if (d < monthStart || d > monthEnd) continue;
      const cat = finance.categories.find(c => c.id === t.category_id);
      const key = cat?.id || '__uncat';
      const label = cat?.name || 'Uncategorised income';
      // Skip income categories that are excluded from reports
      if (cat?.exclude_from_reports) continue;
      const gbpAmt = Math.abs(baseAmt(t as any));
      const cur = byCat.get(key) || { label, total: 0 };
      cur.total += gbpAmt;
      byCat.set(key, cur);
    }
    return Array.from(byCat.values())
      .filter(v => v.total > 0.5)
      .sort((a, b) => b.total - a.total);
  }, [finance.transactions, finance.categories, monthStart, monthEnd]);

  const receivedIncomeTotal = receivedIncomeSources.reduce((s, x) => s + x.total, 0);

  // Reimbursements from bills paid externally (e.g. rent from Commbank) for this month.
  const reimbursements = useMemo(() => {
    return reimbursementsOn(format(monthStart, 'yyyy-MM-dd'));
  }, [reimbursementsOn, monthStart]);
  const reimbursementsTotal = reimbursements.reduce((s, r) => s + r.amount, 0);

  // If the job start date has already passed but no salary has landed yet this month,
  // add the projected take-home as an "expected" line so the flow still balances.
  const salaryStartedButNotLanded =
    jobStart != null && jobStart <= now && receivedIncomeTotal < takeHome.netMonthly * 0.5;
  const projectedSalary = salaryStartedButNotLanded ? takeHome.netMonthly : 0;

  const totalMonthlyIncome = receivedIncomeTotal + reimbursementsTotal + projectedSalary;

  // ---------- FIXED BILLS: prep the list ----------
  const fixedBillRows = useMemo(() => {
    return fixedExpenses
      .map(e => ({
        id: e.id,
        name: e.name,
        frequency: e.frequency,
        native: e.amount,
        currency: e.currency,
        monthly: toMonthly(
          finance.convertToBase(e.amount, e.currency),
          e.frequency,
        ),
        auto: e.auto_pay,
        external: e.paid_externally,
        due: e.due_day,
      }))
      .sort((a, b) => b.monthly - a.monthly);
  }, [fixedExpenses, finance.convertToBase]);

  const fixedBillsMonthly = fixedBillRows.reduce((s, x) => s + x.monthly, 0);
  const afterFixed = totalMonthlyIncome - fixedBillsMonthly;

  // ---------- VARIABLE ----------
  const essentialsMonthly = snapshot?.computedEssentialVariable ?? assumptions?.estimated_essential_variable ?? 0;
  const funMonthly = (assumptions?.weekly_fun_budget || 100) * 4.33;
  const variableMonthly = essentialsMonthly + funMonthly;
  const surplus = afterFixed - variableMonthly;

  // ---------- SAVINGS ALLOCATION ----------
  const goalRows = useMemo(() => {
    const visible = finance.goals.filter(g => !(g as any).is_stash);
    const totalPct = visible.reduce((s, g) => s + (g.percent_allocation || 0), 0);
    return visible
      .map(g => {
        const assignedGbp = finance.convertToBase(g.assigned_amount || 0, g.currency);
        const targetGbp = finance.convertToBase(g.target_amount || 0, g.currency);
        // If percentages are set, use them proportionally; otherwise split evenly.
        const share = totalPct > 0
          ? (g.percent_allocation || 0) / totalPct
          : 1 / Math.max(1, visible.length);
        const monthly = Math.max(0, surplus) * share;
        const remaining = Math.max(0, targetGbp - assignedGbp);
        const eta = monthly > 0 && remaining > 0 ? Math.ceil(remaining / monthly) : null;
        // Heuristic: strict safety mode OR priority 1 => non-negotiable
        const nonNeg = g.safety_mode === 'strict' || g.priority === 1;
        return {
          id: g.id, name: g.name, color: g.color,
          assigned: assignedGbp, target: targetGbp,
          pct: Math.round(share * 100),
          monthly, remaining, eta,
          nonNeg,
        };
      })
      .sort((a, b) => (Number(b.nonNeg) - Number(a.nonNeg)) || b.monthly - a.monthly);
  }, [finance.goals, finance.convertToBase, surplus]);

  const nonNegRows = goalRows.filter(g => g.nonNeg);
  const funRows = goalRows.filter(g => !g.nonNeg);
  const nonNegMonthly = nonNegRows.reduce((s, x) => s + x.monthly, 0);
  const funGoalsMonthly = funRows.reduce((s, x) => s + x.monthly, 0);
  const unallocated = Math.max(0, surplus) - nonNegMonthly - funGoalsMonthly;

  if (!assumptions || finance.loading) {
    return <div className="p-6 text-muted-foreground animate-pulse">Loading breakdown...</div>;
  }

  // ----- What-if baseline -----
  const rentExpense = fixedExpenses.reduce<any>((best, e) => {
    const amtMo = toMonthly(e.amount, e.frequency);
    if (!best || amtMo > best.amtMo) return { ...e, amtMo };
    return best;
  }, null);
  const baselineRent = rentExpense?.amtMo || 0;
  const baseline = {
    grossAnnual: assumptions.gross_annual_salary || 37000,
    pensionPercent: assumptions.pension_percent || 0,
    studentLoanPlan: (assumptions.student_loan_plan as StudentLoanPlan) || null,
    rentMonthly: Math.round(baselineRent),
    otherBillsMonthly: Math.round(Math.max(0, fixedAll - baselineRent)),
    weeklyFun: assumptions.weekly_fun_budget || 100,
    weeklyEssentials: Math.round(essentialsMonthly / 4.33),
    savingsTarget: 5000,
    bigPurchase: 1000,
    sideIncomeMonthly: Math.round(receivedIncomeTotal + reimbursementsTotal),
    liquidCash: snapshot?.totalLiquidCash ?? 0,
    emergencyFloor: snapshot?.emergencyFloor ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Money Flow</h1>
          <p className="text-sm text-muted-foreground">
            Every pound, from paycheck to savings.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={openEdit}>
          <Edit3 className="w-4 h-4 mr-2" /> Salary settings
        </Button>
      </div>

      <Tabs defaultValue="snapshot" className="space-y-6">
        <TabsList>
          <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
          <TabsTrigger value="tax">Tax Model</TabsTrigger>
          <TabsTrigger value="flow">Breakdown</TabsTrigger>
          <TabsTrigger value="whatif">What-if</TabsTrigger>
        </TabsList>

        <TabsContent value="snapshot">
          <SnapshotBento
            assumptions={assumptions}
            snapshot={snapshot}
            takeHome={takeHome}
            transactions={finance.transactions}
            categories={finance.categories}
            committedBills={fixedAll}
            totalMonthlyIncome={totalMonthlyIncome}
            receivedIncomeSources={receivedIncomeSources}
          />
        </TabsContent>

        <TabsContent value="tax">
          <TaxModelTab takeHome={takeHome} assumptions={assumptions} />
        </TabsContent>

        <TabsContent value="flow" className="space-y-4">
          {/* Waterfall hero */}
          <WaterfallHero
            income={totalMonthlyIncome}
            bills={fixedBillsMonthly}
            essentials={essentialsMonthly}
            fun={funMonthly}
            surplus={surplus}
            monthLabel={monthLabel}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FlowCard
              step="1"
              symbol={<Plus className="w-4 h-4" />}
              title={`${monthLabel} income in`}
              tone="income"
              totalLabel="Received + expected"
              total={totalMonthlyIncome}
            >
              {receivedIncomeSources.length === 0 && projectedSalary === 0 && (
                <Row label="No income received yet this month" value={0} muted />
              )}
              {receivedIncomeSources.map(s => (
                <Row
                  key={s.label}
                  label={s.label}
                  sub={`Actual received in ${monthLabel}`}
                  value={s.total}
                />
              ))}
              {projectedSalary > 0 && (
                <Row
                  label="New salary (projected)"
                  sub={`Net ${gbp(takeHome.netMonthly)} · not yet landed`}
                  value={projectedSalary}
                  muted
                />
              )}
              {reimbursements.map(r => (
                <Row
                  key={r.id}
                  label={`${r.name} reimbursement`}
                  sub="Paid outside — offsets the fixed bill"
                  value={r.amount}
                />
              ))}
              {!salaryActive && jobStart && (
                <div className="mx-2 mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
                  New salary starts {format(jobStart, 'MMM d, yyyy')}.
                </div>
              )}
            </FlowCard>

            <FlowCard
              step="2"
              symbol={<Minus className="w-4 h-4" />}
              title="Fixed bills out"
              tone="bills"
              totalLabel="Committed monthly"
              total={fixedBillsMonthly}
              negative
            >
              {fixedBillRows.length === 0 && (
                <Row label="No fixed bills set up" value={0} muted />
              )}
              {fixedBillRows.map(b => (
                <Row
                  key={b.id}
                  label={b.name}
                  sub={`${b.frequency}${b.due ? ` · day ${b.due}` : ''}${b.external ? ' · external' : ''}${b.auto ? ' · auto' : ''}`}
                  value={-b.monthly}
                  negative
                />
              ))}
            </FlowCard>
          </div>

          <SubtotalBar
            label="Left after fixed bills"
            value={afterFixed}
            of={totalMonthlyIncome}
          />

          <FlowCard
            step="3"
            symbol={<Minus className="w-4 h-4" />}
            title="Variable spending"
            tone="variable"
            totalLabel="Monthly total"
            total={variableMonthly}
            negative
          >
            <Row
              label="Essentials (groceries, transport, etc.)"
              sub={`Rolling avg · ${gbp(essentialsMonthly / 4.33)}/wk`}
              value={-essentialsMonthly}
              negative
            />
            <Row
              label="Fun money"
              sub={`Weekly cap · ${gbp(assumptions.weekly_fun_budget || 100)}/wk`}
              value={-funMonthly}
              negative
            />
          </FlowCard>

          <SubtotalBar
            label="Free to save"
            value={surplus}
            of={totalMonthlyIncome}
            emphasise
          />

          <FlowCard
            step="4"
            symbol={<Equal className="w-4 h-4" />}
            title="Savings allocation"
            tone="savings"
            totalLabel="Distributed to goals"
            total={alloc.reduce((s, a) => s + a.amount, 0)}
          >
            {surplus <= 0 ? (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 font-medium">
                No surplus to allocate — bills + variable exceed income by {gbp(Math.abs(surplus))}/mo.
              </div>
            ) : (
              <div className="px-2">
                <div className="text-[11px] text-muted-foreground mb-1">
                  Drag the dots to split {gbp(surplus)}/mo across your pools. Emergency is locked at exactly 20%.
                </div>
                <AllocationSlider
                  amount={surplus}
                  goals={finance.goals}
                  convertToBase={finance.convertToBase}
                  emergencyMinPct={20}
                  onChange={setAlloc}
                />
                <div className="text-[11px] text-muted-foreground mt-3">
                  This is a live preview. Commit the actual leftover in <span className="font-semibold text-foreground">Money Pools → Allocate leftover</span> once payday lands.
                </div>
              </div>
            )}
          </FlowCard>

          {/* Final ledger — light card matching bento aesthetic */}
          <div className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Monthly ledger
                </div>
                <div className="text-sm font-bold">{monthLabel} at a glance</div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm font-mono">
              <LedgerLine label="Income" value={totalMonthlyIncome} positive />
              <LedgerLine label="Fixed bills" value={-fixedBillsMonthly} />
              <LedgerLine label="Essentials" value={-essentialsMonthly} />
              <LedgerLine label="Fun money" value={-funMonthly} />
            </div>
            <div className="h-px bg-border my-4" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SummaryPill label="Free cash" value={surplus} tone={surplus >= 0 ? 'good' : 'bad'} />
              <SummaryPill label="Allocated" value={-alloc.reduce((s, a) => s + a.amount, 0)} tone="neutral" />
              <SummaryPill label="Spillover" value={Math.max(0, surplus - alloc.reduce((s, a) => s + a.amount, 0))} tone="accent" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="whatif">
          <WhatIfSimulator
            baseline={baseline}
            currentSavingsPerMonth={(snapshot?.availableSavings ?? 0)}
            currentRunwayWeeks={snapshot?.runwayWeeks ?? 0}
          />
        </TabsContent>
      </Tabs>

      {/* Salary edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salary settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Gross annual salary (£)</Label>
              <Input type="number" value={gross} onChange={e => setGross(e.target.value)} />
            </div>
            <div>
              <Label>Pension contribution (%)</Label>
              <Input type="number" value={pension} onChange={e => setPension(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Salary-sacrifice / pre-tax contribution.</p>
            </div>
            <div>
              <Label>Student loan plan</Label>
              <Select value={slPlan ?? 'none'} onValueChange={(v) => setSlPlan(v === 'none' ? null : (v as StudentLoanPlan))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {Object.entries(STUDENT_LOAN_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveSalary}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============== presentational bits ============== */

const TONE = {
  income:   { chip: 'bg-emerald-100 text-emerald-700',  ring: 'border-emerald-100', total: 'text-emerald-700', icon: 'bg-emerald-500'  },
  bills:    { chip: 'bg-rose-100 text-rose-700',        ring: 'border-rose-100',    total: 'text-rose-700',    icon: 'bg-rose-500'     },
  variable: { chip: 'bg-violet-100 text-violet-700',    ring: 'border-violet-100',  total: 'text-violet-700',  icon: 'bg-violet-500'   },
  savings:  { chip: 'bg-sky-100 text-sky-700',          ring: 'border-sky-100',     total: 'text-sky-700',     icon: 'bg-sky-500'      },
} as const;

function WaterfallHero({
  income, bills, essentials, fun, surplus, monthLabel,
}: { income: number; bills: number; essentials: number; fun: number; surplus: number; monthLabel: string }) {
  const denom = Math.max(income, 1);
  const segs = [
    { label: 'Bills',      value: bills,      color: 'bg-rose-500'    },
    { label: 'Essentials', value: essentials, color: 'bg-violet-500'  },
    { label: 'Fun',        value: fun,        color: 'bg-emerald-500' },
    { label: 'Free',       value: Math.max(0, surplus), color: 'bg-sky-500' },
  ];
  return (
    <div className="rounded-3xl border bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {monthLabel} · Money flow
          </div>
          <div className="text-3xl font-black tracking-tight mt-1">{gbp(income)}</div>
          <div className="text-xs text-muted-foreground">in, distributed across…</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Free to save
          </div>
          <div className={`text-3xl font-black tracking-tight mt-1 ${surplus >= 0 ? 'text-sky-600' : 'text-rose-600'}`}>
            {surplus < 0 ? '−' : ''}{gbp(Math.abs(surplus))}
          </div>
          <div className="text-xs text-muted-foreground">{denom > 0 ? Math.round((surplus / denom) * 100) : 0}% of income</div>
        </div>
      </div>
      <div className="flex w-full h-3 rounded-full overflow-hidden bg-muted">
        {segs.map(s => (
          <div key={s.label} className={s.color} style={{ width: `${Math.max(0, (s.value / denom) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {segs.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className="text-sm font-black tabular-nums">{gbp(s.value)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowCard({
  step, symbol, title, tone, totalLabel, total, negative, children,
}: {
  step: string;
  symbol: React.ReactNode;
  title: string;
  tone: keyof typeof TONE;
  totalLabel: string;
  total: number;
  negative?: boolean;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={`rounded-3xl border bg-card shadow-sm overflow-hidden`}>
      <div className={`flex items-center justify-between px-5 py-4 border-b ${t.ring}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-2xl ${t.icon} text-white flex items-center justify-center shadow-sm`}>
            {symbol}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Step {step}</div>
            <h2 className="font-bold text-base leading-tight">{title}</h2>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{totalLabel}</div>
          <div className={`text-xl font-black tabular-nums ${t.total}`}>
            {negative ? '−' : ''}{formatCurrency(Math.round(total), 'GBP')}
          </div>
        </div>
      </div>
      <div className="p-3 space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label, sub, value, negative, muted,
}: { label: string; sub?: string; value: number; negative?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-3 py-2 rounded-xl hover:bg-muted/40 ${muted ? 'opacity-70' : ''}`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
      </div>
      <div className={`text-sm font-mono font-bold tabular-nums whitespace-nowrap ${negative ? 'text-rose-600' : ''}`}>
        {value === 0 ? '—' : (negative ? '−' : '') + formatCurrency(Math.abs(Math.round(value * 100) / 100), 'GBP')}
      </div>
    </div>
  );
}

function SubtotalBar({
  label, value, of, emphasise,
}: { label: string; value: number; of: number; emphasise?: boolean }) {
  const pct = of > 0 ? Math.max(0, Math.min(100, (value / of) * 100)) : 0;
  const good = value >= 0;
  return (
    <div className={`rounded-2xl px-5 py-4 shadow-sm ${emphasise ? 'bg-gradient-to-br from-slate-900 to-slate-800 text-white' : 'bg-muted/50 border'}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">= {label}</div>
        <div className={`text-2xl font-black tabular-nums ${good ? (emphasise ? 'text-emerald-300' : '') : 'text-rose-500'}`}>
          {formatCurrency(Math.round(value), 'GBP')}
        </div>
      </div>
      <div className={`w-full h-1.5 rounded-full mt-2 ${emphasise ? 'bg-white/10' : 'bg-background'}`}>
        <div
          className={good ? (emphasise ? 'bg-emerald-400' : 'bg-emerald-500') : 'bg-rose-500'}
          style={{ width: `${pct}%`, height: '100%', borderRadius: 999 }}
        />
      </div>
      <div className="text-[10px] opacity-60 mt-1">{pct.toFixed(0)}% of income</div>
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1">
      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

function GoalRow({ g }: {
  g: {
    id: string; name: string; color?: string | null;
    assigned: number; target: number; pct: number;
    monthly: number; remaining: number; eta: number | null;
  }
}) {
  const progress = g.target > 0 ? Math.min(100, (g.assigned / g.target) * 100) : 0;
  return (
    <div className="grid grid-cols-12 gap-3 items-center px-3 py-2 rounded-xl hover:bg-muted/40">
      <div className="col-span-5 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: g.color || '#94A3B8' }} />
          <span className="text-sm font-semibold truncate">{g.name}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {formatCurrency(Math.round(g.assigned), 'GBP')} / {formatCurrency(Math.round(g.target), 'GBP')} · {g.pct}%
        </div>
        <div className="w-full h-1 bg-muted rounded-full mt-1">
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: g.color || '#0EA5E9' }} />
        </div>
      </div>
      <div className="col-span-3 text-right">
        <div className="text-[10px] uppercase text-muted-foreground font-semibold">Per month</div>
        <div className="text-sm font-mono font-bold tabular-nums">{formatCurrency(Math.round(g.monthly), 'GBP')}</div>
      </div>
      <div className="col-span-2 text-right">
        <div className="text-[10px] uppercase text-muted-foreground font-semibold">Remaining</div>
        <div className="text-sm font-mono tabular-nums">{formatCurrency(Math.round(g.remaining), 'GBP')}</div>
      </div>
      <div className="col-span-2 text-right">
        <div className="text-[10px] uppercase text-muted-foreground font-semibold">ETA</div>
        <div className="text-sm font-mono tabular-nums">
          {g.eta === null ? '—' : g.eta > 120 ? '10y+' : `${g.eta} mo`}
        </div>
      </div>
    </div>
  );
}

function LedgerLine({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-bold ${value < 0 ? 'text-rose-600' : positive ? 'text-emerald-600' : ''}`}>
        {value < 0 ? '−' : ''}{formatCurrency(Math.abs(Math.round(value)), 'GBP')}
      </span>
    </div>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: 'good' | 'bad' | 'neutral' | 'accent' }) {
  const styles: Record<string, string> = {
    good:    'bg-emerald-50 border-emerald-200 text-emerald-700',
    bad:     'bg-rose-50 border-rose-200 text-rose-700',
    neutral: 'bg-slate-50 border-slate-200 text-slate-700',
    accent:  'bg-amber-50 border-amber-200 text-amber-700',
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${styles[tone]}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</div>
      <div className="text-lg font-black tabular-nums mt-0.5">
        {value < 0 ? '−' : ''}{formatCurrency(Math.abs(Math.round(value)), 'GBP')}
      </div>
    </div>
  );
}
