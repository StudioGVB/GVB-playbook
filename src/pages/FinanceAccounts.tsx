import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowUpRight, Wallet, Sparkles, Settings2, TrendingUp, Plus, Trash2, Briefcase, Pencil, Archive, ArchiveRestore, Check, X, Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency } from '@/lib/financeUtils';
import FinanceSettingsPanel from '@/components/finance/FinanceSettingsPanel';
import FinanceAccountsComponent from '@/components/finance/FinanceAccounts';
import FinanceCostOfLivingPage from './FinanceCostOfLiving';
import FinanceHistoryPage from './FinanceHistory';
import { toast } from 'sonner';

const INCOME_COLORS = ['#2563EB', '#EA580C', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#DC2626', '#F59E0B'];
const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
  '#F43F5E', '#78716C', '#64748B', '#6B7280',
];


// Locked bento palette — bright pinks + fresh greens
const PINK = '#FF2EB8';
const PINK_SOFT = '#FF7AD1';
const PINK_WASH = '#FFF5FA';
const GREEN = '#22C55E';
const GREEN_SOFT = '#86EFAC';
const GREEN_DEEP = '#166534';

export default function FinanceAccountsPage({ defaultTab }: { defaultTab?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading, update: updateAssumptions } = useFinanceAssumptions();
  const { monthlyTotalInternal: fixedMonthlyTotal, monthlyTotal: fixedMonthlyTotalAll } = useFixedExpenses();
  const { weekTypeMap } = useWeekTypes();
  const wtMap = useMemo(() => weekTypeMap(), [weekTypeMap]);

  const snapshot = useMemo(() => {
    if (!assumptions || finance.loading) return null;
    return computePolicySnapshot(
      assumptions,
      finance.accounts,
      finance.transactions,
      finance.categories,
      finance.goals,
      finance.convertToBase,
      fixedMonthlyTotal,
      undefined,
      wtMap,
      [],
      fixedMonthlyTotalAll
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, finance.loading, fixedMonthlyTotal, fixedMonthlyTotalAll, wtMap]);

  const activeTab = useMemo(() => {
    if (defaultTab) return defaultTab;
    if (location.pathname === '/finance/settings') return 'settings';
    if (location.pathname === '/finance/history') return 'history';
    if (location.pathname === '/finance/cost-of-living') return 'cost-of-living';
    return 'accounts';
  }, [defaultTab, location.pathname]);

  const handleTabChange = (val: string) => {
    if (val === 'accounts') navigate('/finance/accounts');
    else if (val === 'settings') navigate('/finance/settings');
    else if (val === 'history') navigate('/finance/history');
    else if (val === 'cost-of-living') navigate('/finance/cost-of-living');
  };

  if (finance.loading || assumptionsLoading) {
    return (
      <div className="min-h-screen bg-[#FFF5FA] p-6">
        <h1 className="text-2xl font-display font-bold text-slate-900">Accounts & Settings</h1>
        <div className="text-slate-500 animate-pulse mt-4">Loading...</div>
      </div>
    );
  }

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const totalLiquidity = finance.totalCashBase();
  const includedAccounts = finance.accounts.filter(a => !a.exclude_from_totals && a.provider !== 'external');
  const activeCount = includedAccounts.length;

  // Dynamic Cost of Living & Runway calculation
  const survivalMonthly = (assumptions?.future_monthly_survival_cost && assumptions.future_monthly_survival_cost > 0)
    ? assumptions.future_monthly_survival_cost
    : (snapshot?.emergencySurvivalMonthly ?? snapshot?.survivalCostMonthly ?? (fixedMonthlyTotal + 100));

  const bufferMonths = assumptions?.buffer_months || 3;
  const runwayMonths = survivalMonthly > 0 ? totalLiquidity / survivalMonthly : (snapshot ? snapshot.runwayWeeks / 4.33 : 0);
  const runwayPct = Math.min(100, Math.round((runwayMonths / bufferMonths) * 100));
  const runwayOnTrack = runwayMonths >= bufferMonths;

  return (
    <div className="space-y-6 font-body">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">
            Accounts & Settings
          </h1>
          <p className="text-slate-500 mt-1">Your money, your rules — all in one candy jar.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
          {/* Clean segmented pill tabs */}
          <TabsList className="bg-white/90 backdrop-blur-md p-1 rounded-xl w-fit h-auto shadow-xs border border-slate-200/80 gap-1 flex-wrap">
            <TabsTrigger
              value="accounts"
              className="px-3.5 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
            >
              Accounts
            </TabsTrigger>
            <TabsTrigger
              value="cost-of-living"
              className="px-3.5 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
            >
              Cost of Living
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="px-3.5 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
            >
              History
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="px-3.5 py-1.5 rounded-lg font-display font-semibold text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 data-[state=active]:bg-[#FF2EB8] data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
            >
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="accounts" className="space-y-6 mt-0">
            {/* Bento hero grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Total Liquidity hero */}
              <div
                className="md:col-span-2 md:row-span-2 bg-white rounded-[2rem] p-7 border-2 border-[#FF2EB8] relative overflow-hidden flex flex-col justify-between min-h-[220px]"
                style={{ boxShadow: `8px 8px 0px 0px ${PINK}` }}
              >
                <div className="relative z-10">
                  <p className="text-[#FF2EB8] font-display font-bold uppercase tracking-widest text-xs mb-2">
                    Total Liquidity
                  </p>
                  <h2 className="text-4xl sm:text-5xl font-display font-black text-slate-900 tabular-nums leading-none">
                    {formatCurrency(totalLiquidity, baseCurrency)}
                  </h2>
                  <div className="mt-4 inline-flex items-center gap-1.5 bg-[#86EFAC] px-3 py-1 rounded-full text-[#166534] text-sm font-bold">
                    <Wallet className="w-4 h-4" />
                    {activeCount} account{activeCount !== 1 ? 's' : ''} tracked
                  </div>
                </div>
                {/* Sparkline-ish bars from top account balances */}
                <div className="mt-8 flex items-end gap-1.5 h-20">
                  {(() => {
                    const bars = includedAccounts
                      .map(a => Math.abs(finance.convertToBase(a.balance, a.currency)))
                      .sort((a, b) => b - a)
                      .slice(0, 6);
                    const max = Math.max(1, ...bars);
                    if (bars.length === 0) return <div className="flex-1 h-full bg-[#FFF5FA] rounded-lg" />;
                    return bars.map((v, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-lg"
                        style={{
                          height: `${Math.max(12, (v / max) * 100)}%`,
                          backgroundColor: i === 0 ? PINK : PINK_SOFT,
                          opacity: i === 0 ? 1 : 0.35 + i * 0.1,
                        }}
                      />
                    ));
                  })()}
                </div>
                <div className="absolute -top-12 -right-12 w-40 h-40 bg-[#FF7AD1]/15 rounded-full" />
                <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-[#86EFAC]/20 rounded-full" />
              </div>

              {/* Cost of Living / Runway summary tile */}
              <div className="md:col-span-2 bg-[#86EFAC] rounded-[2rem] p-6 border-2 border-[#22C55E] flex flex-col justify-between min-h-[160px]">
                <div className="flex justify-between items-start">
                  <div className="bg-white/50 p-3 rounded-2xl">
                    <TrendingUp className="w-6 h-6 text-[#166534]" />
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase font-display tracking-wide ${
                    runwayOnTrack ? 'bg-[#166534] text-white' : 'bg-amber-600 text-white'
                  }`}>
                    {runwayOnTrack ? 'On Track' : 'Watch'}
                  </span>
                </div>
                <div>
                  <div className="flex items-baseline justify-between flex-wrap gap-1">
                    <h3 className="text-xl font-display font-bold text-[#166534]">Runway</h3>
                    <span className="text-xs font-semibold text-[#166534]/90">
                      {formatCurrency(survivalMonthly, baseCurrency)}/mo survival
                    </span>
                  </div>
                  <div className="mt-2.5 w-full bg-white/50 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full transition-all duration-500"
                      style={{ width: `${Math.max(runwayPct > 0 ? runwayPct : 0, 4)}%`, backgroundColor: runwayOnTrack ? GREEN : '#f59e0b' }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-[#166534]/90 font-medium tabular-nums">
                    {runwayMonths.toFixed(1)} of {bufferMonths} months buffer
                  </p>
                </div>
              </div>

              {/* Quick add bank tile */}
              <button
                type="button"
                onClick={() => {
                  const btn = document.querySelector<HTMLButtonElement>('[data-add-account-trigger]');
                  btn?.click();
                }}
                className="bg-[#FF7AD1] rounded-[2rem] p-6 border-2 border-[#FF2EB8] text-white flex flex-col items-center justify-center gap-2 group cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform min-h-[160px]"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/25 flex items-center justify-center group-hover:rotate-12 transition-transform">
                  <Sparkles className="w-6 h-6" />
                </div>
                <span className="font-display font-bold text-sm">Add Bank</span>
                <span className="text-white/80 text-xs">Link a new account</span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/finance/settings')}
                className="bg-white rounded-[2rem] p-6 border-2 border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-[#FF2EB8] hover:scale-[1.02] transition-all cursor-pointer min-h-[160px]"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#FFF5FA] flex items-center justify-center text-[#FF2EB8]">
                  <Settings2 className="w-6 h-6" />
                </div>
                <span className="font-display font-bold text-sm text-slate-700">Tweak Policy</span>
                <span className="text-slate-400 text-xs">Savings, income, buffer</span>
              </button>
            </div>

            {/* Wide accounts list wrapper */}
            <div className="bg-white rounded-[2rem] p-6 sm:p-8 border-2 border-slate-100 shadow-sm">
              <FinanceAccountsComponent finance={finance} />
            </div>
          </TabsContent>

          <TabsContent value="cost-of-living" className="mt-0">
            <div className="bg-white rounded-[2rem] p-6 sm:p-8 border-2 border-slate-100 shadow-sm">
              <FinanceCostOfLivingPage />
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <div className="bg-white rounded-[2rem] p-6 sm:p-8 border-2 border-slate-100 shadow-sm">
              <FinanceHistoryPage />
            </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <div className="bg-white rounded-[2rem] p-6 sm:p-8 border-2 border-slate-100 shadow-sm">
              <FinanceSettingsPanel finance={finance} />
            </div>
          </TabsContent>
        </Tabs>
    </div>
  );
}
