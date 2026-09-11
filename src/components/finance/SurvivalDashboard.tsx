import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Shield, TrendingDown, Calculator, Plus, Flame, Banknote, Wallet } from 'lucide-react';
import {
  computeRollingBurnRate,
  computeRollingIncomeAvg,
  computeFreeCashFlow,
  computeMonthlyHistory,
  formatCurrency,
} from '@/lib/financeUtils';
import { computePolicySnapshot, PolicySnapshot } from '@/lib/policyEngine';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { TimeRangeFilter, useTimeRange, getTimeRangeMonths } from './TimeRangeFilter';
import { HeroCard } from './HeroCard';
import { NextMoveBox } from './NextMoveBox';
import { MetricCard } from './MetricCard';
import { SectionCard } from './SectionCard';
import { HealthBadge } from './HealthBadge';
import { EmptyFinanceState } from './EmptyFinanceState';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData>; onSyncClick?: () => void };

function runwayLabel(months: number): string {
  if (!isFinite(months)) return '∞';
  if (months >= 1) return `${Math.floor(months)}mo ${Math.round((months % 1) * 4.33)}w`;
  return `${Math.round(months * 4.33)} weeks`;
}

function runwayStatus(months: number): 'safe' | 'caution' | 'danger' {
  if (!isFinite(months) || months >= 6) return 'safe';
  if (months >= 3) return 'caution';
  return 'danger';
}

const STATUS_COLORS = {
  safe: 'hsl(145, 63%, 42%)',
  caution: 'hsl(38, 100%, 56%)',
  danger: 'hsl(3, 72%, 60%)',
};

export default function SurvivalDashboard({ finance, onSyncClick }: Props) {
  const { transactions, categories, settings, totalCashBase } = finance;
  const baseCurrency = settings?.base_currency || 'AUD';
  const cashBase = totalCashBase();
  const { range, setRange } = useTimeRange('3m');
  const months = getTimeRangeMonths(range);

  // Policy engine for unified runwayMonths
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
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

  const burn = useMemo(() => computeRollingBurnRate(transactions, categories, months), [transactions, categories, months]);
  const incomeAvg = useMemo(() => computeRollingIncomeAvg(transactions, categories, months), [transactions, categories, months]);
  const fcf = useMemo(() => computeFreeCashFlow(transactions, categories, months), [transactions, categories, months]);
  const history = useMemo(() => computeMonthlyHistory(transactions, categories, Math.max(months, 6)), [transactions, categories, months]);

  // Use PolicySnapshot runwayMonths if available, fallback to simple calc
  const runwayMonths = snapshot
    ? (snapshot.runwayWeeks / 4.33)
    : (burn.avg > 0 ? cashBase / burn.avg : Infinity);
  const emergencyBuffer = snapshot ? snapshot.emergencyFloor : burn.avg * 3;
  const status = runwayStatus(runwayMonths);

  // Simulator
  const [simCost, setSimCost] = useState('');
  const [simRecurring, setSimRecurring] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [simIncome, setSimIncome] = useState('');
  const [simRecurringIncome, setSimRecurringIncome] = useState('');
  const [isRecurringIncome, setIsRecurringIncome] = useState(false);

  const simResult = useMemo(() => {
    const cost = parseFloat(simCost) || 0;
    const recurring = isRecurring ? (parseFloat(simRecurring) || 0) : 0;
    const oneTimeIncome = parseFloat(simIncome) || 0;
    const recurringInc = isRecurringIncome ? (parseFloat(simRecurringIncome) || 0) : 0;
    if (cost === 0 && recurring === 0 && oneTimeIncome === 0 && recurringInc === 0) return null;
    const adjustedCash = cashBase - cost + oneTimeIncome;
    const adjustedBurn = burn.avg + recurring;
    const adjustedIncome = incomeAvg.avg + recurringInc;
    const newRunway = adjustedBurn > 0 ? adjustedCash / adjustedBurn : Infinity;
    const currentRunway = burn.avg > 0 ? cashBase / burn.avg : Infinity;
    const surplus = adjustedIncome - adjustedBurn;
    const surplusConsumedPct = surplus > 0 && recurring > 0 ? (recurring / (incomeAvg.avg - burn.avg)) * 100 : 0;
    return {
      currentRunway: isFinite(currentRunway) ? currentRunway : 999,
      newRunway: isFinite(newRunway) ? newRunway : 999,
      monthsLost: isFinite(currentRunway) && isFinite(newRunway) ? currentRunway - newRunway : 0,
      surplusConsumedPct: isFinite(surplusConsumedPct) ? surplusConsumedPct : 0,
      bufferSafe: newRunway >= 3,
      newBufferMonths: isFinite(newRunway) ? newRunway : 999,
      newFcf: surplus,
    };
  }, [simCost, simRecurring, isRecurring, simIncome, simRecurringIncome, isRecurringIncome, cashBase, burn.avg, incomeAvg.avg]);

  if (transactions.length === 0) {
    return <EmptyFinanceState onSyncClick={onSyncClick} />;
  }

  const nextMoves: string[] = [];
  if (runwayMonths < 3) {
    nextMoves.push(`Build ${formatCurrency(emergencyBuffer - cashBase, baseCurrency)} more to reach 3-month safety buffer.`);
  } else if (runwayMonths < 6) {
    nextMoves.push('Runway is okay but not comfortable — keep burn stable.');
  } else {
    nextMoves.push('Strong position — focus on growth or savings goals.');
  }
  if (fcf < 0) {
    nextMoves.push(`Negative free cash flow (${formatCurrency(fcf, baseCurrency)}/mo) — spending exceeds income.`);
  }

  const dataLabel = burn.monthsUsed < months ? ` (${burn.monthsUsed}mo data)` : '';

  const chartData = history.map(m => ({
    month: m.month.split(' ')[0],
    burn: m.totalSpend,
    income: m.income,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-extrabold text-foreground">Survival</h2>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      {/* Hero: Runway */}
      <HeroCard
        primaryMetric={
          <span style={{ color: STATUS_COLORS[status] }}>{runwayLabel(runwayMonths)}</span>
        }
        subtitle="How long am I safe for?"
        tooltip={snapshot ? 'Living pool ÷ weekly burn (excludes emergency fund & goal reserves)' : `Total cash ÷ ${months}-month avg burn rate${dataLabel}`}
        chips={[
          { label: 'Weekly burn', value: snapshot ? `${formatCurrency(snapshot.totalWeeklyBurn * 4.33, baseCurrency)}/mo` : `${formatCurrency(burn.avg, baseCurrency)}/mo` },
          { label: 'Living pool', value: snapshot ? formatCurrency(snapshot.livingPool, baseCurrency) : formatCurrency(cashBase, baseCurrency) },
        ]}
      />

      {/* Buffer Meter */}
      <SectionCard title="Emergency Buffer" titleRight={<HealthBadge status={status} />}>
        <div className="h-4 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.min(100, (runwayMonths / 6) * 100)}%`,
              backgroundColor: STATUS_COLORS[status],
            }}
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-[10px] text-muted-foreground">0</span>
          <span className="text-[10px] text-muted-foreground">3 mo</span>
          <span className="text-[10px] text-muted-foreground">6 mo+</span>
        </div>
      </SectionCard>

      <NextMoveBox items={nextMoves} />

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={`${months}mo Burn`} value={formatCurrency(burn.avg, baseCurrency)} icon={Flame} />
        <MetricCard label={`${months}mo Income`} value={formatCurrency(incomeAvg.avg, baseCurrency)} icon={Banknote} valueClassName="text-success" />
        <MetricCard
          label="Free Cash Flow"
          value={formatCurrency(fcf, baseCurrency)}
          icon={TrendingDown}
          valueClassName={fcf >= 0 ? 'text-success' : 'text-destructive'}
        />
        <MetricCard label="Buffer Target" value={formatCurrency(emergencyBuffer, baseCurrency)} icon={Shield} />
      </div>

      {/* Burn Trend Chart */}
      <SectionCard title="Burn vs Income">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={4}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={50}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              />
              <RechartsTooltip
                formatter={(value: number) => formatCurrency(value, baseCurrency)}
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid hsl(300 10% 90%)' }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="income" name="Income" radius={[6, 6, 0, 0]} fill="hsl(145, 63%, 42%)" opacity={0.8} />
              <Bar dataKey="burn" name="Spend" radius={[6, 6, 0, 0]} fill="hsl(320, 100%, 59%)" opacity={0.5} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* Decision Simulator */}
      <SectionCard title="Can I afford this?" className="border-primary/15">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-4">
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> Expenses
            </p>
            <div>
              <Label className="text-xs text-muted-foreground">One-off cost</Label>
              <Input type="number" placeholder="e.g. 2000" value={simCost} onChange={e => setSimCost(e.target.value)} className="mt-1 rounded-xl" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Switch id="sim-recurring" checked={isRecurring} onCheckedChange={setIsRecurring} />
                <Label htmlFor="sim-recurring" className="text-xs text-muted-foreground cursor-pointer">+ Monthly recurring</Label>
              </div>
              {isRecurring && (
                <Input type="number" placeholder="e.g. 200" value={simRecurring} onChange={e => setSimRecurring(e.target.value)} className="mt-1 rounded-xl" />
              )}
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <Plus className="w-3 h-3" /> Income
            </p>
            <div>
              <Label className="text-xs text-muted-foreground">One-time income</Label>
              <Input type="number" placeholder="e.g. 5000" value={simIncome} onChange={e => setSimIncome(e.target.value)} className="mt-1 rounded-xl" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Switch id="sim-recurring-inc" checked={isRecurringIncome} onCheckedChange={setIsRecurringIncome} />
                <Label htmlFor="sim-recurring-inc" className="text-xs text-muted-foreground cursor-pointer">+ Monthly recurring</Label>
              </div>
              {isRecurringIncome && (
                <Input type="number" placeholder="e.g. 1000" value={simRecurringIncome} onChange={e => setSimRecurringIncome(e.target.value)} className="mt-1 rounded-xl" />
              )}
            </div>
          </div>
        </div>

        {simResult && (
          <div className="bg-muted/30 rounded-2xl p-4 space-y-2.5 border border-border/50">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Runway</span>
              <span className="font-bold">
                {runwayLabel(simResult.currentRunway)} →{' '}
                <span style={{ color: STATUS_COLORS[runwayStatus(simResult.newRunway)] }}>
                  {runwayLabel(simResult.newRunway)}
                </span>
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Months lost</span>
              <span className={`font-bold ${simResult.monthsLost > 0 ? 'text-destructive' : 'text-success'}`}>
                {simResult.monthsLost > 0 ? '+' : ''}{simResult.monthsLost.toFixed(1)}
              </span>
            </div>
            {simResult.newFcf !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">New free cash flow</span>
                <span className={`font-bold ${simResult.newFcf >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(simResult.newFcf, baseCurrency)}/mo
                </span>
              </div>
            )}
            {isRecurring && simResult.surplusConsumedPct > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">% of surplus consumed</span>
                <span className="font-bold">{simResult.surplusConsumedPct.toFixed(0)}%</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Buffer status</span>
              <HealthBadge
                status={simResult.bufferSafe ? 'safe' : 'danger'}
                label={`${simResult.newBufferMonths.toFixed(1)} mo`}
              />
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
