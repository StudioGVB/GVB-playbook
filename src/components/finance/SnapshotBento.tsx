import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { startOfMonth, endOfMonth, differenceInDays, format } from 'date-fns';
import { Calendar, DollarSign, Scale, Receipt, Wallet } from 'lucide-react';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';

const gbp = (n: number) => formatCurrency(n, 'GBP');

type Props = {
  assumptions: any;
  snapshot: any;
  takeHome: {
    gross: number; incomeTax: number; nationalInsurance: number;
    studentLoan: number; pension: number; netMonthly: number;
    netWeekly: number; netAnnual: number; effectiveTaxRate: number;
  };
  transactions: any[];
  categories: any[];
  committedBills: number; // GBP monthly committed
  totalMonthlyIncome: number;
  receivedIncomeSources: Array<{ label: string; total: number }>;
};

export default function SnapshotBento({
  assumptions, snapshot, takeHome, transactions, categories, committedBills, totalMonthlyIncome, receivedIncomeSources,
}: Props) {
  const now = new Date();
  const mStart = startOfMonth(now);
  const mEnd = endOfMonth(now);
  const daysInMonth = differenceInDays(mEnd, mStart) + 1;
  const daysElapsed = Math.min(daysInMonth, differenceInDays(now, mStart) + 1);
  const monthProgress = daysElapsed / daysInMonth;

  const monthTx = useMemo(
    () => transactions.filter(t => {
      const d = new Date(t.posted_at);
      return d >= mStart && d <= mEnd && !t.is_transfer;
    }),
    [transactions, mStart, mEnd],
  );

  const essentialCatIds = useMemo(
    () => new Set(categories.filter(c => c.is_essential && c.type === 'variable').map(c => c.id)),
    [categories],
  );
  const catType = useMemo(
    () => new Map(categories.map(c => [c.id, c.type])),
    [categories],
  );

  const monthSpend = useMemo(() => {
    let bills = 0, essentials = 0, fun = 0;
    for (const t of monthTx) {
      if (t.amount >= 0) continue;
      const gbpAmt = Math.abs(baseAmt(t as any));
      if (t.fixed_expense_id) { bills += gbpAmt; continue; }
      const type = catType.get(t.category_id || '');
      if (essentialCatIds.has(t.category_id || '')) { essentials += gbpAmt; continue; }
      if (type === 'fixed') { bills += gbpAmt; continue; }
      fun += gbpAmt;
    }
    return { bills, essentials, fun, total: bills + essentials + fun };
  }, [monthTx, essentialCatIds, catType]);

  const netMonth = totalMonthlyIncome > 0 ? totalMonthlyIncome : takeHome.netMonthly;
  const netWeekly = totalMonthlyIncome > 0 ? (totalMonthlyIncome * 12) / 52 : takeHome.netWeekly;
  const netAnnual = totalMonthlyIncome > 0 ? totalMonthlyIncome * 12 : takeHome.netAnnual;

  const leftoverAfterBills = netMonth - committedBills;
  const variableSpendSoFar = monthSpend.essentials + monthSpend.fun;
  const projectedVariable = monthProgress > 0 ? variableSpendSoFar / monthProgress : 0;
  const projectedMonthEnd = netMonth - committedBills - projectedVariable;

  const essentialAvgMonthly = snapshot?.computedEssentialVariable || 0;
  const funCapMonthly = (assumptions?.weekly_fun_budget || 100) * 4.33;
  const savingsCapacity = netMonth - committedBills - essentialAvgMonthly - funCapMonthly;
  const savingsRate = netMonth > 0 ? savingsCapacity / netMonth : 0;

  const segments = [
    { label: 'Bills', value: committedBills, color: 'bg-rose-500' },
    { label: 'Essentials', value: essentialAvgMonthly, color: 'bg-violet-500' },
    { label: 'Fun', value: funCapMonthly, color: 'bg-emerald-500' },
    { label: 'Surplus', value: Math.max(0, savingsCapacity), color: 'bg-sky-500' },
  ];
  const segTotal = segments.reduce((s, x) => s + x.value, 0) || 1;

  const remainingFun = snapshot?.remainingWeeklyFun ?? 0;
  const dayOfWeek = now.getDay();
  const daysLeftInWeek = ((7 - (dayOfWeek === 0 ? 7 : dayOfWeek)) % 7) + (dayOfWeek === 0 ? 0 : 1);

  const expectedByNow = (committedBills + essentialAvgMonthly + funCapMonthly) * monthProgress;
  const actualByNow = monthSpend.total;
  const paceDiff = actualByNow - expectedByNow;

  const runwayWeeks = snapshot?.runwayWeeks ?? 0;
  const runwayMonths = runwayWeeks / 4.33;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 auto-rows-[minmax(120px,auto)] gap-4">
      {/* HERO: paycheck */}
      <div className="md:col-span-8 md:row-span-2 bg-card rounded-3xl p-8 border shadow-xl shadow-slate-200/50 flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {totalMonthlyIncome > 0 ? 'Monthly Income' : 'Monthly take-home'}
            </span>
            {takeHome.gross > 0 && takeHome.effectiveTaxRate > 0 && (
              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100">
                {(takeHome.effectiveTaxRate * 100).toFixed(1)}% effective
              </span>
            )}
          </div>
          <div className="mt-4 flex items-baseline gap-2 flex-wrap">
            <span className="text-5xl font-black tracking-tighter">{gbp(netMonth)}</span>
            <span className="text-emerald-600 font-bold text-lg">
              {totalMonthlyIncome > 0 ? 'income this month' : 'take-home'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {gbp(netWeekly)}/wk · {gbp(netAnnual)}/yr
          </div>
        </div>
        {takeHome.gross > 0 ? (
          <div className="grid grid-cols-3 gap-4 mt-8 pt-6 border-t">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gross</p>
              <p className="text-xl font-bold">{gbp(takeHome.gross)}</p>
              {takeHome.pension > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">− {gbp(takeHome.pension)} pension</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-rose-500/70 uppercase tracking-wider">Tax (PAYE)</p>
              <p className="text-xl font-bold text-rose-600">−{gbp(takeHome.incomeTax)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-rose-500/70 uppercase tracking-wider">Nat. Insurance</p>
              <p className="text-xl font-bold text-rose-600">−{gbp(takeHome.nationalInsurance)}</p>
              {takeHome.studentLoan > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">+ {gbp(takeHome.studentLoan)} student loan</p>
              )}
            </div>
          </div>
        ) : receivedIncomeSources.length > 0 ? (
          <div className="mt-8 pt-6 border-t space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Income Sources This Month</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {receivedIncomeSources.map(source => (
                <div key={source.label} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-xs text-muted-foreground truncate font-semibold">{source.label}</p>
                  <p className="text-lg font-black text-slate-900 mt-0.5">{gbp(source.total)}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-8 pt-6 border-t text-sm text-slate-500">
            No income logged this month. Use <span className="font-semibold text-slate-700">Salary settings</span> above to configure pre-tax PAYE projections.
          </div>
        )}
      </div>

      {/* Payday countdown */}
      <div className="md:col-span-4 md:row-span-1 bg-purple-600 rounded-3xl p-6 text-white flex flex-col justify-between overflow-hidden relative">
        <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-500 rounded-full blur-2xl pointer-events-none" />
        <span className="text-xs font-bold uppercase tracking-widest text-purple-200 relative">
          {assumptions.income_start_date && new Date(assumptions.income_start_date) > now
            ? 'First paycheck' : 'Payday countdown'}
        </span>
        <div className="flex items-end gap-2 relative">
          <span className="text-6xl font-black leading-none">
            {assumptions.income_start_date
              ? Math.max(0, differenceInDays(new Date(assumptions.income_start_date), now))
              : Math.max(0, daysInMonth - daysElapsed)}
          </span>
          <span className="text-lg font-medium pb-1">days</span>
        </div>
        <div className="text-xs text-purple-100 relative">
          {assumptions.income_start_date && new Date(assumptions.income_start_date) > now
            ? `Lands ${format(new Date(assumptions.income_start_date), 'MMM d')}`
            : 'Until end of month'}
        </div>
      </div>

      {/* Weekly safe to spend */}
      <div className="md:col-span-4 md:row-span-1 bg-card rounded-3xl p-6 border shadow-sm flex flex-col justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Weekly safe to spend</span>
        <div>
          <p className={`text-3xl font-black ${remainingFun < 0 ? 'text-rose-600' : ''}`}>{gbp(remainingFun)}</p>
          <div className="w-full bg-muted h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className={`${remainingFun < 0 ? 'bg-rose-500' : 'bg-pink-500'} h-full`}
              style={{
                width: `${Math.min(100, Math.max(0, ((snapshot?.baseWeeklyFun ?? 0) > 0
                  ? (remainingFun / (snapshot?.baseWeeklyFun ?? 1)) * 100 : 0)))}%`
              }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5">
            {daysLeftInWeek}d left · base {gbp(snapshot?.baseWeeklyFun ?? 0)}
          </div>
        </div>
      </div>

      {/* Waterfall */}
      <div className="md:col-span-7 md:row-span-1 bg-card rounded-3xl p-6 border shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Allocation waterfall</span>
          <span className={`text-xs font-bold ${projectedMonthEnd >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            Projected end: {gbp(projectedMonthEnd)}
          </span>
        </div>
        <div className="flex h-8 w-full rounded-xl overflow-hidden shadow-inner bg-muted/40">
          {segments.map(s => {
            const pct = (s.value / segTotal) * 100;
            if (pct < 0.5) return null;
            return (
              <div key={s.label} className={`${s.color} flex items-center justify-center text-[10px] text-white font-bold overflow-hidden`}
                style={{ width: `${pct}%` }} title={`${s.label} ${gbp(s.value)}`}>
                {pct > 8 ? s.label : ''}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-3 px-1 text-[10px] font-medium text-muted-foreground">
          <span>Committed bills: {gbp(committedBills)}</span>
          <span>After bills: {gbp(leftoverAfterBills)}</span>
        </div>
      </div>

      {/* Pace ring */}
      <div className="md:col-span-2 md:row-span-1 bg-card rounded-3xl p-4 border shadow-sm flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Monthly pace</span>
        {(() => {
          const budgetTotal = committedBills + essentialAvgMonthly + funCapMonthly || 1;
          const pctSpent = Math.min(150, (actualByNow / budgetTotal) * 100);
          const pctExpected = monthProgress * 100;
          const onTrack = pctSpent <= pctExpected + 5;
          const R = 28, C = 2 * Math.PI * R;
          const offset = C - (Math.min(100, pctSpent) / 100) * C;
          return (
            <>
              <div className="relative w-16 h-16 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
                  <circle cx="32" cy="32" r={R} fill="none"
                    stroke={onTrack ? '#10b981' : '#f43f5e'} strokeWidth="6"
                    strokeDasharray={C} strokeDashoffset={offset} strokeLinecap="round" />
                </svg>
                <span className="absolute text-xs font-black">{Math.round(pctSpent)}%</span>
              </div>
              <span className={`text-[10px] font-bold mt-1 ${onTrack ? 'text-emerald-600' : 'text-rose-600'}`}>
                {onTrack ? 'On track' : `Over ${gbp(Math.abs(paceDiff))}`}
              </span>
            </>
          );
        })()}
      </div>

      {/* Quick-nav */}
      <div className="md:col-span-3 md:row-span-1 bg-slate-900 rounded-3xl p-3 flex flex-wrap gap-2 items-center justify-center">
        {[
          { to: '/finance/monthly', icon: Calendar, label: 'Monthly' },
          { to: '/finance/income', icon: DollarSign, label: 'Income' },
          { to: '/finance/balance-sheet', icon: Scale, label: 'Balance' },
          { to: '/finance/accounts', icon: Receipt, label: 'Living' },
          { to: '/finance/pools', icon: Wallet, label: 'Pools' },
        ].map(l => (
          <Link key={l.to} to={l.to} title={l.label}
            className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
            <l.icon className="w-5 h-5" />
          </Link>
        ))}
      </div>

      {/* Foundations */}
      <div className="md:col-span-4 bg-card rounded-3xl p-6 border shadow-sm">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Runway</p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black">
            {Math.floor(runwayMonths)}mo {Math.round((runwayMonths % 1) * 4.33)}wk
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Cash covers current burn</p>
      </div>
      <div className="md:col-span-4 bg-card rounded-3xl p-6 border shadow-sm">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Emergency floor</p>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-3xl font-black">{gbp(snapshot?.emergencyFloor ?? 0)}</span>
          {(snapshot?.totalLiquidCash ?? 0) >= (snapshot?.emergencyFloor ?? 0) && (
            <span className="text-xs font-bold text-emerald-600 px-2 py-0.5 bg-emerald-50 rounded">Safe</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {assumptions.buffer_months}mo × {gbp(snapshot?.emergencySurvivalMonthly ?? 0)}/mo × 1.2
        </p>
      </div>
      <div className="md:col-span-4 bg-card rounded-3xl p-6 border shadow-sm">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Savings capacity</p>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-3xl font-black ${savingsCapacity >= 0 ? '' : 'text-rose-600'}`}>
            {gbp(savingsCapacity)}
          </span>
          <span className="text-sm font-bold text-purple-600">{(savingsRate * 100).toFixed(0)}% of net</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Net − bills − essentials − fun</p>
      </div>
    </div>
  );
}
