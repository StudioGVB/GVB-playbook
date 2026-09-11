import { useMemo } from 'react';
import { Wallet } from 'lucide-react';
import {
  computeMonthlyStats,
  computeSafeToSpend,
  computeFixedTotal,
  formatCurrency,
} from '@/lib/financeUtils';
import { HeroCard } from './HeroCard';
import { NextMoveBox } from './NextMoveBox';
import { MetricCard } from './MetricCard';
import { EmptyFinanceState } from './EmptyFinanceState';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData>; onSyncClick?: () => void };

export default function CashflowDashboard({ finance, onSyncClick }: Props) {
  const { transactions, categories, settings } = finance;
  const baseCurrency = settings?.base_currency || 'AUD';

  const thisMonth = useMemo(
    () => computeMonthlyStats(transactions, categories, 0),
    [transactions, categories],
  );

  const safeToSpend = useMemo(
    () => computeSafeToSpend(transactions, categories),
    [transactions, categories],
  );

  const fixedMTD = useMemo(
    () => computeFixedTotal(transactions, categories),
    [transactions, categories],
  );

  const netThisMonth = thisMonth.income - thisMonth.totalSpend;
  const weeklyDelta = safeToSpend.spentThisWeek - safeToSpend.weeklyBaseline;

  if (transactions.length === 0) {
    return <EmptyFinanceState onSyncClick={onSyncClick} />;
  }

  const nextMovItems: string[] = [];
  if (safeToSpend.safeToSpend === 0) {
    nextMovItems.push('Zero buffer this week — keep it tight or sync more data.');
  } else if (weeklyDelta > 0) {
    const daysLeft = Math.max(1, 7 - new Date().getDay());
    const dailyTarget = Math.round((safeToSpend.safeToSpend / daysLeft) * 100) / 100;
    nextMovItems.push(`You're over pace — aim for ~${formatCurrency(dailyTarget, baseCurrency)}/day to catch up.`);
  } else {
    const daysLeft = Math.max(1, 7 - new Date().getDay());
    const dailyBudget = Math.round((safeToSpend.safeToSpend / daysLeft) * 100) / 100;
    nextMovItems.push(`You're under pace — you can spend ~${formatCurrency(dailyBudget, baseCurrency)}/day and stay on track.`);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-extrabold text-foreground">Cashflow</h2>

      <HeroCard
        primaryMetric={formatCurrency(safeToSpend.safeToSpend, baseCurrency)}
        subtitle="What can I safely spend right now?"
        tooltip="Average weekly variable spend (8 wk) minus what you've already spent this week"
        chips={[
          { label: 'Spent this week', value: formatCurrency(safeToSpend.spentThisWeek, baseCurrency) },
          { label: 'Weekly baseline', value: formatCurrency(safeToSpend.weeklyBaseline, baseCurrency) },
        ]}
        accentColor="primary"
      />

      <NextMoveBox items={nextMovItems} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Net This Month"
          value={formatCurrency(netThisMonth, baseCurrency)}
          icon={Wallet}
          valueClassName={netThisMonth >= 0 ? 'text-success' : 'text-destructive'}
        />
        <MetricCard label="Variable MTD" value={formatCurrency(thisMonth.variableSpend, baseCurrency)} />
        <MetricCard label="Fixed MTD" value={formatCurrency(fixedMTD, baseCurrency)} />
      </div>
    </div>
  );
}
