import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PieChart as PieChartIcon } from 'lucide-react';
import { PieChart as RechartsPieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';
import { formatCurrency } from '@/lib/financeUtils';
import { startOfDay } from 'date-fns';

interface TripCategoryBreakdownProps {
  tripId: string;
  startDate?: string | null;
  endDate?: string | null;
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  className?: string;
}

const FALLBACK_COLORS = [
  '#06B6D4', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6',
  '#3B82F6', '#EF4444', '#F97316', '#6366F1', '#84CC16',
];

export function TripCategoryBreakdown({
  tripId, startDate, endDate, transactions, categories, className,
}: TripCategoryBreakdownProps) {
  const fmt = (n: number) => formatCurrency(n, 'AUD');

  const data = useMemo(() => {
    const start = startDate ? startOfDay(new Date(startDate)) : null;
    const end = endDate ? startOfDay(new Date(endDate)) : null;

    const tripTxs = transactions.filter(tx => {
      if (tx.is_transfer || tx.amount >= 0) return false;
      if ((tx as any).trip_id === tripId) return true;
      if (start && end) {
        const d = startOfDay(new Date(tx.posted_at));
        return d >= start && d <= end;
      }
      return false;
    });

    const totals = new Map<string, { name: string; color: string; amount: number; count: number }>();

    for (const tx of tripTxs) {
      const cat = tx.category_id ? categories.find(c => c.id === tx.category_id) : null;
      let name = cat?.name || 'Uncategorized';
      let color = cat?.color;

      // Smart description inference if uncategorized
      if (!cat) {
        const desc = (tx.description || '').toLowerCase();
        if (desc.includes('hotel') || desc.includes('booking.com') || desc.includes('airbnb') || desc.includes('hostel')) {
          name = 'Hotels / Stay';
          color = '#06B6D4';
        } else if (desc.includes('flight') || desc.includes('ryanair') || desc.includes('easyjet') || desc.includes('qantas') || desc.includes('virgin') || desc.includes('airline')) {
          name = 'Flights';
          color = '#3B82F6';
        } else if (desc.includes('uber') || desc.includes('taxi') || desc.includes('bolt') || desc.includes('train') || desc.includes('tfl')) {
          name = 'Transport';
          color = '#6366F1';
        } else if (desc.includes('restaurant') || desc.includes('cafe') || desc.includes('pub') || desc.includes('bar') || desc.includes('coffee') || desc.includes('eat')) {
          name = 'Food & Drink';
          color = '#F97316';
        }
      }

      const key = name;
      const existing = totals.get(key);
      if (existing) {
        existing.amount += Math.abs(tx.amount);
        existing.count += 1;
      } else {
        totals.set(key, {
          name,
          color: color || FALLBACK_COLORS[totals.size % FALLBACK_COLORS.length],
          amount: Math.abs(tx.amount),
          count: 1,
        });
      }
    }

    const rows = Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return { rows, total };
  }, [tripId, startDate, endDate, transactions, categories]);

  if (data.rows.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <PieChartIcon className="w-3.5 h-3.5" /> Category Breakdown
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            No spending recorded for this trip yet. Log expenses or tag transactions to see your pie breakdown.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <PieChartIcon className="w-3.5 h-3.5 text-sky-500" /> Spending Breakdown
          </p>
          <Badge variant="secondary" className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-300">
            {fmt(data.total)} total
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Donut Chart */}
          <div className="md:col-span-5 relative h-52 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Pie
                  data={data.rows}
                  dataKey="amount"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={3}
                >
                  {data.rows.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [fmt(value), 'Spent']}
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
              </RechartsPieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-black tabular-nums">{fmt(data.total)}</span>
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Total</span>
            </div>
          </div>

          {/* Category List */}
          <div className="md:col-span-7 space-y-2.5">
            {data.rows.map(r => {
              const pct = (r.amount / data.total) * 100;
              return (
                <div key={r.name} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="font-semibold truncate text-xs sm:text-sm">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      ({r.count} tx)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-right">
                    <span className="text-xs text-muted-foreground font-medium tabular-nums">{pct.toFixed(0)}%</span>
                    <span className="font-bold tabular-nums text-sm w-20 text-right">{fmt(r.amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

