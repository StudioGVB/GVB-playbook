import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PieChart } from 'lucide-react';
import type { FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';
import { formatCurrency } from '@/lib/financeUtils';

interface TripCategoryBreakdownProps {
  tripId: string;
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  className?: string;
}

const FALLBACK_COLORS = [
  '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

export function TripCategoryBreakdown({
  tripId, transactions, categories, className,
}: TripCategoryBreakdownProps) {
  const fmt = (n: number) => formatCurrency(n, 'AUD');

  const data = useMemo(() => {
    const tripTxs = transactions.filter(
      tx => (tx as any).trip_id === tripId && !tx.is_transfer && tx.amount < 0,
    );
    const totals = new Map<string, { name: string; color: string; amount: number; count: number }>();

    for (const tx of tripTxs) {
      const cat = tx.category_id ? categories.find(c => c.id === tx.category_id) : null;
      const key = cat?.id || '__uncat__';
      const name = cat?.name || 'Uncategorized';
      const existing = totals.get(key);
      if (existing) {
        existing.amount += Math.abs(tx.amount);
        existing.count += 1;
      } else {
        totals.set(key, {
          name,
          color: cat?.color || FALLBACK_COLORS[totals.size % FALLBACK_COLORS.length],
          amount: Math.abs(tx.amount),
          count: 1,
        });
      }
    }

    const rows = Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return { rows, total };
  }, [tripId, transactions, categories]);

  if (data.rows.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <PieChart className="w-3.5 h-3.5" /> Category Breakdown
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            No tagged spend yet. Tag transactions to this trip to see where the money's going.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <PieChart className="w-3.5 h-3.5" /> Category Breakdown
          </p>
          <Badge variant="outline" className="text-[10px]">{fmt(data.total)} total</Badge>
        </div>

        {/* Stacked bar */}
        <div className="flex h-3 w-full rounded-full overflow-hidden mb-4 bg-muted/40">
          {data.rows.map(r => (
            <div
              key={r.name}
              style={{ width: `${(r.amount / data.total) * 100}%`, backgroundColor: r.color }}
              title={`${r.name}: ${fmt(r.amount)}`}
            />
          ))}
        </div>

        {/* Rows */}
        <div className="space-y-2">
          {data.rows.map(r => {
            const pct = (r.amount / data.total) * 100;
            return (
              <div key={r.name} className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: r.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{r.name}</p>
                  <p className="text-[10px] text-muted-foreground">{r.count} tx · {pct.toFixed(0)}%</p>
                </div>
                <p className="text-sm font-bold tabular-nums flex-shrink-0">{fmt(r.amount)}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
