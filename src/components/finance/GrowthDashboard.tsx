import { useMemo } from 'react';
import { TrendingUp, Wallet, Target, ArrowUpRight } from 'lucide-react';
import {
  computeNetCashHistory,
  computeSavingsRate,
  computeProjection12Month,
  computeRollingIncomeAvg,
  computeRollingBurnRate,
  formatCurrency,
} from '@/lib/financeUtils';
import { TimeRangeFilter, useTimeRange, getTimeRangeMonths } from './TimeRangeFilter';
import { HeroCard } from './HeroCard';
import { NextMoveBox } from './NextMoveBox';
import { MetricCard } from './MetricCard';
import { SectionCard } from './SectionCard';
import { HealthBadge } from './HealthBadge';
import { EmptyFinanceState } from './EmptyFinanceState';
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip, Area, AreaChart } from 'recharts';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData>; onSyncClick?: () => void };

function savingsStatus(rate: number): 'safe' | 'caution' | 'danger' {
  if (rate >= 20) return 'safe';
  if (rate >= 5) return 'caution';
  return 'danger';
}

function savingsLabel(rate: number): string {
  if (rate >= 20) return 'Healthy';
  if (rate >= 5) return 'Moderate';
  if (rate >= 0) return 'Low';
  return 'Negative';
}

const STATUS_COLORS = {
  safe: 'hsl(145, 63%, 42%)',
  caution: 'hsl(38, 100%, 56%)',
  danger: 'hsl(3, 72%, 60%)',
};

export default function GrowthDashboard({ finance, onSyncClick }: Props) {
  const { transactions, categories, settings, totalCashBase } = finance;
  const baseCurrency = settings?.base_currency || 'AUD';
  const cashBase = totalCashBase();
  const { range, setRange } = useTimeRange('6m');
  const months = getTimeRangeMonths(range);

  const savingsRate = useMemo(() => computeSavingsRate(transactions, categories, months), [transactions, categories, months]);
  const netHistory = useMemo(() => computeNetCashHistory(transactions, categories, months), [transactions, categories, months]);
  const projection = useMemo(() => computeProjection12Month(transactions, categories, cashBase), [transactions, categories, cashBase]);
  const incomeAvg = useMemo(() => computeRollingIncomeAvg(transactions, categories, 3), [transactions, categories]);
  const burnAvg = useMemo(() => computeRollingBurnRate(transactions, categories, 3), [transactions, categories]);

  const monthlySavings = incomeAvg.avg - burnAvg.avg;
  const annualSavings = monthlySavings * 12;
  const status = savingsStatus(savingsRate);

  if (transactions.length === 0) {
    return <EmptyFinanceState onSyncClick={onSyncClick} />;
  }

  const nextMoves: string[] = [];
  if (savingsRate >= 20) {
    nextMoves.push(`Savings rate ${savingsRate.toFixed(0)}% — excellent. Consider accelerating goal timelines.`);
  } else if (savingsRate >= 5) {
    nextMoves.push(`Savings rate ${savingsRate.toFixed(0)}% — okay but room to improve.`);
  } else if (savingsRate >= 0) {
    nextMoves.push(`Savings rate is only ${savingsRate.toFixed(0)}% — look for cuts in variable spending.`);
  } else {
    nextMoves.push(`Negative savings rate — spending exceeds income. Prioritise burn reduction.`);
  }
  if (projection > cashBase * 1.5) {
    nextMoves.push(`12-month projection: ${formatCurrency(projection, baseCurrency)} — trending well.`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-extrabold text-foreground">Growth</h2>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      <HeroCard
        primaryMetric={
          <span style={{ color: STATUS_COLORS[status] }}>{savingsRate.toFixed(1)}%</span>
        }
        subtitle="Savings rate"
        tooltip={`(Income - Spend) ÷ Income over rolling ${months} months`}
        chips={[
          { label: 'Monthly savings', value: formatCurrency(monthlySavings, baseCurrency) },
          { label: 'Est. annual', value: formatCurrency(annualSavings, baseCurrency) },
        ]}
        accentColor="success"
      />

      {/* Savings Rate Health */}
      <SectionCard title="Savings Health" titleRight={<HealthBadge status={status} label={savingsLabel(savingsRate)} />}>
        <div className="h-4 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.min(100, Math.max(0, savingsRate * 2.5))}%`,
              backgroundColor: STATUS_COLORS[status],
            }}
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-[10px] text-muted-foreground">0%</span>
          <span className="text-[10px] text-muted-foreground">20%</span>
          <span className="text-[10px] text-muted-foreground">40%+</span>
        </div>
      </SectionCard>

      <NextMoveBox items={nextMoves} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard label="Current Cash" value={formatCurrency(cashBase, baseCurrency)} icon={Wallet} />
        <MetricCard
          label="12mo Projection"
          value={formatCurrency(projection, baseCurrency)}
          icon={Target}
          valueClassName={projection > cashBase ? 'text-success' : 'text-destructive'}
        />
        <MetricCard
          label="Monthly FCF"
          value={formatCurrency(monthlySavings, baseCurrency)}
          icon={ArrowUpRight}
          valueClassName={monthlySavings >= 0 ? 'text-success' : 'text-destructive'}
        />
      </div>

      {/* Net Cash Trend */}
      <SectionCard title="Net Cash Flow Trend">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={netHistory}>
              <defs>
                <linearGradient id="netGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(320, 100%, 59%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(320, 100%, 59%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={50}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              />
              <RechartsTooltip
                formatter={(value: number, name: string) => [
                  formatCurrency(value, baseCurrency),
                  name === 'net' ? 'Cumulative Net' : name === 'savings' ? 'Monthly Savings' : name,
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid hsl(300 10% 90%)' }}
              />
              <Area type="monotone" dataKey="net" stroke="hsl(320, 100%, 59%)" fill="url(#netGradient)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* Monthly Savings */}
      <SectionCard title="Monthly Savings">
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={netHistory}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={50}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              />
              <RechartsTooltip
                formatter={(value: number) => formatCurrency(value, baseCurrency)}
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid hsl(300 10% 90%)' }}
              />
              <Bar dataKey="savings" name="Savings" radius={[6, 6, 0, 0]}>
                {netHistory.map((entry, i) => (
                  <Cell key={i} fill={entry.savings >= 0 ? 'hsl(145, 63%, 42%)' : 'hsl(3, 72%, 60%)'} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>
    </div>
  );
}
