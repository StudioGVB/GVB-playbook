import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  computeSavingsRate,
  formatCurrency,
} from '@/lib/financeUtils';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { HeroCard } from './HeroCard';
import { NextMoveBox } from './NextMoveBox';
import { EmptyFinanceState } from './EmptyFinanceState';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData>; onSyncClick?: () => void };

function formatRunway(weeks: number): string {
  if (!isFinite(weeks)) return '∞';
  const months = weeks / 4.33;
  if (months >= 1) return `${Math.floor(months)}mo ${Math.round((months % 1) * 4.33)}w`;
  return `${Math.round(weeks)} weeks`;
}

export default function WealthDashboard({ finance, onSyncClick }: Props) {
  const { transactions, categories, settings, totalCashByCurrency, totalCashBase } = finance;
  const baseCurrency = settings?.base_currency || 'AUD';
  const cashByCurrency = totalCashByCurrency();
  const cashBase = totalCashBase();

  // Policy engine for unified runway
  const { assumptions } = useFinanceAssumptions();
  const { monthlyTotal: fixedExpensesMonthly } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap } = useWeekTypes();
  const wtMap = useMemo(() => weekTypeMap(), [weekTypeMap]);

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions, finance.accounts, transactions,
      categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, totalBoostThisWeek, wtMap,
    );
  }, [assumptions, finance.accounts, transactions, categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, totalBoostThisWeek, wtMap]);

  // 3-month rolling savings rate instead of single-month
  const savingsRate = useMemo(() => computeSavingsRate(transactions, categories, 3), [transactions, categories]);

  const runwayWeeks = snapshot?.runwayWeeks ?? Infinity;
  const runwayMonths = runwayWeeks / 4.33;

  const annualSavingsEstimate = useMemo(() => {
    if (!snapshot) return 0;
    const monthlyBurn = snapshot.totalWeeklyBurn * 4.33;
    const monthlySurplus = (snapshot.split.monthlyIncome || 0) - monthlyBurn;
    return monthlySurplus * 12;
  }, [snapshot]);

  // Empty state
  if (transactions.length === 0) {
    return <EmptyFinanceState onSyncClick={onSyncClick} />;
  }

  // Next move logic
  const nextMovItems: string[] = [];
  if (!isFinite(runwayMonths)) {
    nextMovItems.push('Infinite runway — you\'re in great shape!');
  } else if (runwayMonths < 3) {
    const requiredCut = snapshot ? Math.max(0, snapshot.totalWeeklyBurn * 4.33 - (snapshot.livingPool / 6)) : 0;
    nextMovItems.push(`Runway is tight — reduce variable spend by ${formatCurrency(requiredCut, baseCurrency)}/mo to extend runway.`);
  } else if (runwayMonths < 6) {
    nextMovItems.push('Solid runway — keep burn stable and review monthly.');
  } else {
    nextMovItems.push('You\'re comfy — consider setting a savings target to accelerate growth.');
  }

  return (
    <div className="space-y-4">
      {/* Hero Card */}
      <HeroCard
        primaryMetric={formatRunway(runwayWeeks)}
        subtitle="How long am I safe for?"
        tooltip="Living pool ÷ weekly burn (excludes emergency fund & goal reserves)"
        chips={[
          { label: 'Weekly burn', value: snapshot ? formatCurrency(snapshot.totalWeeklyBurn * 4.33, baseCurrency) + '/mo' : '—' },
          { label: 'Living pool', value: snapshot ? formatCurrency(snapshot.livingPool, baseCurrency) : formatCurrency(cashBase, baseCurrency) },
        ]}
        accentColor={runwayMonths >= 6 ? 'success' : runwayMonths >= 3 ? 'accent' : 'primary'}
      />

      {/* Next Move */}
      <NextMoveBox items={nextMovItems} />

      {/* Supporting metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Savings Rate</p>
            <p className={`text-lg font-bold mt-1 ${savingsRate >= 0 ? 'text-[hsl(var(--success))]' : 'text-destructive'}`}>
              {savingsRate.toFixed(0)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Est. Annual Savings</p>
            <p className={`text-lg font-bold mt-1 ${annualSavingsEstimate >= 0 ? 'text-[hsl(var(--success))]' : 'text-destructive'}`}>
              {formatCurrency(annualSavingsEstimate, baseCurrency)}
            </p>
          </CardContent>
        </Card>

        {Object.entries(cashByCurrency).map(([cur, amount]) => (
          <Card key={cur}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{cur} Cash</p>
              <p className="text-lg font-bold mt-1">{formatCurrency(amount, cur)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground/50 text-center italic">Zoomed out view.</p>
    </div>
  );
}
