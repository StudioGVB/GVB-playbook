import { useMemo, useState } from 'react';
import { AlertTriangle, Repeat, ShoppingBag, BarChart3, Scissors, X } from 'lucide-react';
import {
  computePeriodTotals,
  computeCategoryBreakdown,
  computeCategorySpikeDetection,
  detectSubscriptions,
  formatCurrency,
  formatUkDate,
  filterTxByDays,
} from '@/lib/financeUtils';
import { TimeRangeFilter, useTimeRange, getTimeRangeDays } from './TimeRangeFilter';
import { HeroCard } from './HeroCard';
import { NextMoveBox } from './NextMoveBox';
import { MetricCard } from './MetricCard';
import { SectionCard } from './SectionCard';
import { EmptyFinanceState } from './EmptyFinanceState';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip, Cell } from 'recharts';
import { format } from 'date-fns';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData>; onSyncClick?: () => void };

const DEFAULT_BAR_COLORS = [
  'hsl(320, 100%, 59%)',
  'hsl(262, 100%, 65%)',
  'hsl(227, 100%, 59%)',
  'hsl(145, 63%, 42%)',
  'hsl(38, 100%, 56%)',
];

export default function BehaviourDashboard({ finance, onSyncClick }: Props) {
  const { transactions, categories, settings } = finance;
  const baseCurrency = settings?.base_currency || 'AUD';
  const { range, setRange } = useTimeRange('3m');
  const days = getTimeRangeDays(range);
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
  const [showSubscriptionTxs, setShowSubscriptionTxs] = useState(false);

  const totals = useMemo(() => computePeriodTotals(transactions, categories, days), [transactions, categories, days]);
  const topCategories = useMemo(() => computeCategoryBreakdown(transactions, categories, days).slice(0, 5), [transactions, categories, days]);
  const spikes = useMemo(() => computeCategorySpikeDetection(transactions, categories, days, 30), [transactions, categories, days]);
  const subscriptions = useMemo(() => detectSubscriptions(transactions, categories, 3), [transactions, categories]);

  const fixedPct = totals.totalSpend > 0 ? (totals.fixedSpend / totals.totalSpend) * 100 : 0;
  const variablePct = 100 - fixedPct;
  const spikedCategories = spikes.filter(s => s.isSpike && s.previous > 0);
  const totalSubCost = subscriptions.reduce((s, sub) => s + sub.monthlyAvg, 0);

  // Drill-down transactions
  const drillTxs = useMemo(() => {
    if (!drillCategory) return [];
    const periodTxs = filterTxByDays(transactions, days);
    if (drillCategory === 'uncategorized') {
      return periodTxs.filter(tx => !tx.category_id && tx.amount < 0);
    }
    return periodTxs.filter(tx => tx.category_id === drillCategory && tx.amount < 0);
  }, [drillCategory, transactions, days]);

  const drillCatName = drillCategory === 'uncategorized'
    ? 'Uncategorised'
    : categories.find(c => c.id === drillCategory)?.name || '';

  // Get all category breakdown (not just top 5) for the full list
  const allCategories = useMemo(() => computeCategoryBreakdown(transactions, categories, days), [transactions, categories, days]);

  if (topCategories.length === 0) {
    return <EmptyFinanceState onSyncClick={onSyncClick} />;
  }

  const nextMoves: string[] = [];
  if (spikedCategories.length > 0) {
    const top = spikedCategories[0];
    nextMoves.push(`${top.name} spiked +${top.changePct.toFixed(0)}% vs previous period — check if it's a one-off.`);
  }
  if (fixedPct > 60) {
    nextMoves.push(`${fixedPct.toFixed(0)}% of spend is fixed — limited flexibility.`);
  }
  if (subscriptions.length > 5) {
    nextMoves.push(`${subscriptions.length} recurring merchants — ${formatCurrency(totalSubCost, baseCurrency)}/mo in subscriptions.`);
  }

  const chartData = topCategories.map((c, i) => ({ name: c.name, total: c.total, catId: (c as any).catId, color: (c as any).color || DEFAULT_BAR_COLORS[i % DEFAULT_BAR_COLORS.length] }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-extrabold text-foreground">Operating</h2>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      <HeroCard
        primaryMetric={formatCurrency(totals.totalSpend, baseCurrency)}
        subtitle="Total spending"
        tooltip="All expenses in selected period (excl. transfers)"
        chips={[
          { label: 'Fixed', value: `${fixedPct.toFixed(0)}%` },
          { label: 'Variable', value: `${variablePct.toFixed(0)}%` },
        ]}
        accentColor="purple"
      />

      <NextMoveBox items={nextMoves} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Fixed" value={formatCurrency(totals.fixedSpend, baseCurrency)} icon={BarChart3} />
        <MetricCard label="Variable" value={formatCurrency(totals.variableSpend, baseCurrency)} icon={ShoppingBag} />
        <button onClick={() => { setShowSubscriptionTxs(!showSubscriptionTxs); setDrillCategory(null); }} className="text-left">
          <MetricCard label="Subscriptions" value={String(subscriptions.length)} icon={Repeat} />
        </button>
        <MetricCard label="Recurring Cost" value={`${formatCurrency(totalSubCost, baseCurrency)}/mo`} icon={Scissors} />
      </div>

      {/* Fixed vs Variable */}
      <SectionCard title="Fixed vs Variable Split">
        <div className="h-5 bg-muted/50 rounded-full overflow-hidden flex">
          <div className="h-full rounded-l-full bg-[hsl(var(--accent-purple))]" style={{ width: `${fixedPct}%` }} />
          <div className="h-full rounded-r-full bg-primary/40" style={{ width: `${variablePct}%` }} />
        </div>
        <div className="flex justify-between mt-2.5 text-xs text-muted-foreground">
          <span>Fixed: {formatCurrency(totals.fixedSpend, baseCurrency)}</span>
          <span>Variable: {formatCurrency(totals.variableSpend, baseCurrency)}</span>
        </div>
      </SectionCard>

      {/* Top 5 Categories - Clickable */}
      <SectionCard title="Top 5 Categories">
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" barSize={18}>
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={85} />
              <RechartsTooltip
                formatter={(value: number) => formatCurrency(value, baseCurrency)}
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid hsl(300 10% 90%)' }}
              />
              <Bar dataKey="total" radius={[0, 6, 6, 0]} cursor="pointer"
                onClick={(data: any) => {
                  if (data?.name) {
                    const cat = categories.find(c => c.name === data.name);
                    setDrillCategory(cat?.id || 'uncategorized');
                  }
                }}
              >
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* All Categories List - Clickable */}
      <SectionCard title="All Categories">
        <div className="space-y-1">
          {allCategories.map((c, i) => {
            const cat = categories.find(ct => ct.name === c.name);
            const isExcluded = cat?.exclude_from_reports;
            const dotColor = (c as any).color || cat?.color || DEFAULT_BAR_COLORS[i % DEFAULT_BAR_COLORS.length];
            return (
              <button
                key={i}
                onClick={() => setDrillCategory(cat?.id || 'uncategorized')}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/40 transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">{c.type}</span>
                  {isExcluded && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
                      Excluded
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{c.count} txns</span>
                  <span className="text-sm font-semibold">{formatCurrency(c.total, baseCurrency)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Category Drill-Down */}
      {drillCategory && (
        <SectionCard title={`${drillCatName} — ${drillTxs.length} transactions`}>
          <div className="flex justify-end mb-2">
            <button onClick={() => setDrillCategory(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <X className="w-3 h-3" /> Close
            </button>
          </div>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {drillTxs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No transactions in this period</p>
            ) : (
              drillTxs.map(tx => (
                <div key={tx.id} className="flex items-center justify-between p-2 rounded-lg border bg-card">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{tx.description}</p>
                    <p className="text-xs text-muted-foreground">{formatUkDate(tx.posted_at, 'dd MMM yyyy')}</p>
                  </div>
                  <p className="text-sm font-semibold ml-3">{formatCurrency(tx.base_amount !== undefined && tx.base_amount !== null ? tx.base_amount : tx.amount, baseCurrency)}</p>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      )}

      {/* Spike Detection */}
      {spikedCategories.length > 0 && (
        <SectionCard title="Spending Spikes (+30%)" className="border-warning/20">
          <div className="space-y-2.5">
            {spikedCategories.slice(0, 5).map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{s.name}</span>
                <div className="text-right flex items-center gap-3">
                  <span className="text-destructive font-bold text-sm">+{s.changePct.toFixed(0)}%</span>
                  <span className="text-muted-foreground text-xs">
                    {formatCurrency(s.previous, baseCurrency)} → {formatCurrency(s.total, baseCurrency)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Subscription Transactions Drill-Down */}
      {showSubscriptionTxs && subscriptions.length > 0 && (
        <SectionCard title={`Subscription Transactions — ${subscriptions.length} recurring merchants`}>
          <div className="flex justify-end mb-2">
            <button onClick={() => setShowSubscriptionTxs(false)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <X className="w-3 h-3" /> Close
            </button>
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {subscriptions.map((sub, i) => {
              const subTxs = filterTxByDays(transactions, days).filter(
                tx => tx.amount < 0 && (tx.merchant === sub.merchant || tx.description.toLowerCase().includes(sub.merchant.toLowerCase()))
              );
              return (
                <div key={i} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between p-2.5 bg-muted/30">
                    <span className="text-sm font-medium truncate">{sub.merchant}</span>
                    <span className="text-xs font-bold text-muted-foreground">{formatCurrency(sub.monthlyAvg, baseCurrency)}/mo</span>
                  </div>
                  {subTxs.slice(0, 5).map(tx => (
                    <div key={tx.id} className="flex items-center justify-between px-3 py-1.5 border-t border-border/50">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs truncate text-muted-foreground">{tx.description}</p>
                        <p className="text-[10px] text-muted-foreground/60">{formatUkDate(tx.posted_at, 'dd MMM yyyy')}</p>
                      </div>
                      <p className="text-xs font-semibold ml-3">{formatCurrency(tx.base_amount !== undefined && tx.base_amount !== null ? tx.base_amount : tx.amount, baseCurrency)}</p>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Recurring Merchants Summary */}
      {!showSubscriptionTxs && subscriptions.length > 0 && (
        <SectionCard title="Recurring Merchants">
          <p className="text-xs text-muted-foreground mb-3">
            {subscriptions.length} detected — {formatCurrency(totalSubCost, baseCurrency)}/mo total
          </p>
          <div className="space-y-2.5">
            {subscriptions.slice(0, 8).map((sub, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-foreground truncate max-w-[60%]">{sub.merchant}</span>
                <span className="text-sm font-bold text-muted-foreground">{formatCurrency(sub.monthlyAvg, baseCurrency)}/mo</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
