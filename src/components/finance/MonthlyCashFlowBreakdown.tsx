import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUpRight, Lock, PiggyBank, Scale, ShoppingCart, PartyPopper, AlertCircle, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';

interface Props {
  income: number;
  expectedIncome?: number;
  fixedBills: number;
  essentialBudget: number;
  essentialSpent?: number;
  poolSavings: number;
  funSpent?: number;
  baseCurrency?: string;
  monthLabel?: string;
}

export default function MonthlyCashFlowBreakdown({
  income,
  expectedIncome = 0,
  fixedBills,
  essentialBudget,
  essentialSpent = 0,
  poolSavings,
  funSpent = 0,
  baseCurrency = 'AUD',
  monthLabel,
}: Props) {
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Effective income to use: actual cleared income if available, else expected monthly income
  const effectiveIncome = income > 0 ? income : expectedIncome;
  const isUsingExpected = income === 0 && expectedIncome > 0;

  // Fun Money = What is genuinely leftover after Bills, Essentials & Savings Pools!
  const funMoneyLeftoverMonthly = Math.max(0, effectiveIncome - fixedBills - essentialBudget - poolSavings);
  const weeklyFunPace = funMoneyLeftoverMonthly / 4.33;
  const shortfall = Math.max(0, (fixedBills + essentialBudget + poolSavings) - effectiveIncome);
  const isSurplus = effectiveIncome >= (fixedBills + essentialBudget + poolSavings);

  // Percentage breakdown relative to income
  const incomeDenom = Math.max(effectiveIncome, fixedBills + essentialBudget + poolSavings, 1);
  const fixedPct = Math.min(100, (fixedBills / incomeDenom) * 100);
  const essentialPct = Math.min(100, (essentialBudget / incomeDenom) * 100);
  const poolPct = Math.min(100, (poolSavings / incomeDenom) * 100);
  const funPct = Math.min(100, (funMoneyLeftoverMonthly / incomeDenom) * 100);

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[8px_8px_0px_0px_rgba(255,46,184,0.12)] overflow-hidden font-body">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0FDF4] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#FF2EB8] text-white p-1 rounded-lg">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
              <span className="text-[#FF2EB8] font-display font-bold uppercase tracking-wider text-xs">
                Intuitive Financial Engine {monthLabel ? `• ${monthLabel}` : ''}
              </span>
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900">
              Intuitive Cash Flow Breakdown
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Fun Money isn't guessed—it's what's genuinely leftover after bills, essentials & pools are funded.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isSurplus ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-display font-black text-sm px-3.5 py-1.5 rounded-2xl gap-1.5 shadow-sm">
                <PartyPopper className="w-4 h-4 text-emerald-600" />
                {fmt(weeklyFunPace)}/wk Fun Money
              </Badge>
            ) : (
              <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-display font-black text-sm px-3.5 py-1.5 rounded-2xl gap-1.5 shadow-sm">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                −{fmt(shortfall)} Shortfall
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Step-by-Step Waterfall List */}
        <div className="space-y-3">
          {/* 1. Monthly Income */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-sky-50/80 border-2 border-sky-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center font-black text-lg shadow-sm">
                +
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-sky-800 tracking-wider block">
                  1. Monthly Income
                </span>
                <span className="text-sm font-semibold text-slate-700">
                  {isUsingExpected ? (
                    <>Expected Monthly Income <span className="text-xs text-sky-600 font-normal">(baseline profile)</span></>
                  ) : (
                    <>Total Cleared Income</>
                  )}
                </span>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-sky-900 tabular-nums">
              +{fmt(effectiveIncome)}
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

          {/* 3. Essential Living */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-purple-50/80 border-2 border-purple-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500 text-white flex items-center justify-center font-bold shadow-sm">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-purple-800 tracking-wider block">
                  3. Essential Living
                </span>
                <span className="text-sm font-semibold text-slate-700">
                  Supermarkets, Transport & Health
                  {essentialSpent > 0 && (
                    <span className="text-xs text-purple-600 block font-normal">
                      ({fmt(essentialSpent)} spent so far this month)
                    </span>
                  )}
                </span>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-purple-900 tabular-nums">
              −{fmt(essentialBudget)}
            </span>
          </div>

          {/* 4. Savings Pools */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-pink-50/80 border-2 border-[#FF7AD1]/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FF2EB8] text-white flex items-center justify-center font-bold shadow-sm">
                <PiggyBank className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-[#FF2EB8] tracking-wider block">
                  4. Savings Pools
                </span>
                <span className="text-sm font-semibold text-slate-700">Travel, Vehicle, Reserve & Goals</span>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-[#FF2EB8] tabular-nums">
              −{fmt(poolSavings)}
            </span>
          </div>

          {/* Equal Divider */}
          <div className="border-t-2 border-dashed border-slate-300 my-4" />

          {/* 5. Fun Money = What's Leftover */}
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
                  5. FUN MONEY (WHAT'S LEFTOVER)
                </span>
                <span className="text-sm font-bold">
                  {isSurplus ? (
                    <>Safe Discretionary Spending • {fmt(weeklyFunPace)}/wk</>
                  ) : (
                    <>Income Deficit • Adjust Pools or Expenses</>
                  )}
                </span>
                {funSpent > 0 && (
                  <span className="text-xs font-medium block mt-0.5 opacity-90">
                    ({fmt(funSpent)} fun spent so far this month)
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="text-3xl sm:text-4xl font-display font-black tabular-nums block">
                {isSurplus ? `+${fmt(funMoneyLeftoverMonthly)}` : `−${fmt(shortfall)}`}
              </span>
              <span className="text-xs font-semibold opacity-80">
                {isSurplus ? `${fmt(weeklyFunPace)} / week` : 'Requires budget adjustment'}
              </span>
            </div>
          </div>
        </div>

        {/* Visual Stacked Flow Bar */}
        <div>
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
            <span>Income Allocation Map</span>
            <span>{effectiveIncome > 0 ? '100% of Income' : ''}</span>
          </div>

          <div className="h-4 rounded-full bg-slate-100 overflow-hidden flex shadow-inner border border-slate-200">
            {fixedPct > 0 && (
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${fixedPct}%` }}
                title={`Fixed Bills: ${fmt(fixedBills)}`}
              />
            )}
            {essentialPct > 0 && (
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${essentialPct}%` }}
                title={`Essentials: ${fmt(essentialBudget)}`}
              />
            )}
            {poolPct > 0 && (
              <div
                className="h-full bg-[#FF2EB8] transition-all"
                style={{ width: `${poolPct}%` }}
                title={`Savings Pools: ${fmt(poolSavings)}`}
              />
            )}
            {isSurplus && funPct > 0 && (
              <div
                className="h-full bg-[#22C55E] transition-all"
                style={{ width: `${funPct}%` }}
                title={`Fun Money Leftover: ${fmt(funMoneyLeftoverMonthly)}`}
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
              Essentials: <strong className="text-slate-900">{fmt(essentialBudget)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF2EB8]" />
              Pools: <strong className="text-slate-900">{fmt(poolSavings)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]" />
              Fun Money Leftover: <strong className="text-slate-900">{fmt(funMoneyLeftoverMonthly)}</strong>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
