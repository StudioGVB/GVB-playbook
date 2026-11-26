import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from 'recharts';
import {
  BarChart3,
  Sparkles,
  Lock,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/financeUtils';
import {
  computeMonthlyPotSchedule,
  type MonthSeriesPoint,
} from '@/lib/potPacingEngine';
import type { FinanceGoal, FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';

interface Props {
  goals: FinanceGoal[];
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  trips?: FinanceTrip[];
  convertToBase: (amount: number, currency: string) => number;
  baseCurrency: string;
  monthlyPotCapacity?: number;
  onSelectGoalExpenses?: (goal: FinanceGoal) => void;
}

export default function MonthlyPotBreakdownCard({
  goals,
  transactions,
  categories,
  convertToBase,
  baseCurrency,
  monthlyPotCapacity = 0,
}: Props) {
  const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const fmt = (n: number) => formatCurrency(n, baseCurrency);
  const fmtCompact = (n: number) => {
    if (n <= 0) return '';
    return formatCurrency(Math.round(n), baseCurrency).replace(/\.00$/, '');
  };

  const { activeGoalMetas, chartData, fixedCount, dynamicCount } = useMemo(() => {
    const schedule = computeMonthlyPotSchedule({
      goals,
      transactions,
      categories,
      convertToBase,
    });

    const withLabels = schedule.months.map(m => ({
      ...m,
      totalLabel: m.total > 0 ? fmtCompact(m.total) : '',
    }));

    return {
      activeGoalMetas: schedule.activeGoalMetas,
      chartData: withLabels,
      fixedCount: schedule.fixedCount,
      dynamicCount: schedule.dynamicCount,
    };
  }, [goals, transactions, categories, convertToBase, baseCurrency]);

  // Default selected month to Next Month (e.g. Dec) if available, otherwise Current Month
  const activeSelectedMonth = useMemo(() => {
    if (selectedMonthKey) {
      const found = chartData.find(m => m.monthKey === selectedMonthKey);
      if (found) return found;
    }
    return chartData.find(m => m.isNextMonth && m.total > 0) || chartData[0] || null;
  }, [chartData, selectedMonthKey]);

  const displayedGoalMetas = useMemo(() => {
    if (!focusedGoalId) return activeGoalMetas;
    return activeGoalMetas.filter(m => m.goal.id === focusedGoalId);
  }, [activeGoalMetas, focusedGoalId]);

  // Custom Tooltip for the Stacked Bar Chart
  const renderCustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const monthPoint: MonthSeriesPoint & { totalLabel?: string } = payload[0]?.payload;
    if (!monthPoint) return null;

    const items = monthPoint.contributions.filter(
      c => !focusedGoalId || c.goal.id === focusedGoalId
    );
    const monthTotal = items.reduce((s, c) => s + c.amount, 0);

    return (
      <div className="bg-white/95 backdrop-blur-md border-2 border-slate-200 rounded-2xl p-3.5 shadow-xl min-w-[270px] max-w-[350px] font-body">
        <div className="flex items-center justify-between gap-3 pb-2 mb-2 border-b border-slate-100">
          <div>
            <p className="text-xs font-display font-black text-slate-900">
              {monthPoint.monthLabel}
            </p>
            <p className="text-[10px] text-slate-500 font-medium">
              ≈ {fmt(monthTotal / 4.33)}/wk across {items.length} {items.length === 1 ? 'pot' : 'pots'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF2EB8] block">
              Total to Pots
            </span>
            <span className="text-sm font-display font-black text-slate-900 tabular-nums">
              {fmt(monthTotal)}
            </span>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No pot contributions scheduled</p>
        ) : (
          <div className="space-y-1.5">
            {items.map(item => (
              <div key={item.goal.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-semibold text-slate-800 truncate">
                    {item.goal.name}
                  </span>
                  {item.pacingMode === 'fixed' ? (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0"
                      title="Fixed monthly rate set on this pot tile"
                    >
                      📏 Fixed
                    </span>
                  ) : item.isBoosted ? (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0 rounded bg-amber-50 text-amber-800 border border-amber-200 shrink-0"
                      title="Dynamic pot ramped up this month because earlier pots finished"
                    >
                      ⚡ Ramped up
                    </span>
                  ) : (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0 rounded bg-pink-50 text-[#FF2EB8] border border-pink-200 shrink-0"
                      title="Dynamic pot calculated over the top of fixed pots"
                    >
                      ✨ Dynamic
                    </span>
                  )}
                  {item.startsThisMonth && (
                    <span className="text-[9px] font-bold px-1.5 py-0 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                      Starts
                    </span>
                  )}
                  {item.endsThisMonth && (
                    <span className="text-[9px] font-bold px-1.5 py-0 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      Due
                    </span>
                  )}
                </div>
                <span className="font-bold text-slate-900 tabular-nums shrink-0">
                  {fmt(item.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[6px_6px_0px_0px_rgba(255,46,184,0.1)] overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0F9FF] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="bg-[#FF2EB8] text-white p-1.5 rounded-xl">
                <BarChart3 className="w-4 h-4" />
              </span>
              <span className="text-[#FF2EB8] font-display font-bold uppercase tracking-wider text-xs">
                Monthly Pot Roadmap • Stacked Forecast
              </span>
              <Badge
                variant="outline"
                className="text-[10px] px-2 py-0.5 border-slate-200 bg-white text-slate-700 font-bold"
              >
                📏 {fixedCount} Fixed • ✨ {dynamicCount} Dynamic (Controlled on each tile)
              </Badge>
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900">
              Monthly Pot Contributions Breakdown
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Fixed monthly pots lock in their steady base rate first, and Dynamic pots automatically calculate over the top—putting more towards later goals as earlier pots finish. Toggle <strong>Saving Pace</strong> on any pot tile above to customize.
            </p>
          </div>

          {focusedGoalId && (
            <button
              type="button"
              onClick={() => setFocusedGoalId(null)}
              className="self-start lg:self-center text-xs font-display font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            >
              Show All Pots ✕
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Stacked Bar Chart */}
        {activeGoalMetas.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            All your active goal pots are currently 100% funded! 🎉
          </div>
        ) : (
          <div className="h-[340px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 28, right: 16, left: 4, bottom: 8 }}
                onClick={(state: any) => {
                  if (state?.activePayload?.[0]?.payload?.monthKey) {
                    setSelectedMonthKey(state.activePayload[0].payload.monthKey);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="shortLabel"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#334155', fontSize: 12, fontWeight: 700 }}
                  dy={6}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  tickFormatter={(val: number) => fmtCompact(val) || '£0'}
                  width={56}
                />
                <Tooltip
                  content={renderCustomTooltip}
                  cursor={{ fill: 'rgba(255, 46, 184, 0.05)', radius: 12 }}
                />

                {monthlyPotCapacity > 0 && (
                  <ReferenceLine
                    y={monthlyPotCapacity}
                    stroke="#10b981"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    label={{
                      value: `Monthly Pot Capacity (${fmtCompact(monthlyPotCapacity)})`,
                      position: 'insideTopRight',
                      fill: '#059669',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  />
                )}

                {displayedGoalMetas.map((meta, idx) => {
                  const isTopBar = idx === displayedGoalMetas.length - 1;
                  return (
                    <Bar
                      key={meta.goal.id}
                      dataKey={meta.goal.id}
                      name={meta.goal.name}
                      stackId="pots"
                      fill={meta.color}
                      maxBarSize={64}
                      radius={isTopBar ? [8, 8, 0, 0] : [0, 0, 0, 0]}
                      className="cursor-pointer transition-opacity"
                    >
                      {isTopBar && !focusedGoalId && (
                        <LabelList
                          dataKey="totalLabel"
                          position="top"
                          style={{
                            fill: '#0f172a',
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        />
                      )}
                    </Bar>
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Interactive Legend: Active Pots & Their Start -> End Windows */}
        {activeGoalMetas.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-display font-bold uppercase tracking-wider text-slate-500">
                Active Pots in Chart (Click to Isolate)
              </span>
              <span className="text-[11px] text-slate-400">
                Click any bar above to view that month’s breakdown
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeGoalMetas.map(meta => {
                const isFocused = focusedGoalId === meta.goal.id;
                const isDimmed = focusedGoalId !== null && !isFocused;
                const startText =
                  meta.rawStart && meta.rawStart > new Date()
                    ? `Starts ${format(meta.rawStart, 'MMM d')}`
                    : 'Active now';
                const endText = meta.rawDeadline
                  ? `Due ${format(meta.rawDeadline, 'MMM d')}`
                  : 'Ongoing';

                return (
                  <button
                    key={meta.goal.id}
                    type="button"
                    onClick={() =>
                      setFocusedGoalId(prev => (prev === meta.goal.id ? null : meta.goal.id))
                    }
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                      isFocused
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm scale-[1.02]'
                        : isDimmed
                        ? 'bg-slate-50 text-slate-400 border-slate-200 opacity-50 hover:opacity-80'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-md shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="font-bold">{meta.goal.name}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        isFocused
                          ? 'bg-white/15 text-white'
                          : meta.pacingMode === 'fixed'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-pink-50 text-[#FF2EB8]'
                      }`}
                    >
                      {meta.pacingMode === 'fixed' ? '📏 Fixed' : '✨ Dynamic'}
                    </span>
                    <span
                      className={`text-[10px] font-medium ${
                        isFocused ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      ({startText} → {endText} • {fmt(meta.remainingToSaveBase)} left)
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected Month Detailed Breakdown Box */}
        {activeSelectedMonth && (
          <div className="rounded-2xl bg-gradient-to-r from-[#FFF9FC] via-white to-indigo-50/40 border-2 border-[#FF7AD1]/35 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-[#FF2EB8] text-white font-display font-bold text-xs px-2.5 py-0.5">
                  {activeSelectedMonth.monthLabel}
                </Badge>
                <span className="text-xs text-slate-600 font-semibold">
                  You will be putting{' '}
                  <strong className="text-slate-900 font-black">
                    {fmt(activeSelectedMonth.total)}
                  </strong>{' '}
                  towards your pots ({fmt(activeSelectedMonth.total / 4.33)}/wk)
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                {activeSelectedMonth.fixedTotal > 0 && (
                  <>📏 {fmt(activeSelectedMonth.fixedTotal)} fixed • </>
                )}
                ✨ {fmt(activeSelectedMonth.dynamicTotal)} dynamic
              </span>
            </div>

            {activeSelectedMonth.contributions.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2">
                No pot contributions needed in {activeSelectedMonth.monthLabel}.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {activeSelectedMonth.contributions.map(c => {
                  const pctOfMonth =
                    activeSelectedMonth.total > 0
                      ? Math.round((c.amount / activeSelectedMonth.total) * 100)
                      : 0;
                  const afterPct =
                    c.targetBase > 0
                      ? Math.min(100, Math.round((c.projectedFundedAfterMonth / c.targetBase) * 100))
                      : 0;

                  return (
                    <div
                      key={c.goal.id}
                      className="rounded-xl bg-white border border-slate-200/80 p-3 flex flex-col justify-between gap-2 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-md shrink-0"
                            style={{ backgroundColor: c.color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {c.goal.name}
                              </span>
                              {c.pacingMode === 'fixed' ? (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-slate-200 text-slate-700 bg-slate-50 font-bold"
                                >
                                  📏 Fixed
                                </Badge>
                              ) : c.isBoosted ? (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-amber-200 text-amber-800 bg-amber-50 font-bold"
                                  title="Ramped up this month because earlier pots finished"
                                >
                                  ⚡ Ramped up
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-pink-200 text-[#FF2EB8] bg-pink-50 font-bold"
                                >
                                  ✨ Dynamic
                                </Badge>
                              )}
                              {c.startsThisMonth && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-indigo-200 text-indigo-700 bg-indigo-50 font-bold"
                                >
                                  Starts {format(new Date(String(c.goal.start_date).split('T')[0] + 'T00:00:00'), 'MMM d')}
                                </Badge>
                              )}
                              {c.endsThisMonth && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 border-emerald-200 text-emerald-700 bg-emerald-50 font-bold"
                                >
                                  Finishes {format(new Date(String(c.goal.deadline).split('T')[0] + 'T00:00:00'), 'MMM d')}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-display font-black text-slate-900 tabular-nums">
                            +{fmt(c.amount)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-semibold block">
                            {pctOfMonth}% of month
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                        <span>{fmt(c.weeklyPaceInMonth)}/wk pace</span>
                        <span className="font-semibold text-slate-700">
                          Reaches {fmt(c.projectedFundedAfterMonth)} ({afterPct}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
