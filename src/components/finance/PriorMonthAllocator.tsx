import { useEffect, useMemo, useRef, useState } from 'react';
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns';
import { Sparkles, Wallet, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatCurrency, baseAmt, isExcludedSpendDate } from '@/lib/financeUtils';
import type { FinanceGoal } from '@/hooks/useFinanceData';

export default function PriorMonthAllocator({
  transactions, categories, goals, convertToBase, updateGoal,
}: {
  transactions: any[];
  categories: any[];
  goals: FinanceGoal[];
  convertToBase: (amt: number, cur: string) => number;
  updateGoal: (id: string, updates: Partial<FinanceGoal>) => Promise<void>;
}) {
  const now = new Date();
  const prevStart = startOfMonth(subMonths(now, 1));
  const prevEnd = endOfMonth(prevStart);
  const currStart = startOfMonth(now);
  const currEnd = endOfMonth(now);
  const prevLabel = format(prevStart, 'MMMM yyyy');

  // ---- Leftover from previous (completed) month ----
  const leftover = useMemo(() => {
    let income = 0;
    let spend = 0;
    for (const t of transactions) {
      const d = new Date(t.posted_at);
      if (d < prevStart || d > prevEnd) continue;
      if (t.is_transfer) continue;
      if (t.transfer_status === 'confirmed' || t.transfer_status === 'auto_confirmed') continue;
      if (isExcludedSpendDate(d)) continue;
      const cat = categories.find(c => c.id === t.category_id);
      if (cat?.exclude_from_reports) continue;
      const amt = baseAmt(t);
      if (amt > 0) income += amt;
      else spend += Math.abs(amt);
    }
    return { income, spend, net: income - spend };
  }, [transactions, categories, prevStart, prevEnd]);

  // ---- Commit gating: has this month's paycheck landed? ----
  const paycheckReceived = useMemo(() => {
    for (const t of transactions) {
      if (t.is_transfer) continue;
      const d = new Date(t.posted_at);
      if (d < currStart || d > currEnd) continue;
      const amt = baseAmt(t);
      if (amt >= 500) return true; // heuristic: any single income ≥ £500 this month
    }
    return false;
  }, [transactions, currStart, currEnd]);

  const canCommit = paycheckReceived;

  const allocatable = goals.filter(g => !(g as any).is_stash);
  const emergencyIdx = allocatable.findIndex(g => /emergenc/i.test(g.name));
  const minPcts: number[] = allocatable.map((_, i) => (i === emergencyIdx ? 20 : 0));

  const buildDefaultPcts = () => {
    if (allocatable.length === 0) return [];
    const base = allocatable.map((_, i) => (i === emergencyIdx ? 20 : 0));
    const nonEmergencyCount = allocatable.length - (emergencyIdx >= 0 ? 1 : 0);
    if (nonEmergencyCount > 0) {
      const per = 80 / nonEmergencyCount;
      allocatable.forEach((_, i) => { if (i !== emergencyIdx) base[i] = per; });
    } else if (emergencyIdx >= 0) {
      base[emergencyIdx] = 100;
    }
    return base;
  };

  const [pcts, setPcts] = useState<number[]>(buildDefaultPcts);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setPcts(buildDefaultPcts()); /* eslint-disable-next-line */ }, [prevLabel, allocatable.length, emergencyIdx]);

  const amounts = pcts.map(p => Math.max(0, leftover.net) * (p / 100));
  const totalAllocated = amounts.reduce((s, v) => s + v, 0);

  const distributeByPct = () => {
    const nonEmergencyPools = allocatable.filter((_, i) => i !== emergencyIdx);
    const totalPct = nonEmergencyPools.reduce((s, g) => s + (g.percent_allocation || 0), 0);
    const next = allocatable.map((_, i) => (i === emergencyIdx ? 20 : 0));

    if (totalPct <= 0) {
      const count = nonEmergencyPools.length;
      if (count > 0) {
        allocatable.forEach((_, i) => {
          if (i !== emergencyIdx) next[i] = 80 / count;
        });
      }
    } else {
      allocatable.forEach((g, i) => {
        if (i !== emergencyIdx) {
          next[i] = 80 * ((g.percent_allocation || 0) / totalPct);
        }
      });
    }
    setPcts(next);
  };

  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ boundaryIdx: number; prefixOther: number; iLeft: number; iRight: number } | null>(null);

  const onHandleDown = (boundaryIdx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      boundaryIdx,
      prefixOther: pcts.slice(0, boundaryIdx).reduce((s, v) => s + v, 0),
      iLeft: boundaryIdx,
      iRight: boundaryIdx + 1,
    };
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const cursorPct = ((e.clientX - rect.left) / rect.width) * 100;
    const combined = pcts[d.iLeft] + pcts[d.iRight];
    let newLeft = cursorPct - d.prefixOther;
    const minLeft = minPcts[d.iLeft] || 0;
    const minRight = minPcts[d.iRight] || 0;
    newLeft = Math.max(minLeft, Math.min(combined - minRight, newLeft));
    const newRight = combined - newLeft;
    setPcts(prev => {
      const next = [...prev];
      next[d.iLeft] = newLeft;
      next[d.iRight] = newRight;
      return next;
    });
  };

  const onHandleUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const commit = async () => {
    if (!canCommit) {
      toast.error('Waiting on this month\'s paycheck before committing.');
      return;
    }
    if (totalAllocated <= 0) return;
    setSaving(true);
    try {
      for (let i = 0; i < allocatable.length; i++) {
        const g = allocatable[i];
        const addBase = amounts[i];
        if (addBase <= 0.01) continue;
        const nativePerBase = g.currency && g.currency !== 'GBP'
          ? (convertToBase(1, g.currency) || 1)
          : 1;
        const addNative = addBase / nativePerBase;
        await updateGoal(g.id, {
          assigned_amount: (g.assigned_amount || 0) + addNative,
        } as any);
      }
      toast.success(`Allocated ${formatCurrency(Math.round(totalAllocated), 'GBP')} to pools`);
    } catch (e: any) {
      toast.error(e?.message || 'Allocation failed');
    } finally {
      setSaving(false);
    }
  };

  const isPositive = leftover.net > 0;
  const PALETTE = ['#0EA5E9', '#EC4899', '#F59E0B', '#8B5CF6', '#22C55E', '#EF4444', '#14B8A6', '#F97316'];
  const colorFor = (i: number) => allocatable[i].color || PALETTE[i % PALETTE.length];

  return (
    <div className={`rounded-2xl border-2 overflow-hidden ${canCommit ? 'border-emerald-400' : 'border-slate-200'}`}>
      <div className={`flex items-center justify-between px-5 py-3 border-b ${canCommit ? 'bg-emerald-50' : 'bg-muted/30'}`}>
        <div className="flex items-center gap-2">
          {canCommit
            ? <Sparkles className="w-4 h-4 text-emerald-600" />
            : <Wallet className="w-4 h-4 text-muted-foreground" />}
          <div>
            <h2 className="font-bold text-sm">
              {canCommit
                ? `Paycheck in — commit ${prevLabel}'s leftover`
                : `Planning ${prevLabel}'s leftover`}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Drag the dots to shape where the money goes. Emergency is locked at exactly 20%.
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Leftover</div>
          <div className={`text-2xl font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
            {isPositive ? '+' : ''}{formatCurrency(Math.round(leftover.net), 'GBP')}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!canCommit && isPositive && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
            <div>
              <div className="font-semibold">Sits in your general pool until payday.</div>
              <div className="text-slate-500">You can shape the split now — the money commits into pools once this month's paycheck lands.</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
            <div className="text-[10px] uppercase font-semibold text-emerald-700">Income</div>
            <div className="font-mono font-bold text-emerald-800">{formatCurrency(Math.round(leftover.income), 'GBP')}</div>
          </div>
          <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">
            <div className="text-[10px] uppercase font-semibold text-rose-700">Spent</div>
            <div className="font-mono font-bold text-rose-800">{formatCurrency(Math.round(leftover.spend), 'GBP')}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <div className="text-[10px] uppercase font-semibold text-slate-600">Net</div>
            <div className={`font-mono font-bold ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatCurrency(Math.round(leftover.net), 'GBP')}
            </div>
          </div>
        </div>

        {allocatable.length === 0 ? (
          <div className="rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
            Add a pool to start allocating.
          </div>
        ) : (
          <>
            {!isPositive && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 font-medium">
                {prevLabel} ended in the red — the slider is here for planning, but there's nothing to commit.
              </div>
            )}
            <div className="pt-6 pb-2 select-none">
              <div
                ref={barRef}
                className="relative h-11 rounded-full bg-muted overflow-visible touch-none"
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
              >
                <div className="absolute inset-0 flex rounded-full overflow-hidden">
                  {pcts.map((p, i) => (
                    <div
                      key={allocatable[i].id}
                      className="h-full flex items-center justify-center text-[10px] font-bold text-white/95 transition-[width] duration-75"
                      style={{ width: `${p}%`, background: colorFor(i) }}
                      title={`${allocatable[i].name} — ${p.toFixed(0)}%`}
                    >
                      {p >= 8 && <span className="truncate px-1">{p.toFixed(0)}%</span>}
                    </div>
                  ))}
                </div>
                {pcts.slice(0, -1).map((_, i) => {
                  if (i === emergencyIdx || i + 1 === emergencyIdx) return null;
                  const leftPct = pcts.slice(0, i + 1).reduce((s, v) => s + v, 0);
                  return (
                    <div
                      key={`h-${i}`}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border-2 border-slate-900 shadow-md cursor-ew-resize hover:scale-110 active:scale-125 transition-transform"
                      style={{ left: `${leftPct}%` }}
                      onPointerDown={onHandleDown(i)}
                    />
                  );
                })}
              </div>
              {emergencyIdx >= 0 && (
                <div className="text-[10px] text-muted-foreground mt-2 text-center font-medium">
                  Emergency fund is locked at exactly 20% of leftover.
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={distributeByPct}>Use pool defaults</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPcts(buildDefaultPcts())}>Reset</Button>
            </div>

            <div className="space-y-1">
              {allocatable.map((g, i) => (
                <div key={g.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-muted/40">
                  <div className="col-span-7 flex items-center gap-2 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colorFor(i) }} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {g.name}
                        {i === emergencyIdx && <span className="ml-2 text-[9px] font-bold uppercase text-[#ef6b6b] bg-red-50 border border-[#ef6b6b]/20 px-1.5 py-0.5 rounded">locked at 20%</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatCurrency(Math.round(convertToBase(g.assigned_amount || 0, g.currency)), 'GBP')}
                        {' / '}
                        {formatCurrency(Math.round(convertToBase(g.target_amount || 0, g.currency)), 'GBP')}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 text-right text-xs font-mono text-muted-foreground">
                    {pcts[i].toFixed(0)}%
                  </div>
                  <div className="col-span-3 text-right font-mono text-sm font-bold">
                    +{formatCurrency(Math.round(amounts[i]), 'GBP')}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                Total{' '}
                <span className="font-mono font-bold text-foreground">
                  {formatCurrency(Math.round(totalAllocated), 'GBP')}
                </span>
                {' of '}
                {formatCurrency(Math.round(leftover.net), 'GBP')}
              </div>
              <Button
                size="sm"
                onClick={commit}
                disabled={saving || totalAllocated <= 0 || !canCommit}
                title={!canCommit ? 'Locked until this month\'s paycheck lands' : ''}
              >
                {saving ? 'Saving…' : canCommit ? 'Send to pools' : 'Locked — awaiting payday'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
