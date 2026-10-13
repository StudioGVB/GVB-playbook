import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, LockOpen, Shield, PiggyBank, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/financeUtils';
import { parseCoverMeta, protectionReason, NEXT_WEEK_CAP, type CoverMeta } from '@/lib/overspendCover';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = {
  finance: ReturnType<typeof useFinanceData>;
  trips: any[];
  baseCurrency: string;
};

const isEmergency = (g: any) => g.is_emergency === true || /emergency/i.test(g.name);
const isStash = (g: any) => g.is_stash === true || /stash/i.test(g.name);

/**
 * Overspend cover order: Stash → next week (capped) → pots (bottom of list drained first) → never Emergency.
 * List is shown most-important at the top; the bottom pot is drained first.
 */
export default function OverspendCoverPanel({ finance, trips, baseCurrency }: Props) {
  const [open, setOpen] = useState(false);
  const fmt = (n: number) => formatCurrency(n, baseCurrency);
  const stash = finance.goals.find(isStash) as any;
  const emergency = finance.goals.find(isEmergency) as any;
  const meta: CoverMeta = parseCoverMeta(stash?.description);
  const now = new Date();

  // Most important first (priority 1 at top)
  const pots = useMemo(() => finance.goals
    .filter(g => !isStash(g) && !isEmergency(g))
    .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99) || a.name.localeCompare(b.name)),
  [finance.goals]);

  const saveMeta = async (next: CoverMeta) => {
    if (!stash) { toast.error('Create a Savings Stash first'); return; }
    await finance.updateGoal(stash.id, { description: JSON.stringify(next) } as any);
  };

  const toggleProtect = async (id: string) => {
    const set = new Set(meta.protected || []);
    set.has(id) ? set.delete(id) : set.add(id);
    await saveMeta({ ...meta, protected: [...set] });
  };

  // Renumber priorities 1..n in the new order
  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= pots.length) return;
    const order = [...pots];
    [order[idx], order[j]] = [order[j], order[idx]];
    await Promise.all(order.map((g: any, i) => (g.priority !== i + 1 ? finance.updateGoal(g.id, { priority: i + 1 } as any) : null)));
  };

  const last = meta.last_cover;
  const borrowedTotal = Object.values(meta.borrowed || {}).reduce((s, v) => s + v, 0);

  return (
    <div className="bg-white rounded-2xl border-2 border-[#FF7AD1]/40 p-4 sm:p-5 shadow-[4px_4px_0px_0px_rgba(255,46,184,0.12)]">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left" id="overspend-cover-toggle">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#FF2EB8]">Overspend cover order</p>
          <p className="text-[12px] text-slate-500 mt-0.5">
            If a week ends overspent, money is pulled in this order{borrowedTotal > 0 ? ` · ${fmt(borrowedTotal)} borrowed, repaying from underspend` : ''}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-2">
          <Step n={1} icon={<PiggyBank className="w-4 h-4" />} title="Savings Stash" sub={`${fmt(stash?.assigned_amount || 0)} available`} />
          <Step n={2} icon={<ArrowDown className="w-4 h-4" />} title="Next week's fun money" sub={`Up to ${NEXT_WEEK_CAP * 100}% — you'll never be left with £0`} />

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 pt-1 pb-2">
              3 · Pots — bottom of the list is used first
            </p>
            {pots.length === 0 && <p className="text-xs text-slate-400 px-2 pb-2">No pots yet</p>}
            {pots.map((g: any, i) => {
              const reason = protectionReason(g, meta, trips, now);
              const borrowed = meta.borrowed?.[g.id] || 0;
              const isManual = (meta.protected || []).includes(g.id);
              return (
                <div key={g.id} className={`flex items-center gap-2 px-2 py-2 rounded-lg ${reason ? 'opacity-60' : ''} hover:bg-white`}>
                  <span className="w-5 text-[11px] font-bold text-slate-400 tabular-nums">{i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color || '#cbd5e1' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{g.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {fmt(g.assigned_amount || 0)}
                      {reason && <span className="ml-1.5 text-amber-600 font-medium">· {reason} — skipped</span>}
                      {borrowed > 0 && <span className="ml-1.5 text-rose-600 font-medium">· {fmt(borrowed)} borrowed</span>}
                    </p>
                  </div>
                  <button onClick={() => toggleProtect(g.id)} title={isManual ? 'Unprotect' : 'Protect from overspend cover'}
                    className={`p-1.5 rounded-md ${isManual ? 'text-[#FF2EB8] bg-pink-50' : 'text-slate-300 hover:text-slate-600'}`}>
                    {isManual ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20" title="More important">
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === pots.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20" title="Less important">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <Step n={4} icon={<Shield className="w-4 h-4" />} title={emergency ? emergency.name : 'Emergency Reserve'} sub="Never used automatically — anything left carries to next week" muted />

          <p className="text-[11px] text-slate-500 px-1 pt-1">
            Pots with a trip or deadline in the next 4 weeks are skipped automatically. Future underspend refills borrowed pots (most important first) before the Stash.
          </p>

          {last && last.steps.length > 0 && (
            <div className="mt-2 rounded-xl bg-pink-50/60 border border-pink-200/60 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#FF2EB8] mb-1">
                Last settle · week of {last.week}
              </p>
              <p className="text-xs text-slate-700">
                {last.overspend > 0 ? `Overspent ${fmt(last.overspend)} → ` : 'Underspend → '}
                {last.steps.map(s => `${fmt(s.amount)} ${s.source === 'next_week' ? 'from next week' : s.source === 'repay' ? `repaid to ${s.name}` : `from ${s.name}`}`).join(', ')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Step({ n, icon, title, sub, muted }: { n: number; icon: React.ReactNode; title: string; sub: string; muted?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${muted ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-pink-200/70 bg-pink-50/40'}`}>
      <span className="text-[11px] font-bold text-slate-400 w-4">{n}</span>
      <span className="text-[#FF2EB8]">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-[11px] text-slate-500">{sub}</p>
      </div>
    </div>
  );
}
