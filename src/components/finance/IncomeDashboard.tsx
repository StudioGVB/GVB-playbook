import { useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp, DollarSign, Activity, Zap, Tag, X, ChevronDown, ChevronRight } from 'lucide-react';
import {
  computeRollingIncomeAvg,
  computeIncomeBySource,
  computeIncomeGrowth,
  computeIncomeVolatility,
  computeMonthlyIncomeBySource,
  formatCurrency,
  filterTxByDays,
  extractSourceKey,
} from '@/lib/financeUtils';
import { TimeRangeFilter, useTimeRange, getTimeRangeDays, getTimeRangeMonths } from './TimeRangeFilter';
import { HeroCard } from './HeroCard';
import { NextMoveBox } from './NextMoveBox';
import { MetricCard } from './MetricCard';
import { SectionCard } from './SectionCard';
import { EmptyFinanceState } from './EmptyFinanceState';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { toast } from 'sonner';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData>; onSyncClick?: () => void };

const SOURCE_COLORS = [
  'hsl(320, 100%, 59%)',
  'hsl(262, 100%, 65%)',
  'hsl(227, 100%, 59%)',
  'hsl(145, 63%, 42%)',
  'hsl(38, 100%, 56%)',
  'hsl(3, 72%, 60%)',
  'hsl(180, 60%, 45%)',
  'hsl(20, 80%, 55%)',
];

interface GroupedSource {
  groupName: string;
  sourceKeys: string[];
  total: number;
  count: number;
  pct: number;
  isTagged: boolean;
}

export default function IncomeDashboard({ finance, onSyncClick }: Props) {
  const { transactions, categories, settings, incomeSourceTags, addIncomeSourceTag, deleteIncomeSourceTag } = finance;
  const baseCurrency = settings?.base_currency || 'AUD';
  const { range, setRange } = useTimeRange('30d');
  const days = getTimeRangeDays(range);
  const months = getTimeRangeMonths(range);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const incomeAvg = useMemo(() => computeRollingIncomeAvg(transactions, categories, months), [transactions, categories, months]);
  const { sources, total } = useMemo(() => computeIncomeBySource(transactions, days), [transactions, days]);
  const growth = useMemo(() => computeIncomeGrowth(transactions, days), [transactions, days]);
  const volatility = useMemo(() => computeIncomeVolatility(transactions, categories), [transactions, categories]);
  const monthlyIncome = useMemo(() => computeMonthlyIncomeBySource(transactions, months), [transactions, months]);
  const avgMonthlyIncome = useMemo(() => {
    const m = Math.max(1, months);
    return total / m;
  }, [total, months]);

  // Build tag lookup: source_key → group_name
  const tagMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tag of incomeSourceTags) {
      map[tag.source_key] = tag.group_name;
    }
    return map;
  }, [incomeSourceTags]);

  // Group sources by tag
  const groupedSources = useMemo(() => {
    const groups: Record<string, { sourceKeys: string[]; total: number; count: number; isTagged: boolean }> = {};

    for (const src of sources) {
      const groupName = tagMap[src.key] || src.key;
      const isTagged = !!tagMap[src.key];
      if (!groups[groupName]) {
        groups[groupName] = { sourceKeys: [], total: 0, count: 0, isTagged };
      }
      groups[groupName].sourceKeys.push(src.key);
      groups[groupName].total += src.total;
      groups[groupName].count += src.count;
      if (isTagged) groups[groupName].isTagged = true;
    }

    const result: GroupedSource[] = Object.entries(groups)
      .map(([groupName, data]) => ({
        groupName,
        sourceKeys: data.sourceKeys,
        total: data.total,
        count: data.count,
        pct: total > 0 ? (data.total / total) * 100 : 0,
        isTagged: data.isTagged,
      }))
      .sort((a, b) => b.total - a.total);

    return result;
  }, [sources, tagMap, total]);

  // Group monthly income by tags too
  const groupedMonthlyIncome = useMemo(() => {
    return monthlyIncome.map(m => {
      const grouped: Record<string, number> = {};
      for (const [key, val] of Object.entries(m.sources)) {
        const groupName = tagMap[key] || key;
        grouped[groupName] = (grouped[groupName] || 0) + val;
      }
      return { month: m.month, sources: grouped, total: m.total };
    });
  }, [monthlyIncome, tagMap]);

  const topSource = groupedSources[0];
  const concentrationRisk = topSource && topSource.pct > 60;

  if (transactions.filter(tx => tx.amount > 0 && !tx.is_transfer).length === 0) {
    return <EmptyFinanceState onSyncClick={onSyncClick} />;
  }

  const nextMoves: string[] = [];
  if (concentrationRisk) {
    nextMoves.push(`${topSource.pct.toFixed(0)}% of income from ${topSource.groupName} — high concentration risk.`);
  }
  if (volatility > 30) {
    nextMoves.push(`Income volatility is ${volatility.toFixed(0)}% — consider building a larger buffer.`);
  }
  if (growth > 10) {
    nextMoves.push(`Income growing ${growth.toFixed(0)}% — momentum is positive.`);
  } else if (growth < -10) {
    nextMoves.push(`Income declined ${Math.abs(growth).toFixed(0)}% — review your income streams.`);
  }

  const topGroupKeys = groupedSources.slice(0, 5).map(s => s.groupName);
  const chartData = groupedMonthlyIncome.map(m => {
    const row: Record<string, string | number> = { month: m.month };
    for (const key of topGroupKeys) {
      row[key] = m.sources[key] || 0;
    }
    const otherTotal = Object.entries(m.sources)
      .filter(([k]) => !topGroupKeys.includes(k))
      .reduce((s, [, v]) => s + v, 0);
    if (otherTotal > 0) row['Other'] = otherTotal;
    return row;
  });
  const allBarKeys = [...topGroupKeys];
  if (chartData.some(d => (d['Other'] as number) > 0)) allBarKeys.push('Other');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-extrabold text-foreground">Income</h2>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      <HeroCard
        primaryMetric={formatCurrency(total, baseCurrency)}
        subtitle={`Total income — last ${range === '7d' ? '7 days' : range === '30d' ? '30 days' : range === '3m' ? '3 months' : range === '6m' ? '6 months' : '12 months'}`}
        secondaryLine={`Avg monthly income: ${formatCurrency(avgMonthlyIncome, baseCurrency)}`}
        tooltip={`Total income for the selected period (excl. transfers)`}
        chips={[
          { label: 'Growth', value: `${growth >= 0 ? '+' : ''}${growth.toFixed(0)}%` },
          { label: 'Volatility', value: `${volatility.toFixed(0)}%` },
        ]}
        accentColor="success"
      />

      {concentrationRisk && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning/8 border border-warning/20">
          <AlertTriangle className="w-5 h-5 text-[hsl(var(--warning))] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground">
            <span className="font-bold">{topSource.pct.toFixed(0)}%</span> of income from{' '}
            <span className="font-bold">{topSource.groupName}</span>. High concentration risk.
          </p>
        </div>
      )}

      <NextMoveBox items={nextMoves} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={`Total (${range})`} value={formatCurrency(total, baseCurrency)} icon={DollarSign} valueClassName="text-success" />
        <MetricCard label="Sources" value={String(groupedSources.length)} icon={Activity} />
        <MetricCard label="Top Stream" value={topSource?.groupName || 'N/A'} icon={Zap} />
        <MetricCard label="Top %" value={`${topSource?.pct.toFixed(0) || 0}%`} icon={TrendingUp} />
      </div>

      {/* Income Chart */}
      <SectionCard title="Income by Source">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={50}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              />
              <RechartsTooltip
                formatter={(value: number) => formatCurrency(value, baseCurrency)}
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid hsl(300 10% 90%)' }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {allBarKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="income"
                  fill={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                  radius={i === allBarKeys.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* Source Breakdown - grouped by tags */}
      <SectionCard title="Income Sources" titleRight={<span className="text-[10px] text-muted-foreground font-normal normal-case tracking-normal">Tag sources to group under a business</span>}>
        <div className="space-y-1">
          {groupedSources.slice(0, 15).map((group, i) => {
            const maxTotal = groupedSources[0]?.total || 1;
            const pct = (group.total / maxTotal) * 100;
            const isExpanded = expandedGroup === group.groupName;
            const hasMultipleSources = group.sourceKeys.length > 1;

            return (
              <div key={group.groupName}>
                <div className="flex items-center gap-3 py-1.5">
                  {/* Expand toggle for tagged groups */}
                  {hasMultipleSources ? (
                    <button onClick={() => setExpandedGroup(isExpanded ? null : group.groupName)} className="w-4 shrink-0">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="text-xs text-foreground w-32 truncate font-medium">
                    {group.groupName}
                  </span>
                  <div className="flex-1 h-4 bg-muted/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
                    />
                  </div>
                  <span className="text-xs font-bold w-24 text-right">{formatCurrency(group.total, baseCurrency)}</span>
                  <span className="text-xs text-muted-foreground w-10 text-right">{group.pct.toFixed(0)}%</span>
                  
                  {/* Tag button */}
                  {!group.isTagged && (
                    <SourceTagPopover
                      sourceKey={group.sourceKeys[0]}
                      existingGroups={[...new Set(incomeSourceTags.map(t => t.group_name))]}
                      onTag={(groupName) => addIncomeSourceTag(group.sourceKeys[0], groupName)}
                    />
                  )}
                  {group.isTagged && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground shrink-0">
                      tagged
                    </Badge>
                  )}
                </div>

                {/* Expanded: show individual sources within this group */}
                {isExpanded && hasMultipleSources && (
                  <div className="ml-8 mb-2 space-y-0.5 border-l-2 border-muted pl-3">
                    {group.sourceKeys.map(sk => {
                      const src = sources.find(s => s.key === sk);
                      if (!src) return null;
                      const tag = incomeSourceTags.find(t => t.source_key === sk);
                      return (
                        <div key={sk} className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                          <span className="w-28 truncate">{src.label}</span>
                          <span className="font-medium text-foreground">{formatCurrency(src.total, baseCurrency)}</span>
                          {tag && (
                            <button
                              onClick={() => deleteIncomeSourceTag(tag.id)}
                              className="ml-auto hover:text-destructive"
                              title="Remove tag"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

/** Popover to tag a source to a group name */
function SourceTagPopover({
  sourceKey,
  existingGroups,
  onTag,
}: {
  sourceKey: string;
  existingGroups: string[];
  onTag: (groupName: string) => void;
}) {
  const [customName, setCustomName] = useState('');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="shrink-0">
          <Tag className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-foreground cursor-pointer" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="end">
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5 px-1">
          Tag "{sourceKey}" to a business
        </p>
        {existingGroups.length > 0 && (
          <div className="space-y-0.5 mb-2 max-h-32 overflow-y-auto">
            {existingGroups.map(name => (
              <button
                key={name}
                onClick={() => onTag(name)}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 transition-colors"
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <Input
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            placeholder="New business name..."
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs px-2 shrink-0"
            disabled={!customName.trim()}
            onClick={() => {
              onTag(customName.trim());
              setCustomName('');
            }}
          >
            Add
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
