import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, DollarSign, Lock, PiggyBank, Scale, ShoppingCart, Sparkles, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';

interface Props {
  income: number;
  fixedBills: number;
  variableAllowance: number;
  essentialBudget?: number;
  funBudget?: number;
  variableSpent?: number;
  poolSavings: number;
  baseCurrency?: string;
  monthLabel?: string;
}

export default function MonthlyCashFlowBreakdown({
  income,
  fixedBills,
  variableAllowance,
  essentialBudget,
  funBudget,
  variableSpent = 0,
  poolSavings,
  baseCurrency = 'AUD',
  monthLabel,
}: Props) {
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Remaining net leftover = Income - Fixed Bills - Variable Allowance - Pool Savings
  const totalOutflows = fixedBills + variableAllowance + poolSavings;
  const netLeftover = income - totalOutflows;
  const isSurplus = netLeftover >= 0;

  // Percentage breakdown relative to income
  const incomeDenom = Math.max(income, totalOutflows, 1);
  const fixedPct = Math.min(100, (fixedBills / incomeDenom) * 100);
  const varPct = Math.min(100, (variableAllowance / incomeDenom) * 100);
  const poolPct = Math.min(100, (poolSavings / incomeDenom) * 100);
  const leftoverPct = Math.min(100, (Math.abs(netLeftover) / incomeDenom) * 100);

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[8px_8px_0px_0px_rgba(255,46,184,0.12)] overflow-hidden font-body">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0FDF4] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#FF2EB8] text-white p-1 rounded-lg">
                <Scale className="w-3.5 h-3.5" />
              </span>
              <span className="text-[#FF2EB8] font-display font-bold uppercase tracking-wider text-xs">
                Monthly Bottom Line {monthLabel ? `• ${monthLabel}` : ''}
              </span>
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900">
              Cash Flow Breakdown
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Super clear equation of where your income goes before you spend a single dollar.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isSurplus ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-display font-black text-sm px-3.5 py-1.5 rounded-2xl gap-1.5 shadow-sm">
                <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                +{fmt(netLeftover)} Surplus Leftover
              </Badge>
            ) : (
              <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-display font-black text-sm px-3.5 py-1.5 rounded-2xl gap-1.5 shadow-sm">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                −{fmt(Math.abs(netLeftover))} Shortfall
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Step-by-Step Waterfall List */}
        <div className="space-y-3">
          {/* 1. Earned Income */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-sky-50/80 border-2 border-sky-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center font-black text-lg shadow-sm">
                +
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-sky-800 tracking-wider block">
                  1. Earned This Month
                </span>
                <span className="text-sm font-semibold text-slate-700">Total Cleared Income</span>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-sky-900 tabular-nums">
              +{fmt(income)}
            </span>
          </div>

          {/* 2. Fixed Bills */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-amber-50/80 border-2 border-amber-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold shadow-sm">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-amber-800 tracking-wider block">
                  2. Fixed Bills
                </span>
                <span className="text-sm font-semibold text-slate-700">Rent, Utilities & Subscriptions</span>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-amber-900 tabular-nums">
              −{fmt(fixedBills)}
            </span>
          </div>

          {/* 3. Variable Allowance */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-purple-50/80 border-2 border-purple-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500 text-white flex items-center justify-center font-bold shadow-sm">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-purple-800 tracking-wider block">
                  3. Variable Allowance
                </span>
                <span className="text-sm font-semibold text-slate-700">
                  {essentialBudget && funBudget ? (
                    <>Essentials ({fmt(essentialBudget)}) + Fun Money ({fmt(funBudget)})</>
                  ) : (
                    <>Essentials + Fun Money</>
                  )}
                  {variableSpent > 0 && (
                    <span className="text-xs text-purple-600 block font-normal">
                      ({fmt(variableSpent)} spent so far this month)
                    </span>
                  )}
                </span>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-purple-900 tabular-nums">
              −{fmt(variableAllowance)}
            </span>
          </div>

          {/* 4. Pool Savings */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-pink-50/80 border-2 border-[#FF7AD1]/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FF2EB8] text-white flex items-center justify-center font-bold shadow-sm">
                <PiggyBank className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-[#FF2EB8] tracking-wider block">
                  4. Savings Pools
                </span>
                <span className="text-sm font-semibold text-slate-700">Committed Money Pool Allocations</span>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-[#FF2EB8] tabular-nums">
              −{fmt(poolSavings)}
            </span>
          </div>

          {/* Equal Divider */}
          <div className="border-t-2 border-dashed border-slate-300 my-4" />

          {/* 5. What's Leftover Result */}
          <div
            className={`flex items-center justify-between p-5 rounded-2xl border-2 ${
              isSurplus
                ? 'bg-[#86EFAC]/30 border-[#22C55E] text-[#166534]'
                : 'bg-rose-100/50 border-rose-400 text-rose-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-md ${
                  isSurplus ? 'bg-[#22C55E]' : 'bg-rose-600'
                }`}
              >
                =
              </div>
              <div>
                <span className="text-xs font-display font-extrabold uppercase tracking-widest block">
                  5. WHAT'S LEFTOVER
                </span>
                <span className="text-sm font-bold">
                  {isSurplus ? 'Unallocated Net Surplus Buffer' : 'Uncovered Shortfall'}
                </span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-3xl sm:text-4xl font-display font-black tabular-nums block">
                {isSurplus ? `+${fmt(netLeftover)}` : `−${fmt(Math.abs(netLeftover))}`}
              </span>
              <span className="text-xs font-semibold opacity-80">
                {isSurplus ? 'Safe uncommitted cash balance' : 'Exceeds monthly income!'}
              </span>
            </div>
          </div>
        </div>

        {/* Visual Stacked Flow Bar */}
        <div>
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
            <span>Income Allocation Map</span>
            <span>{income > 0 ? '100% of Monthly Income' : ''}</span>
          </div>

          <div className="h-4 rounded-full bg-slate-100 overflow-hidden flex shadow-inner border border-slate-200">
            {fixedPct > 0 && (
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${fixedPct}%` }}
                title={`Fixed Bills: ${fmt(fixedBills)}`}
              />
            )}
            {varPct > 0 && (
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${varPct}%` }}
                title={`Variable Allowance: ${fmt(variableAllowance)}`}
              />
            )}
            {poolPct > 0 && (
              <div
                className="h-full bg-[#FF2EB8] transition-all"
                style={{ width: `${poolPct}%` }}
                title={`Savings Pools: ${fmt(poolSavings)}`}
              />
            )}
            {isSurplus && leftoverPct > 0 && (
              <div
                className="h-full bg-[#22C55E] transition-all"
                style={{ width: `${leftoverPct}%` }}
                title={`Leftover Surplus: ${fmt(netLeftover)}`}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Bills: <strong className="text-slate-900">{fmt(fixedBills)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              Variable: <strong className="text-slate-900">{fmt(variableAllowance)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF2EB8]" />
              Pools: <strong className="text-slate-900">{fmt(poolSavings)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]" />
              Leftover: <strong className="text-slate-900">{fmt(netLeftover)}</strong>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
