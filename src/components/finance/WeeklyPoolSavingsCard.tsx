import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ArrowRight, ShieldCheck, Clock, Calendar, CheckCircle2, AlertTriangle, Layers, Wallet, Lock } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';
import type { useFinanceData, FinanceGoal } from '@/hooks/useFinanceData';
import { toast } from 'sonner';
import { format, differenceInCalendarDays, differenceInCalendarWeeks } from 'date-fns';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  spendablePool?: number;
  funMoney?: number;
}

export default function WeeklyPoolSavingsCard({ finance, spendablePool = 0, funMoney = 0 }: Props) {
  const [transferring, setTransferring] = useState(false);
  const [lastTransferDate, setLastTransferDate] = useState<string | null>(() => {
    return localStorage.getItem('gvb_last_weekly_pool_transfer');
  });

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  // Calculate required weekly contribution for each active pool
  const poolBreakdown = useMemo(() => {
    return finance.goals.map((goal) => {
      const targetNative = goal.target_amount || 0;
      const assignedNative = goal.assigned_amount || 0;
      const targetBase = finance.convertToBase(targetNative, goal.currency);
      const assignedBase = finance.convertToBase(assignedNative, goal.currency);
      const remainingBase = Math.max(0, targetBase - assignedBase);

      let weeklyRequiredBase = 0;
      let daysRemaining: number | null = null;
      let weeksRemaining: number | null = null;
      let status: 'completed' | 'on_track' | 'urgent' | 'no_deadline' = 'no_deadline';

      if (remainingBase <= 0.01) {
        status = 'completed';
      } else if (goal.deadline) {
        const dl = new Date(goal.deadline);
        const now = new Date();
        daysRemaining = differenceInCalendarDays(dl, now);

        if (daysRemaining <= 0) {
          weeklyRequiredBase = remainingBase;
          status = 'urgent';
          weeksRemaining = 1;
        } else {
          weeksRemaining = Math.max(1, daysRemaining / 7);
          weeklyRequiredBase = remainingBase / weeksRemaining;
          status = daysRemaining <= 14 ? 'urgent' : 'on_track';
        }
      } else if (goal.percent_allocation && goal.percent_allocation > 0) {
        // Fallback proportional target
        weeklyRequiredBase = (goal.percent_allocation / 100) * 100;
        status = 'on_track';
      }

      return {
        goal,
        targetBase,
        assignedBase,
        remainingBase,
        weeklyRequiredBase,
        daysRemaining,
        weeksRemaining,
        status,
      };
    });
  }, [finance.goals, finance.convertToBase]);

  // Aggregate weekly totals
  const totalWeeklyRequired = poolBreakdown.reduce((sum, item) => sum + item.weeklyRequiredBase, 0);
  const totalMonthlyRequired = totalWeeklyRequired * 4.33;

  // True Safe-to-Spend (Fun money adjusted by deducting weekly pool savings)
  const trueWeeklySafeToSpend = Math.max(0, (funMoney / 4.33) - totalWeeklyRequired);
  const activePoolsCount = poolBreakdown.filter(p => p.remainingBase > 0.01).length;

  // Execute 1-Click Weekly Transfer into Pools
  const handleAutoTransferWeeklySavings = async () => {
    if (totalWeeklyRequired <= 0) {
      toast.info('All your active pools are already fully funded!');
      return;
    }

    setTransferring(true);
    try {
      const updates: Promise<void>[] = [];

      for (const item of poolBreakdown) {
        if (item.weeklyRequiredBase <= 0.01 || item.remainingBase <= 0.01) continue;

        // Convert base weekly required amount to goal native currency
        const oneInBase = finance.convertToBase(1, item.goal.currency);
        const nativeAdd = oneInBase === 0 ? item.weeklyRequiredBase : item.weeklyRequiredBase / oneInBase;
        const newNativeAssigned = (item.goal.assigned_amount || 0) + nativeAdd;

        updates.push(
          finance.updateGoal(item.goal.id, { assigned_amount: newNativeAssigned } as any)
        );
      }

      await Promise.all(updates);

      const nowIso = new Date().toISOString();
      localStorage.setItem('gvb_last_weekly_pool_transfer', nowIso);
      setLastTransferDate(nowIso);

      toast.success(
        `Successfully transferred ${fmt(totalWeeklyRequired)} across ${activePoolsCount} pools! Spendable cash updated.`
      );
    } catch (err: any) {
      toast.error('Failed to complete weekly transfer: ' + (err?.message || 'Unknown error'));
    } finally {
      setTransferring(false);
    }
  };

  return (
    <Card className="bg-white rounded-3xl border-2 border-[#FF7AD1]/40 shadow-[6px_6px_0px_0px_rgba(255,46,184,0.12)] overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-[#FFF5FA] via-white to-[#F0FDF4] border-b border-[#FF7AD1]/20 p-6 pb-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#FF2EB8] text-white p-1.5 rounded-xl">
                <Sparkles className="w-4 h-4" />
              </span>
              <span className="text-[#FF2EB8] font-display font-bold uppercase tracking-wider text-xs">
                Mindset Guardrail • Pool Savings Engine
              </span>
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900">
              Weekly Pool Commitments
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Automatically calculates your required weekly pace for every goal so you never overspend.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Button
              onClick={handleAutoTransferWeeklySavings}
              disabled={transferring || totalWeeklyRequired <= 0}
              className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-extrabold rounded-2xl px-5 py-5 text-sm shadow-lg shadow-[#FF2EB8]/25 transition-all"
            >
              {transferring ? (
                'Transferring Funds...'
              ) : (
                <>
                  ⚡ Lock {fmt(totalWeeklyRequired)}/wk into Pools Now
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* KPI Hero Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Required Weekly Target */}
          <div className="bg-[#FFF5FA] rounded-2xl p-4 border-2 border-[#FF7AD1]/30">
            <span className="text-xs font-display font-bold text-[#FF2EB8] uppercase tracking-wider block mb-1">
              Weekly Pool Target
            </span>
            <div className="text-3xl font-display font-black text-slate-900 tabular-nums">
              {fmt(totalWeeklyRequired)}
              <span className="text-xs font-bold text-slate-500 font-normal"> / week</span>
            </div>
            <span className="text-[11px] text-slate-500 font-medium block mt-1">
              ≈ {fmt(totalMonthlyRequired)} / month total
            </span>
          </div>

          {/* Adjusted True Safe-To-Spend */}
          <div className="bg-[#F0FDF4] rounded-2xl p-4 border-2 border-[#22C55E]/30">
            <span className="text-xs font-display font-bold text-[#166534] uppercase tracking-wider block mb-1">
              True Safe-to-Spend
            </span>
            <div className="text-3xl font-display font-black text-[#166534] tabular-nums">
              {fmt(trueWeeklySafeToSpend)}
              <span className="text-xs font-bold text-[#166534]/70 font-normal"> / week</span>
            </div>
            <span className="text-[11px] text-[#166534]/80 font-medium block mt-1">
              Discretionary income AFTER pool savings
            </span>
          </div>

          {/* Last Transfer Status */}
          <div className="bg-slate-50 rounded-2xl p-4 border-2 border-slate-200 flex flex-col justify-between">
            <span className="text-xs font-display font-bold text-slate-600 uppercase tracking-wider block mb-1">
              Transfer Status
            </span>
            <div>
              {lastTransferDate ? (
                <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Saved {format(new Date(lastTransferDate), 'MMM d, h:mm a')}
                  </span>
                </div>
              ) : (
                <div className="text-amber-700 font-bold text-xs flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>No auto-transfers recorded yet</span>
                </div>
              )}
            </div>
            <span className="text-[10px] text-slate-400 mt-2 block">
              Clicking "Lock into Pools" updates pool balances instantly.
            </span>
          </div>
        </div>

        {/* Per-Pool Breakdown Table / List */}
        <div>
          <h4 className="text-sm font-display font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#FF2EB8]" />
            Active Pools & Required Weekly Contributions
          </h4>

          {poolBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4">No active pools created yet.</p>
          ) : (
            <div className="space-y-2">
              {poolBreakdown.map(({ goal, remainingBase, weeklyRequiredBase, daysRemaining, status }) => {
                const goalColor = goal.color || '#4558ff';
                const isComplete = remainingBase <= 0.01;

                return (
                  <div
                    key={goal.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl border border-slate-100 hover:border-[#FF7AD1]/40 bg-white transition-all gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: goalColor }}
                      />
                      <div className="min-w-0">
                        <span className="font-display font-bold text-slate-900 text-sm block truncate">
                          {goal.name}
                        </span>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                          <span>Left to save: <strong>{fmt(remainingBase)}</strong></span>
                          {goal.deadline && (
                            <span>• Due {format(new Date(goal.deadline), 'MMM d')} ({daysRemaining && daysRemaining > 0 ? `${daysRemaining}d` : 'Due'})</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="text-right">
                        <span className="text-sm font-display font-black text-[#FF2EB8] tabular-nums block">
                          {isComplete ? 'Fully Funded' : `${fmt(weeklyRequiredBase)}/wk`}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {isComplete ? 'Goal reached 🎉' : `≈ ${fmt(weeklyRequiredBase * 4.33)}/mo`}
                        </span>
                      </div>

                      {isComplete ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">Done</Badge>
                      ) : status === 'urgent' ? (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">Pace up</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-slate-200">On Track</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
