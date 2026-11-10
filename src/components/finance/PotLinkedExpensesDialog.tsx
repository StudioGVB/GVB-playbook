import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Receipt,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Tag,
  Plane,
  Search,
  ExternalLink,
  Sparkles,
  Info,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import type { FinanceGoal, FinanceTransaction, FinanceCategory, FinanceAccount } from '@/hooks/useFinanceData';
import type { FinanceTrip } from '@/hooks/useFinanceTrips';
import type { WeeklyBoost } from '@/hooks/useWeeklyBoosts';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface PotLinkedExpensesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: {
    id: string;
    name: string;
    currency?: string;
    target_amount?: number;
    assigned_amount?: number;
    color?: string;
    is_stash?: boolean;
    is_emergency?: boolean;
  } | null;
  transactions: FinanceTransaction[];
  trips?: FinanceTrip[];
  categories?: FinanceCategory[];
  accounts?: FinanceAccount[];
  boosts?: WeeklyBoost[];
  baseCurrency?: string;
  selectedMonth?: Date;
  initialTimeRange?: 'month' | 'all';
}

export function getTransactionsForGoal(
  goal: { id: string; name: string; is_stash?: boolean; is_emergency?: boolean },
  transactions: FinanceTransaction[],
  trips: FinanceTrip[] = [],
  categories: FinanceCategory[] = []
): FinanceTransaction[] {
  const isEmergency = (goal as any).is_emergency === true || /emergency/i.test(goal.name);
  const isStash = (goal as any).is_stash === true || /stash/i.test(goal.name);
  const linkedTrip = trips.find(t => t.goal_id === goal.id);
  const cat = categories.find(c => c.name.toLowerCase().trim() === goal.name.toLowerCase().trim());

  const seenIds = new Set<string>();

  return transactions.filter(t => {
    if (seenIds.has(t.id)) return false;

    // 1. Explicit direct link to goal
    if ((t as any).goal_id === goal.id) {
      seenIds.add(t.id);
      return true;
    }

    // 2. Linked Trip transactions
    if (linkedTrip && ((t as any).trip_id === linkedTrip.id)) {
      seenIds.add(t.id);
      return true;
    }

    // 3. Category match
    if (cat && t.category_id === cat.id) {
      seenIds.add(t.id);
      return true;
    }

    // 4. Intelligent keyword description matching
    const raw = `${t.merchant || ''} ${t.description || ''} ${(t as any).raw?.message || ''}`.toLowerCase();
    if (isEmergency) {
      const match = raw.includes('emergency') || (raw.includes('saving') && (t.is_transfer || t.amount > 0));
      if (match) {
        seenIds.add(t.id);
        return true;
      }
    }
    if (isStash) {
      const match = raw.includes('stash');
      if (match) {
        seenIds.add(t.id);
        return true;
      }
    }

    // 5. Pot name in text (for specific travel/goal pots like "amsterdam", "europe", "visa", "xmas")
    const cleanGoalName = goal.name.toLowerCase().trim();
    if (cleanGoalName.length >= 4 && raw.includes(cleanGoalName)) {
      seenIds.add(t.id);
      return true;
    }

    return false;
  });
}

export default function PotLinkedExpensesDialog({
  open,
  onOpenChange,
  goal,
  transactions,
  trips = [],
  categories = [],
  accounts = [],
  boosts = [],
  baseCurrency = 'GBP',
  selectedMonth,
  initialTimeRange = 'month',
}: PotLinkedExpensesDialogProps) {
  const navigate = useNavigate();
  const [filterType, setFilterType] = useState<'all' | 'outflow' | 'inflow'>('all');
  const [timeScope, setTimeScope] = useState<'month' | 'all'>(
    selectedMonth ? initialTimeRange : 'all'
  );
  const [searchQuery, setSearchQuery] = useState('');

  const fmt = (n: number) => formatCurrency(Math.round(n * 100) / 100, baseCurrency);

  // Month range if specified
  const monthStart = useMemo(() => selectedMonth ? startOfMonth(selectedMonth) : null, [selectedMonth]);
  const monthEnd = useMemo(() => selectedMonth ? endOfMonth(selectedMonth) : null, [selectedMonth]);
  const monthLabel = selectedMonth ? format(selectedMonth, 'MMMM yyyy') : '';

  // All linked transactions
  const matchedTxs = useMemo(() => {
    if (!goal) return [];
    return getTransactionsForGoal(goal, transactions, trips, categories);
  }, [goal, transactions, trips, categories]);

  // Linked weekly boosts (contributions)
  const matchedBoosts = useMemo(() => {
    if (!goal) return [];
    return boosts.filter(b => b.goal_id === goal.id);
  }, [goal, boosts]);

  // Combined activity items
  const allActivity = useMemo(() => {
    const list: {
      id: string;
      date: string;
      description: string;
      amount: number;
      type: 'outflow' | 'inflow';
      accountName?: string;
      categoryName?: string;
      isBoost?: boolean;
    }[] = [];

    const accMap = new Map(accounts.map(a => [a.id, a.account_name || (a as any).name]));
    const catMap = new Map(categories.map(c => [c.id, c.name]));

    matchedTxs.forEach(t => {
      const bAmt = baseAmt(t);
      const isPositive = t.amount > 0 || (t.is_transfer && bAmt > 0);
      list.push({
        id: t.id,
        date: t.posted_at,
        description: t.merchant || t.description || 'Transaction',
        amount: Math.abs(bAmt),
        type: isPositive ? 'inflow' : 'outflow',
        accountName: accMap.get(t.account_id) || (t as any).account_name,
        categoryName: catMap.get(t.category_id || ''),
      });
    });

    matchedBoosts.forEach(b => {
      list.push({
        id: `boost-${b.id}`,
        date: b.week_start,
        description: b.note || 'Weekly Boost contribution',
        amount: b.amount,
        type: 'inflow',
        isBoost: true,
      });
    });

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [matchedTxs, matchedBoosts, accounts, categories]);

  // Filtered by time scope, type, and search
  const filteredActivity = useMemo(() => {
    return allActivity.filter(item => {
      // Time scope filter
      if (timeScope === 'month' && monthStart && monthEnd) {
        const d = parseUkDate(item.date);
        if (d < monthStart || d > monthEnd) return false;
      }

      // Outflow / Inflow filter
      if (filterType === 'outflow' && item.type !== 'outflow') return false;
      if (filterType === 'inflow' && item.type !== 'inflow') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = `${item.description} ${item.accountName || ''} ${item.categoryName || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });
  }, [allActivity, timeScope, monthStart, monthEnd, filterType, searchQuery]);

  // Summary figures
  const totals = useMemo(() => {
    let outflow = 0;
    let inflow = 0;
    filteredActivity.forEach(i => {
      if (i.type === 'outflow') outflow += i.amount;
      else inflow += i.amount;
    });
    return {
      outflow,
      inflow,
      net: inflow - outflow,
      count: filteredActivity.length,
    };
  }, [filteredActivity]);

  if (!goal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-0 overflow-hidden rounded-3xl border-2 border-slate-200 shadow-2xl bg-white">
        {/* Header */}
        <DialogHeader className="p-5 pb-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-pink-50/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: goal.color || '#FF2EB8' }}
                />
                <DialogTitle className="text-xl font-display font-black text-slate-900 tracking-tight">
                  {goal.name}
                </DialogTitle>
                <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white border-slate-200">
                  Linked Activity
                </Badge>
              </div>
              <DialogDescription className="text-xs text-slate-500 mt-1">
                Expenses and contributions logged directly to this savings pot.
              </DialogDescription>
            </div>
            {goal.target_amount ? (
              <div className="text-right shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Goal Target</span>
                <span className="text-sm font-black text-slate-900 tabular-nums">
                  {fmt(goal.target_amount)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Time Scope & Type Filters */}
          <div className="flex items-center justify-between gap-2 pt-3 flex-wrap">
            {selectedMonth && (
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => setTimeScope('month')}
                  className={cn(
                    "px-2.5 py-1 text-xs font-bold rounded-lg transition-all",
                    timeScope === 'month'
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {monthLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setTimeScope('all')}
                  className={cn(
                    "px-2.5 py-1 text-xs font-bold rounded-lg transition-all",
                    timeScope === 'all'
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  All Time ({allActivity.length})
                </button>
              </div>
            )}

            {/* Type selector */}
            <div className="flex items-center gap-1 ml-auto">
              {(['all', 'outflow', 'inflow'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilterType(type)}
                  className={cn(
                    "px-2 py-0.5 rounded-lg text-[11px] font-bold capitalize transition-colors",
                    filterType === type
                      ? type === 'outflow'
                        ? "bg-amber-100 text-amber-800"
                        : type === 'inflow'
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100"
                  )}
                >
                  {type === 'all' ? 'All' : type === 'outflow' ? 'Spent' : 'Deposits'}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        {/* Metrics Banner */}
        <div className="grid grid-cols-3 gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100 text-center">
          <div className="bg-white rounded-xl p-2 border border-slate-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Spent</span>
            <span className="text-sm font-black text-amber-700 tabular-nums">
              {totals.outflow > 0 ? `−${fmt(totals.outflow)}` : '£0.00'}
            </span>
          </div>
          <div className="bg-white rounded-xl p-2 border border-slate-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Contributions</span>
            <span className="text-sm font-black text-emerald-600 tabular-nums">
              {totals.inflow > 0 ? `+${fmt(totals.inflow)}` : '£0.00'}
            </span>
          </div>
          <div className="bg-white rounded-xl p-2 border border-slate-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Net Change</span>
            <span className={cn(
              "text-sm font-black tabular-nums",
              totals.net > 0 ? "text-emerald-600" : totals.net < 0 ? "text-amber-700" : "text-slate-700"
            )}>
              {totals.net > 0 ? `+${fmt(totals.net)}` : totals.net < 0 ? `−${fmt(Math.abs(totals.net))}` : '£0.00'}
            </span>
          </div>
        </div>

        {/* Search bar if many items */}
        {allActivity.length > 5 && (
          <div className="px-5 pt-3 pb-1">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search description, merchant, account..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#FF2EB8]"
              />
            </div>
          </div>
        )}

        {/* Transaction Activity List */}
        <ScrollArea className="flex-1 p-5 pt-2">
          {filteredActivity.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-pink-50 border border-pink-100 flex items-center justify-center mx-auto text-[#FF2EB8]">
                <Receipt className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-800">
                No {filterType !== 'all' ? filterType : ''} expenses logged for {goal.name} {timeScope === 'month' ? `in ${monthLabel}` : ''}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Expenses can be linked to this pot directly on the Transactions page using the pool button, or automatically when tagged to this trip/category.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  navigate('/finance/transactions');
                }}
                className="mt-2 text-xs font-semibold rounded-xl border-slate-200 gap-1.5"
              >
                <Tag className="w-3.5 h-3.5 text-slate-500" />
                Go to Transactions
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredActivity.map((tx) => {
                const isOutflow = tx.type === 'outflow';
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-slate-300 transition-colors shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0 mr-3">
                      <div className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                        isOutflow ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                      )}>
                        {isOutflow ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {tx.description}
                        </p>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                          <span>{format(parseUkDate(tx.date), 'EEE d MMM yyyy')}</span>
                          {tx.accountName && (
                            <>
                              <span>•</span>
                              <span className="text-slate-500 font-medium">{tx.accountName}</span>
                            </>
                          )}
                          {tx.categoryName && (
                            <>
                              <span>•</span>
                              <span className="text-[#FF2EB8] font-medium">{tx.categoryName}</span>
                            </>
                          )}
                          {tx.isBoost && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-pink-50 text-[#FF2EB8] border-pink-200">
                              Weekly Boost
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className={cn(
                        "text-sm font-black tabular-nums block",
                        isOutflow ? "text-amber-800" : "text-emerald-700"
                      )}>
                        {isOutflow ? `−${fmt(tx.amount)}` : `+${fmt(tx.amount)}`}
                      </span>
                      <span className="text-[10px] text-slate-400 capitalize">
                        {isOutflow ? 'Spent' : 'Contributed'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="p-3 px-5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500">
          <span className="tabular-nums">
            {filteredActivity.length} item{filteredActivity.length === 1 ? '' : 's'} shown
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs font-semibold rounded-xl text-slate-600 hover:text-slate-900"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
