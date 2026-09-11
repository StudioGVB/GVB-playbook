import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '@/lib/financeUtils';
import type { FinanceGoal } from '@/hooks/useFinanceData';

const PALETTE = ['#0EA5E9', '#EC4899', '#F59E0B', '#8B5CF6', '#22C55E', '#EF4444', '#14B8A6', '#F97316'];

export type AllocationResult = {
  goalId: string;
  pct: number;
  amount: number;
};

export default function AllocationSlider({
  amount,
  goals,
  convertToBase,
  emergencyMinPct = 20,
  onChange,
  compact = false,
}: {
  amount: number;
  goals: FinanceGoal[];
  convertToBase: (v: number, cur: string) => number;
  emergencyMinPct?: number;
  onChange?: (result: AllocationResult[]) => void;
  compact?: boolean;
}) {
  const allocatable = useMemo(
    () => goals.filter(g => !(g as any).is_stash),
    [goals],
  );
  const emergencyIdx = useMemo(
    () => allocatable.findIndex(g => /emergenc/i.test(g.name)),
    [allocatable],
  );
  const minPcts = useMemo<number[]>(
    () => allocatable.map((_, i) => (i === emergencyIdx ? 20 : 0)),
    [allocatable, emergencyIdx],
  );

  const buildDefault = (): number[] => {
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

  const [pcts, setPcts] = useState<number[]>(buildDefault);
  useEffect(() => { setPcts(buildDefault()); /* eslint-disable-next-line */ }, [allocatable.length, emergencyIdx]);

  const total = Math.max(0, amount);
  const amounts = pcts.map(p => total * (p / 100));

  useEffect(() => {
    if (!onChange) return;
    onChange(allocatable.map((g, i) => ({ goalId: g.id, pct: pcts[i] || 0, amount: amounts[i] || 0 })));
    // eslint-disable-next-line
  }, [pcts, total]);

  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ prefixOther: number; iLeft: number; iRight: number } | null>(null);

  const onDown = (boundaryIdx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      prefixOther: pcts.slice(0, boundaryIdx).reduce((s, v) => s + v, 0),
      iLeft: boundaryIdx,
      iRight: boundaryIdx + 1,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const cursor = ((e.clientX - rect.left) / rect.width) * 100;
    const combined = pcts[d.iLeft] + pcts[d.iRight];
    let newLeft = cursor - d.prefixOther;
    const minL = minPcts[d.iLeft] || 0;
    const minR = minPcts[d.iRight] || 0;
    newLeft = Math.max(minL, Math.min(combined - minR, newLeft));
    setPcts(prev => {
      const n = [...prev];
      n[d.iLeft] = newLeft;
      n[d.iRight] = combined - newLeft;
      return n;
    });
  };
  const onUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const colorFor = (i: number) => allocatable[i].color || PALETTE[i % PALETTE.length];

  if (allocatable.length === 0) {
    return (
      <div className="rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
        Add a pool to start allocating.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={compact ? 'pt-4' : 'pt-6 pb-1'}>
        <div
          ref={barRef}
          className={`relative ${compact ? 'h-9' : 'h-11'} rounded-full bg-muted overflow-visible touch-none`}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
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
                onPointerDown={onDown(i)}
              />
            );
          })}
        </div>
        {emergencyIdx >= 0 && (
          <div className="text-[10px] text-muted-foreground mt-2 text-center font-medium">
            Emergency fund is locked at exactly 20%. Drag the dots to reshape the rest.
          </div>
        )}
      </div>

      <div className="space-y-1">
        {allocatable.map((g, i) => (
          <div key={g.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-muted/40">
            <div className="col-span-7 flex items-center gap-2 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colorFor(i) }} />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {g.name}
                  {i === emergencyIdx && (
                    <span className="ml-2 text-[9px] font-bold uppercase text-[#ef6b6b] bg-red-50 border border-[#ef6b6b]/20 px-1.5 py-0.5 rounded">
                      locked at 20%
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatCurrency(Math.round(convertToBase(g.assigned_amount || 0, g.currency)), 'GBP')}
                  {' / '}
                  {formatCurrency(Math.round(convertToBase(g.target_amount || 0, g.currency)), 'GBP')}
                </div>
              </div>
            </div>
            <div className="col-span-2 text-right text-xs font-mono text-muted-foreground">
              {(pcts[i] || 0).toFixed(0)}%
            </div>
            <div className="col-span-3 text-right font-mono text-sm font-bold">
              +{formatCurrency(Math.round(amounts[i] || 0), 'GBP')}/mo
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
