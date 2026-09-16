import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUpRight, Lock, PiggyBank, Scale, ShoppingCart, PartyPopper, AlertCircle, Sparkles, Calendar, Zap } from 'lucide-react';
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
  defaultViewMode?: 'weekly' | 'monthly';
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
  defaultViewMode = 'weekly',
}: Props) {
  const [viewMode, setViewMode] = useState<'weekly' | 'monthly'>(defaultViewMode);
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Effective monthly income to use: actual cleared income if available, else expected monthly income
  const effectiveMonthlyIncome = income > 0 ? income : expectedIncome;
  const isUsingExpected = income === 0 && expectedIncome > 0;

  // Monthly breakdown numbers
  const monthlyFunLeftover = Math.max(0, effectiveMonthlyIncome - fixedBills - essentialBudget - poolSavings);
  const monthlyShortfall = Math.max(0, (fixedBills + essentialBudget + poolSavings) - effectiveMonthlyIncome);
  const isSurplus = effectiveMonthlyIncome >= (fixedBills + essentialBudget + poolSavings);

  // Scaling factor for weekly view (4.33 weeks per month)
  const isWeekly = viewMode === 'weekly';
  const divisor = isWeekly ? 4.33 : 1;
  const periodTag = isWeekly ? '/ week' : '/ month';

  const displayIncome = effectiveMonthlyIncome / divisor;
  const displayFixed = fixedBills / divisor;
  const displayEssential = essentialBudget / divisor;
  const displayEssentialSpent = essentialSpent / divisor;
  const displayPools = poolSavings / divisor;
  const displayFunLeftover = monthlyFunLeftover / divisor;
  const displayShortfall = monthlyShortfall / divisor;
  const displayFunSpent = funSpent / divisor;

  // Percentage breakdown relative to income
  const incomeDenom = Math.max(effectiveMonthlyIncome, fixedBills + essentialBudget + poolSavings, 1);
  const fixedPct = Math.min(100, (fixedBills / incomeDenom) * 100);
  const essentialPct = Math.min(100, (essentialBudget / incomeDenom) * 100);
  const poolPct = Math.min(100, (poolSavings / incomeDenom) * 100);
  const funPct = Math.min(100, (monthlyFunLeftover / incomeDenom) * 100);

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[8px_8px_0px_0px_rgba(255,46,184,0.12)] overflow-hidden font-body">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0FDF4] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
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
              {isWeekly ? 'Weekly Cash Flow Breakdown' : 'Monthly Cash Flow Breakdown'}
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Fun Money isn't guessed—it's what's genuinely leftover after bills, essentials & pools are funded.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* View Mode Toggle Switch */}
            <div className="bg-[#FFF5FA] p-1 rounded-2xl border border-[#FF7AD1]/30 flex items-center gap-1 shadow-inner">
              <button
                type="button"
                onClick={() => setViewMode('weekly')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-display font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  isWeekly
                    ? 'bg-[#FF2EB8] text-white shadow-md shadow-[#FF2EB8]/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <Zap className="w-3.5 h-3.5" /> Weekly
              </button>
              <button
                type="button"
                onClick={() => setViewMode('monthly')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-display font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  !isWeekly
                    ? 'bg-[#FF2EB8] text-white shadow-md shadow-[#FF2EB8]/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" /> Monthly
              </button>
            </div>

            {isSurplus ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-display font-black text-xs sm:text-sm px-3.5 py-1.5 rounded-2xl gap-1.5 shadow-sm">
                <PartyPopper className="w-4 h-4 text-emerald-600" />
                {fmt(displayFunLeftover)} {periodTag} Fun Money
              </Badge>
            ) : (
              <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-display font-black text-xs sm:text-sm px-3.5 py-1.5 rounded-2xl gap-1.5 shadow-sm">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                −{fmt(displayShortfall)} Shortfall
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Step-by-Step Waterfall List */}
        <div className="space-y-3">
          {/* 1. Income */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-sky-50/80 border-2 border-sky-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center font-black text-lg shadow-sm">
                +
              </div>
              <div>
                <span className="text-xs font-display font-bold uppercase text-sky-800 tracking-wider block">
                  1. {isWeekly ? 'Weekly Income' : 'Monthly Income'}
                </span>
                <span className="text-sm font-semibold text-slate-700">
                  {isUsingExpected ? (
                    <>Expected Income <span className="text-xs text-sky-600 font-normal">(baseline profile)</span></>
                  ) : (
                    <>Total Cleared Income</>
                  )}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-display font-black text-sky-900 tabular-nums block">
                +{fmt(displayIncome)}
              </span>
              <span className="text-[10px] text-sky-600 font-semibold">{periodTag}</span>
            </div>
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
            <div className="text-right">
              <span className="text-2xl font-display font-black text-amber-900 tabular-nums block">
                −{fmt(displayFixed)}
              </span>
              <span className="text-[10px] text-amber-600 font-semibold">{periodTag}</span>
            </div>
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
                      ({fmt(displayEssentialSpent)} spent so far this {isWeekly ? 'week' : 'month'})
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-display font-black text-purple-900 tabular-nums block">
                −{fmt(displayEssential)}
              </span>
              <span className="text-[10px] text-purple-600 font-semibold">{periodTag}</span>
            </div>
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
            <div className="text-right">
              <span className="text-2xl font-display font-black text-[#FF2EB8] tabular-nums block">
                −{fmt(displayPools)}
              </span>
              <span className="text-[10px] text-pink-600 font-semibold">{periodTag}</span>
            </div>
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
                  5. FUN MONEY ({isWeekly ? "THIS WEEK'S LEFTOVER" : "THIS MONTH'S LEFTOVER"})
                </span>
                <span className="text-sm font-bold">
                  {isSurplus ? (
                    <>Safe Guilt-Free Discretionary Budget</>
                  ) : (
                    <>Income Deficit • Adjust Pools or Expenses</>
                  )}
                </span>
                {funSpent > 0 && (
                  <span className="text-xs font-medium block mt-0.5 opacity-90">
                    ({fmt(displayFunSpent)} fun spent so far)
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="text-3xl sm:text-4xl font-display font-black tabular-nums block">
                {isSurplus ? `+${fmt(displayFunLeftover)}` : `−${fmt(displayShortfall)}`}
              </span>
              <span className="text-xs font-semibold opacity-80">
                {isSurplus ? `${fmt(displayFunLeftover)} ${periodTag}` : 'Requires budget adjustment'}
              </span>
            </div>
          </div>
        </div>

        {/* Visual Stacked Flow Bar */}
        <div>
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
            <span>Income Allocation Map</span>
            <span>{effectiveMonthlyIncome > 0 ? `100% of ${isWeekly ? 'Weekly' : 'Monthly'} Income` : ''}</span>
          </div>

          <div className="h-4 rounded-full bg-slate-100 overflow-hidden flex shadow-inner border border-slate-200">
            {fixedPct > 0 && (
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${fixedPct}%` }}
                title={`Fixed Bills: ${fmt(displayFixed)}`}
              />
            )}
            {essentialPct > 0 && (
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${essentialPct}%` }}
                title={`Essentials: ${fmt(displayEssential)}`}
              />
            )}
            {poolPct > 0 && (
              <div
                className="h-full bg-[#FF2EB8] transition-all"
                style={{ width: `${poolPct}%` }}
                title={`Savings Pools: ${fmt(displayPools)}`}
              />
            )}
            {isSurplus && funPct > 0 && (
              <div
                className="h-full bg-[#22C55E] transition-all"
                style={{ width: `${funPct}%` }}
                title={`Fun Money Leftover: ${fmt(displayFunLeftover)}`}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Bills: <strong className="text-slate-900">{fmt(displayFixed)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              Essentials: <strong className="text-slate-900">{fmt(displayEssential)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF2EB8]" />
              Pools: <strong className="text-slate-900">{fmt(displayPools)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]" />
              Fun Money: <strong className="text-slate-900">{fmt(displayFunLeftover)}</strong>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
